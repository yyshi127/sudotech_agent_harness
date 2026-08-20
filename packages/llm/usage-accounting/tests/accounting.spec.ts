import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import UsageAccountingService from '../src/index.ts'
import { installUsageObserver } from '../src/compat.ts'

const API_KEY = 'test-secret-api-key'
const REQUEST_TIME = Date.UTC(2026, 7, 20, 1)
const contexts: Context[] = []
const homes: string[] = []

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

class MemoryCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly value: string | undefined) { super(ctx) }
  resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(this.value === undefined ? undefined : { value: this.value, source: 'memory' })
  }
  describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: this.value !== undefined, source: 'memory', writable: true })
  }
  set(_ref: CredentialRef, _value: string): Promise<void> { return Promise.resolve() }
  unset(_ref: CredentialRef): Promise<void> { return Promise.resolve() }
}

async function harness(options: { key?: string | undefined; baseURL?: string } = {}): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemorySettings).await()
  await ctx.plugin(MemoryCredentials, 'key' in options ? options.key : API_KEY).await()
  await ctx.plugin(LlmRuntime).await()
  await ctx.plugin(LlmDeepSeek, options.baseURL === undefined ? {} : { baseURL: options.baseURL }).await()
  return ctx
}

function usageStream(...chunks: StreamChunk[]) {
  return async function* (_options: GenerateOptions, _next: () => AsyncIterable<StreamChunk>) {
    yield* chunks
  }
}

async function consume(ctx: Context, provider = 'deepseek-official'): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({ provider, model: 'deepseek-v4-flash', messages: [] })) {
    chunks.push(chunk)
  }
  return chunks
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

describe('rc.5 usage observer', () => {
  it('settles the first usage chunk once with a key fingerprint and request purpose', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(REQUEST_TIME)
    const ctx = await harness()
    const settle = vi.fn(() => Promise.resolve())
    const fail = vi.fn()
    installUsageObserver(ctx, { settle, fail })
    ctx.on('llm/stream', usageStream(
      { type: 'usage', usage: { inputTokens: 20, outputTokens: 30, cacheReadTokens: 10 } },
      { type: 'usage', usage: { inputTokens: 200, outputTokens: 300, cacheReadTokens: 100 } },
    ))

    expect(await consume(ctx)).toHaveLength(2)
    expect(settle).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledWith({
      keyFingerprint: createHash('sha256').update(API_KEY).digest('hex'),
      officialEndpoint: true,
      model: 'deepseek-v4-flash',
      occurredAt: REQUEST_TIME,
      purpose: 'conversation',
      usage: {
        cacheHitInputTokens: 10,
        cacheMissInputTokens: 20,
        outputTokens: 30,
        cacheWriteTokens: 0,
      },
    })
    expect(fail).not.toHaveBeenCalled()
  })

  it('marks custom endpoints unpriced and contains invalid provider usage', async () => {
    const ctx = await harness({ baseURL: 'https://gateway.example/v1' })
    const settle = vi.fn(() => Promise.resolve())
    const fail = vi.fn()
    installUsageObserver(ctx, { settle, fail })
    ctx.on('llm/stream', usageStream(
      { type: 'usage', usage: { inputTokens: -1, outputTokens: 1 } },
    ))

    await consume(ctx)
    expect(settle).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledOnce()
  })

  it('ignores unconfigured keys and non-DeepSeek routes', async () => {
    const ctx = await harness({ key: undefined })
    const settle = vi.fn(() => Promise.resolve())
    installUsageObserver(ctx, { settle, fail: vi.fn() })
    ctx.on('llm/stream', usageStream(
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    ))

    await consume(ctx)
    await consume(ctx, 'another-provider')
    expect(settle).not.toHaveBeenCalled()
  })
})

describe('UsageAccountingService', () => {
  it('persists one settlement and pushes the committed revision', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(REQUEST_TIME)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const home = await mkdtemp(join(tmpdir(), 'dsh-usage-service-'))
    homes.push(home)
    const ctx = await harness()
    await ctx.plugin(UsageAccountingService, { dshHome: home }).await()
    const revisions: number[] = []
    ctx.on('usage-accounting/updated', (revision) => { revisions.push(revision) })
    ctx.on('llm/stream', usageStream(
      { type: 'usage', usage: { inputTokens: 20, outputTokens: 30, cacheReadTokens: 10 } },
    ))

    await consume(ctx)
    const snapshot = await ctx.usageAccounting.snapshot()
    expect(snapshot.keyConfigured).toBe(true)
    expect(snapshot.days).toEqual([{
      date: '2026-08-20',
      cacheHitInputTokens: 10,
      cacheMissInputTokens: 20,
      outputTokens: 30,
      totalTokens: 60,
      cacheHitInputCostNanoyuan: '1000',
      cacheMissInputCostNanoyuan: '60000',
      outputCostNanoyuan: '270000',
      costNanoyuan: '331000',
      unpricedTokens: 0,
    }])
    expect(snapshot.revision).toBe(1)
    expect(revisions).toEqual([1])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
