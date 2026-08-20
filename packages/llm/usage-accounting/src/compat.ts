/** rc.8 Harness compatibility adapter for DeepSeek request observation. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Config as DeepSeekConfig } from '@deepseek-ai/dsh-llm-deepseek'
import { PUBLIC_BASE_URL, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { UsageBuckets } from './pricing.ts'

const PROVIDER = 'deepseek-official'
const SETTINGS_NS = settingsNamespace('llm-deepseek')

/** One actual provider request ready for durable settlement. */
export interface UsageObservation {
  keyFingerprint: string
  officialEndpoint: boolean
  model: string
  occurredAt: number
  purpose: 'conversation' | 'compaction' | 'session-title'
  usage: UsageBuckets
}

/** Observer callbacks kept outside the rc.8-specific imports. */
export interface UsageObserverCallbacks {
  settle(observation: UsageObservation): Promise<void>
  fail(error: unknown): void
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function officialEndpoint(baseURL: string): boolean {
  try {
    const actual = new URL(baseURL)
    const official = new URL(PUBLIC_BASE_URL)
    return actual.origin === official.origin && (actual.pathname === '/' || actual.pathname === '')
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

async function identityOf(ctx: Context): Promise<{ keyFingerprint: string; officialEndpoint: boolean } | undefined> {
  const raw = ctx.settings.get(SETTINGS_NS) as DeepSeekConfig | undefined
  const connection = resolveAdapterOptions(raw ?? {}, launchEnvironmentOf(ctx))
  const resolved = await ctx.credentials.resolve(connection.apiKeyEnv)
  if (resolved === undefined) return undefined
  return {
    keyFingerprint: fingerprint(resolved.value),
    officialEndpoint: officialEndpoint(connection.baseURL),
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
            ...requestIdentity.value,
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
 * Install the only rc.8-specific `llm/stream` listener used by accounting.
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
