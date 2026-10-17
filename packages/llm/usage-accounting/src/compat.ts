/** Harness compatibility adapter for DeepSeek request observation. */

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { DeepSeekRequestIdentity, Options as DeepSeekOptions } from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { PUBLIC_BASE_URL } from '@deepseek-ai/dsh-llm-deepseek'
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import type { UsageBuckets } from './pricing.ts'

const PROVIDER = 'deepseek-official'
const SETTINGS_NS = 'llm-deepseek-api-key'
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'
const publicEndpoint = new URL(PUBLIC_BASE_URL)
const OFFICIAL_ENDPOINT = {
  origin: publicEndpoint.origin,
  pathname: normalizedPathname(publicEndpoint.pathname),
}

/** One actual provider request ready for durable settlement. */
export interface UsageObservation {
  keyFingerprint: string
  officialEndpoint: boolean
  model: string
  occurredAt: number
  purpose: 'conversation' | 'compaction' | 'session-title'
  usage: UsageBuckets
}

/** Observer callbacks kept outside the Harness-version-specific imports. */
export interface UsageObserverCallbacks {
  settle(observation: UsageObservation): Promise<void>
  fail(error: unknown): void
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function normalizedPathname(pathname: string): string {
  return pathname.replace(/\/+$/u, '')
}

function officialEndpoint(baseURL: string): boolean {
  try {
    const actual = new URL(baseURL)
    if (actual.username || actual.password || actual.search || actual.hash) return false
    const pathname = normalizedPathname(actual.pathname)
    return actual.origin === OFFICIAL_ENDPOINT.origin && pathname === OFFICIAL_ENDPOINT.pathname
  } catch {
    return false
  }
}

function bucketsOf(usage: TokenUsage): UsageBuckets {
  const cacheHitInputTokens = usage.cacheReadTokens ?? 0
  const cacheMissInputTokens = usage.inputTokens
  const outputTokens = usage.outputTokens
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0
  const values = [cacheHitInputTokens, cacheMissInputTokens, outputTokens, cacheWriteTokens]
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError('usage-accounting: provider usage must contain non-negative safe integers')
  }
  return {
    cacheHitInputTokens,
    cacheMissInputTokens,
    outputTokens,
    cacheWriteTokens,
  }
}

/** Current request identity and whether the affected implicit Messages default can recover its own history. */
export interface CurrentUsageIdentity {
  keyFingerprint: string
  officialEndpoint: boolean
  recoverDefaultMessagesHistory: boolean
}

async function currentIdentityOf(ctx: Context): Promise<CurrentUsageIdentity | undefined> {
  const settingsNs = ctx.get('llm')?.listConfigurableProviders()
    .find(entry => entry.provider === PROVIDER)?.settingsNs ?? SETTINGS_NS
  const value = ctx.settings.describe().find(entry => entry.ns === settingsNs)?.value
  const raw = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as DeepSeekOptions
    : {}
  const environment = launchEnvironmentOf(ctx)
  const connection = resolveAdapterOptions(raw, environment)
  const resolved = await ctx.credentials.resolve(connection.apiKeyEnv)
  if (resolved === undefined) return undefined
  return {
    keyFingerprint: fingerprint(resolved.value),
    officialEndpoint: officialEndpoint(connection.baseURL),
    recoverDefaultMessagesHistory: raw.baseURL === undefined
      && environment.get(BASE_URL_ENV) === undefined
      && normalizedPathname(new URL(connection.baseURL).pathname)
        === normalizedPathname(new URL(PUBLIC_BASE_URL).pathname),
  }
}

interface RequestIdentityCapture {
  identity?: DeepSeekRequestIdentity
}

async function* observe(
  requestIdentities: AsyncLocalStorage<RequestIdentityCapture>,
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
  callbacks: UsageObserverCallbacks,
): AsyncIterable<StreamChunk> {
  const occurredAt = Date.now()
  const capture: RequestIdentityCapture = {}
  const stream = requestIdentities.run(capture, next)
  const iterator = stream[Symbol.asyncIterator]()
  let settled = false
  let completed = false
  try {
    while (true) {
      const item = await requestIdentities.run(capture, () => iterator.next())
      if (item.done) {
        completed = true
        return
      }
      const chunk = item.value
      if (!settled && chunk.type === 'usage') {
        settled = true
        const identity = capture.identity
        if (identity === undefined) {
          callbacks.fail(new Error('usage-accounting: DeepSeek request did not report its authentication identity'))
        } else {
          try {
            await callbacks.settle({
              keyFingerprint: identity.authentication.keyFingerprint,
              officialEndpoint: officialEndpoint(identity.baseURL),
              model: options.model,
              occurredAt,
              purpose: options.purpose ?? 'conversation',
              usage: bucketsOf(chunk.usage),
            })
          } catch (error) {
            callbacks.fail(error)
          }
        }
      }
      yield chunk
    }
  } finally {
    if (!completed) {
      const close = iterator.return?.bind(iterator)
      if (close !== undefined) await requestIdentities.run(capture, () => close())
    }
  }
}

/**
 * Install the only Harness-version-specific `llm/stream` listener used by accounting.
 * @param ctx - Host context carrying LLM, settings, and credential seams.
 * @param callbacks - durable settlement and contained-error hooks.
 * @returns listener disposer.
 */
export function installUsageObserver(ctx: Context, callbacks: UsageObserverCallbacks): () => void {
  const requestIdentities = new AsyncLocalStorage<RequestIdentityCapture>()
  const disposeIdentity = ctx.on('llm-deepseek/request-identity', (identity) => {
    const capture = requestIdentities.getStore()
    if (capture !== undefined) capture.identity = identity
  })
  const disposeStream = ctx.on('llm/stream', (options, next) => {
    if (options.provider !== PROVIDER) return next()
    return observe(requestIdentities, options, next, callbacks)
  })
  return () => {
    disposeStream()
    disposeIdentity()
  }
}

/**
 * Resolve the current official DeepSeek key fingerprint without exposing it to clients.
 * @param ctx - Host context carrying settings and credential services.
 * @returns SHA-256 fingerprint, or undefined when no key is configured.
 */
export async function currentKeyFingerprint(ctx: Context): Promise<string | undefined> {
  return (await currentIdentityOf(ctx))?.keyFingerprint
}

/**
 * Resolve the current accounting identity without exposing credential material.
 * @param ctx - Host context carrying settings and credential services.
 * @returns current fingerprint and endpoint classification, or undefined when no key is configured.
 */
export async function currentUsageIdentity(ctx: Context): Promise<CurrentUsageIdentity | undefined> {
  return currentIdentityOf(ctx)
}
