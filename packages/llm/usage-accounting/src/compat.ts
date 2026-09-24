/** Harness 0.1.1-rc.2 compatibility adapter for DeepSeek request observation. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Config as DeepSeekConfig } from '@deepseek-ai/dsh-llm-deepseek'
import { MESSAGES_BASE_URL, PUBLIC_BASE_URL, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import type { UsageBuckets } from './pricing.ts'

const PROVIDER = 'deepseek-official'
const SETTINGS_NS = 'llm-deepseek'
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'
const OFFICIAL_ENDPOINTS = [PUBLIC_BASE_URL, MESSAGES_BASE_URL].map((baseURL) => {
  const url = new URL(baseURL)
  return { origin: url.origin, pathname: normalizedPathname(url.pathname) }
})

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
    return OFFICIAL_ENDPOINTS.some(endpoint => (
      actual.origin === endpoint.origin && pathname === endpoint.pathname
    ))
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

async function identityOf(ctx: Context): Promise<CurrentUsageIdentity | undefined> {
  const raw = ctx.settings.get(SETTINGS_NS) as DeepSeekConfig | undefined
  const environment = launchEnvironmentOf(ctx)
  const connection = resolveAdapterOptions(raw ?? {}, environment)
  const resolved = await ctx.credentials.resolve(connection.apiKeyEnv)
  if (resolved === undefined) return undefined
  return {
    keyFingerprint: fingerprint(resolved.value),
    officialEndpoint: officialEndpoint(connection.baseURL),
    recoverDefaultMessagesHistory: connection.protocol === 'messages'
      && raw?.baseURL === undefined
      && environment.get(BASE_URL_ENV) === undefined
      && normalizedPathname(new URL(connection.baseURL).pathname)
        === normalizedPathname(new URL(MESSAGES_BASE_URL).pathname),
  }
}

async function* observe(
  ctx: Context,
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
  callbacks: UsageObserverCallbacks,
): AsyncIterable<StreamChunk> {
  const occurredAt = Date.now()
  const identity = identityOf(ctx).then(
    value => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  let settled = false
  for await (const chunk of next()) {
    if (!settled && chunk.type === 'usage') {
      settled = true
      const requestIdentity = await identity
      if (!requestIdentity.ok) callbacks.fail(requestIdentity.error)
      else if (requestIdentity.value !== undefined) {
        try {
          await callbacks.settle({
            keyFingerprint: requestIdentity.value.keyFingerprint,
            officialEndpoint: requestIdentity.value.officialEndpoint,
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
}

/**
 * Install the only Harness-version-specific `llm/stream` listener used by accounting.
 * @param ctx - Host context carrying LLM, settings, and credential seams.
 * @param callbacks - durable settlement and contained-error hooks.
 * @returns listener disposer.
 */
export function installUsageObserver(ctx: Context, callbacks: UsageObserverCallbacks): () => void {
  return ctx.on('llm/stream', (options, next) => {
    if (options.provider !== PROVIDER) return next()
    return observe(ctx, options, next, callbacks)
  })
}

/**
 * Resolve the current official DeepSeek key fingerprint without exposing it to clients.
 * @param ctx - Host context carrying settings and credential services.
 * @returns SHA-256 fingerprint, or undefined when no key is configured.
 */
export async function currentKeyFingerprint(ctx: Context): Promise<string | undefined> {
  return (await identityOf(ctx))?.keyFingerprint
}

/**
 * Resolve the current accounting identity without exposing credential material.
 * @param ctx - Host context carrying settings and credential services.
 * @returns current fingerprint and endpoint classification, or undefined when no key is configured.
 */
export async function currentUsageIdentity(ctx: Context): Promise<CurrentUsageIdentity | undefined> {
  return identityOf(ctx)
}
