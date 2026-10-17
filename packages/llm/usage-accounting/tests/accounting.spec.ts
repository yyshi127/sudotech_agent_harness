import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { PUBLIC_BASE_URL } from '@deepseek-ai/dsh-llm-deepseek'
import type {} from '@deepseek-ai/dsh-settings'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import UsageAccountingService from '../src/index.ts'
import { currentKeyFingerprint, currentUsageIdentity, installUsageObserver } from '../src/compat.ts'
import type { UsageObservation } from '../src/compat.ts'
import { priceUsage } from '../src/pricing.ts'
import { EMBEDDED_PRICE_TABLE } from '../src/pricing.ts'
import { ledgerInput, UsageLedgerStore } from '../src/store.ts'
import { textEvents } from '../../llm-deepseek/tests/mock-server.ts'

const API_KEY = 'test-secret-api-key'
const API_KEY_FINGERPRINT = createHash('sha256').update(API_KEY).digest('hex')
const REQUEST_TIME = Date.UTC(2026, 7, 20, 1)
const AFFECTED_REQUEST_TIME = Date.UTC(2026, 8, 15, 1)
const contexts: Context[] = []
const homes: string[] = []

class MemorySettings extends Service {
  constructor(ctx: Context, private readonly section?: Record<string, unknown>) {
    super(ctx, 'settings')
  }

  configure(): () => void { return () => {} }

  describe(): Array<{ ns: string; value: unknown }> {
    return this.section === undefined ? [] : [{ ns: 'llm-deepseek-api-key', value: this.section }]
  }
}

class MemoryCredentials extends CredentialProvider {
  private readonly records = new Map<CredentialKey, CredentialRecord>()

  constructor(ctx: Context, private readonly options: {
    value: () => string | undefined | Error
    beforeResolve?: () => Promise<void>
  }) { super(ctx) }
  async resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    await this.options.beforeResolve?.()
    const value = this.options.value()
    if (value instanceof Error) throw value
    return value === undefined ? undefined : { value, source: 'memory' }
  }
  describe(_ref: CredentialRef): Promise<CredentialInfo> {
    const value = this.options.value()
    return Promise.resolve({ configured: value !== undefined && !(value instanceof Error), source: 'memory', writable: true })
  }
  set(_ref: CredentialRef, _value: string): Promise<void> { return Promise.resolve() }
  unset(_ref: CredentialRef): Promise<void> { return Promise.resolve() }
  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.records.get(key))
  }
  describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = this.records.get(key)
    return Promise.resolve(record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: record.kind, writable: true })
  }
  listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({ key, kind: record.kind })))
  }
  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const current = this.records.get(key)
    const next = await mutate(current)
    if (next === undefined) return current
    this.records.set(key, next)
    return next
  }
  deleteRecord(key: CredentialKey): Promise<void> {
    this.records.delete(key)
    return Promise.resolve()
  }
}

async function harness(options: {
  key?: string | undefined | Error | (() => string | undefined | Error)
  accountToken?: string | undefined | Error | (() => string | undefined | Error)
  baseURL?: string
  credentialReadBarrier?: () => Promise<void>
} = {}): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemorySettings, options.baseURL === undefined ? {} : { baseURL: options.baseURL }).await()
  const key = 'key' in options ? options.key : API_KEY
  await ctx.plugin(MemoryCredentials, {
    value: typeof key === 'function' ? key : () => key,
    ...options.credentialReadBarrier === undefined ? {} : { beforeResolve: options.credentialReadBarrier },
  }).await()
  if ('accountToken' in options) {
    const token = options.accountToken
    ctx.provide('deepseekAccount', {
      resolveToken: () => {
        const value = typeof token === 'function' ? token() : token
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
      },
    })
  }
  await ctx.plugin(LlmRuntime).await()
  await ctx.plugin(LlmDeepSeek, options.baseURL === undefined ? {} : { baseURL: options.baseURL }).await()
  return ctx
}

function apiKeyIdentity(
  baseURL = PUBLIC_BASE_URL,
  keyFingerprint = API_KEY_FINGERPRINT,
): LlmDeepSeek.DeepSeekRequestIdentity {
  return { baseURL, authentication: { kind: 'api-key', keyFingerprint } }
}

function usageStream(
  ctx: Context,
  identity: LlmDeepSeek.DeepSeekRequestIdentity | undefined,
  ...chunks: StreamChunk[]
) {
  return async function* (_options: GenerateOptions, _next: () => AsyncIterable<StreamChunk>) {
    if (identity !== undefined) ctx.emit('llm-deepseek/request-identity', identity)
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

describe('Harness 0.2.0-rc.2 usage observer', () => {
  it('matches concurrent settlements to the actual request headers while the key changes', async () => {
    let key = API_KEY
    const firstFetch = Promise.withResolvers<undefined>()
    const releaseFirst = Promise.withResolvers<undefined>()
    const requestKeys: string[] = []
    const fetchSpy = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestKeys.push(new Headers(init?.headers).get('x-api-key') ?? '')
      if (requestKeys.length === 1) {
        firstFetch.resolve(undefined)
        await releaseFirst.promise
      }
      return new Response(textEvents.map(event => `data: ${event}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      })
    })
    vi.stubGlobal('fetch', fetchSpy)
    const ctx = await harness({ key: () => key, accountToken: 'logged-in-account' })
    const resolve = vi.spyOn(ctx.credentials, 'resolve')
    const settle = vi.fn((_observation: UsageObservation) => Promise.resolve())
    const fail = vi.fn()
    installUsageObserver(ctx, { settle, fail })

    const first = consume(ctx)
    await firstFetch.promise
    key = 'second-request-key'
    await consume(ctx)
    releaseFirst.resolve(undefined)
    await first

    expect(requestKeys).toEqual([API_KEY, 'second-request-key'])
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(settle.mock.calls.map(([observation]) => observation)).toEqual([
      expect.objectContaining({ keyFingerprint: createHash('sha256').update('second-request-key').digest('hex') }),
      expect.objectContaining({ keyFingerprint: API_KEY_FINGERPRINT }),
    ])
    expect(fail).not.toHaveBeenCalled()
  })

  it('resolves the default DeepSeek connection when settings have no provider section', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(MemoryCredentials, { value: () => API_KEY }).await()

    await expect(currentKeyFingerprint(ctx)).resolves.toBe(createHash('sha256').update(API_KEY).digest('hex'))
    await expect(currentUsageIdentity(ctx)).resolves.toMatchObject({
      officialEndpoint: true,
      recoverDefaultMessagesHistory: true,
    })
  })

  it('settles the first usage chunk once with a key fingerprint and request purpose', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(REQUEST_TIME)
    const ctx = await harness()
    const settle = vi.fn(() => Promise.resolve())
    const fail = vi.fn()
    installUsageObserver(ctx, { settle, fail })
    ctx.on('llm/stream', usageStream(ctx, apiKeyIdentity(),
      { type: 'usage', usage: { inputTokens: 20, outputTokens: 30, cacheReadTokens: 10 } },
      { type: 'usage', usage: { inputTokens: 200, outputTokens: 300, cacheReadTokens: 100 } },
    ))

    expect(await consume(ctx)).toHaveLength(2)
    expect(settle).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledWith({
      keyFingerprint: API_KEY_FINGERPRINT,
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
    ctx.on('llm/stream', usageStream(ctx, apiKeyIdentity('https://gateway.example/v1'),
      { type: 'usage', usage: { inputTokens: -1, outputTokens: 1 } },
    ))

    await consume(ctx)
    expect(settle).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledOnce()
  })

  it('records optional cache-write usage and the explicit request purpose', async () => {
    const ctx = await harness({ baseURL: 'https://api.deepseek.com' })
    const settle = vi.fn(() => Promise.resolve())
    installUsageObserver(ctx, { settle, fail: vi.fn() })
    ctx.on('llm/stream', usageStream(ctx, apiKeyIdentity('https://api.deepseek.com'),
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, cacheWriteTokens: 4 } },
    ))

    for await (const _chunk of ctx.llm.stream({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      purpose: 'compaction',
      messages: [],
    })) { /* consume the observed stream */ }

    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      officialEndpoint: false,
      purpose: 'compaction',
      usage: {
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 2,
        outputTokens: 3,
        cacheWriteTokens: 4,
      },
    }))
  })

  it('recognizes the explicit official Messages root without enabling implicit-history repair', async () => {
    const ctx = await harness({ baseURL: 'https://api.deepseek.com/anthropic/' })
    const settle = vi.fn(() => Promise.resolve())
    installUsageObserver(ctx, { settle, fail: vi.fn() })
    ctx.on('llm/stream', usageStream(ctx, apiKeyIdentity('https://api.deepseek.com/anthropic/'),
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    ))

    await consume(ctx)

    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ officialEndpoint: true }))
    await expect(currentUsageIdentity(ctx)).resolves.toMatchObject({
      officialEndpoint: true,
      recoverDefaultMessagesHistory: false,
    })
  })

  it('settles from the request identity without re-resolving a failing current credential', async () => {
    const credentialFailure = await harness({ key: new Error('credential unavailable') })
    const settle = vi.fn(() => Promise.resolve())
    const fail = vi.fn()
    installUsageObserver(credentialFailure, { settle, fail })
    credentialFailure.on('llm/stream', usageStream(credentialFailure, apiKeyIdentity(),
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    ))

    await consume(credentialFailure)
    expect(settle).toHaveBeenCalledOnce()
    expect(fail).not.toHaveBeenCalled()
    await expect(currentUsageIdentity(credentialFailure)).rejects.toThrow('credential unavailable')
  })

  it('does not attribute account-authenticated usage to the configured API key', async () => {
    const ctx = await harness({ accountToken: 'account-token' })
    const settle = vi.fn(() => Promise.resolve())
    const fail = vi.fn()
    installUsageObserver(ctx, { settle, fail })
    ctx.on('llm/stream', usageStream(ctx, undefined,
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    ))

    await consume(ctx, 'deepseek-account')

    expect(settle).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
    await expect(currentUsageIdentity(ctx)).resolves.toMatchObject({ keyFingerprint: API_KEY_FINGERPRINT })
  })

  it('reports missing request identity without guessing from an unconfigured current key', async () => {
    const ctx = await harness({ key: undefined })
    const settle = vi.fn(() => Promise.resolve())
    const fail = vi.fn()
    installUsageObserver(ctx, { settle, fail })
    ctx.on('llm/stream', usageStream(ctx, undefined,
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    ))

    await consume(ctx)
    await consume(ctx, 'another-provider')
    expect(settle).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledOnce()
    await expect(currentKeyFingerprint(ctx)).resolves.toBeUndefined()
  })

  it('keeps the authentication selected by an in-flight request while current login state switches', async () => {
    let key: string | undefined = API_KEY
    let accountToken: string | undefined
    const requestSelected = Promise.withResolvers<undefined>()
    const ctx = await harness({
      key: () => key,
      accountToken: () => accountToken,
      credentialReadBarrier: () => requestSelected.promise,
    })
    const settle = vi.fn(() => Promise.resolve())
    const fail = vi.fn()
    installUsageObserver(ctx, { settle, fail })
    ctx.on('llm/stream', async function* (_options, _next) {
      ctx.emit('llm-deepseek/request-identity', apiKeyIdentity())
      key = 'replacement-key'
      accountToken = 'new-account-token'
      requestSelected.resolve(undefined)
      yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 5 } }
    })

    await consume(ctx)

    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ keyFingerprint: API_KEY_FINGERPRINT }))
    expect(fail).not.toHaveBeenCalled()
    await expect(currentUsageIdentity(ctx)).resolves.toMatchObject({
      keyFingerprint: createHash('sha256').update('replacement-key').digest('hex'),
    })
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
    ctx.on('llm/stream', usageStream(ctx, apiKeyIdentity(),
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
      cacheHitInputCostNanoyuan: '400',
      cacheMissInputCostNanoyuan: '40000',
      outputCostNanoyuan: '240000',
      costNanoyuan: '280400',
      unpricedTokens: 0,
    }])
    expect(snapshot.revision).toBe(1)
    expect(revisions).toEqual([1])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('recovers affected default-Messages rows before returning their first snapshot', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(AFFECTED_REQUEST_TIME)
    const home = await mkdtemp(join(tmpdir(), 'dsh-usage-service-repair-'))
    homes.push(home)
    const fingerprint = API_KEY_FINGERPRINT
    const usage = {
      cacheHitInputTokens: 10,
      cacheMissInputTokens: 20,
      outputTokens: 30,
      cacheWriteTokens: 4,
    }
    const store = new UsageLedgerStore(home)
    await store.init(AFFECTED_REQUEST_TIME)
    await store.append(ledgerInput({
      keyFingerprint: fingerprint,
      model: 'deepseek-flash',
      occurredAt: AFFECTED_REQUEST_TIME,
      purpose: 'conversation',
      usage,
    }, priceUsage(EMBEDDED_PRICE_TABLE, 'deepseek-flash', usage, AFFECTED_REQUEST_TIME, false)))
    const ctx = await harness()
    await ctx.plugin(UsageAccountingService, { dshHome: home }).await()
    const revisions: number[] = []
    ctx.on('usage-accounting/updated', revision => revisions.push(revision))

    const snapshot = await ctx.usageAccounting.snapshot()

    expect(snapshot.revision).toBe(0)
    expect(snapshot.total).toMatchObject({
      cacheHitInputCostNanoyuan: '400',
      cacheMissInputCostNanoyuan: '40000',
      outputCostNanoyuan: '240000',
      costNanoyuan: '280400',
      unpricedTokens: 4,
    })
    expect(revisions).toEqual([])
  })

  it('contains synchronous and asynchronous listener failures after persistence', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(REQUEST_TIME)
    const home = await mkdtemp(join(tmpdir(), 'dsh-usage-service-errors-'))
    homes.push(home)
    const ctx = await harness()
    await ctx.plugin(UsageAccountingService, { dshHome: home }).await()
    ctx.on('usage-accounting/updated', () => { throw new Error('ordinary listener failed') })
    const asyncFailure = (() => Promise.reject(new Error('async listener failed'))) as () => void
    ctx.on('usage-accounting/updated', asyncFailure)
    ctx.on('llm/stream', usageStream(ctx, apiKeyIdentity(),
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    ))

    await consume(ctx)
    await Promise.resolve()

    const snapshot = await ctx.usageAccounting.snapshot()
    expect(snapshot.revision).toBe(1)
    expect(snapshot.total.totalTokens).toBe(2)
  })

  it('drops new observations after disposal has stopped the observer', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-usage-service-disposed-'))
    homes.push(home)
    const ctx = await harness()
    await ctx.plugin(UsageAccountingService, { dshHome: home }).await()
    const service = ctx.usageAccounting
    await ctx.fiber.dispose()
    const observation: UsageObservation = {
      keyFingerprint: createHash('sha256').update(API_KEY).digest('hex'),
      officialEndpoint: true,
      model: 'deepseek-v4-flash',
      occurredAt: REQUEST_TIME,
      purpose: 'conversation',
      usage: {
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 1,
        outputTokens: 1,
        cacheWriteTokens: 0,
      },
    }

    await (service as unknown as { enqueue(value: UsageObservation): Promise<void> }).enqueue(observation)

    expect(service.revision).toBe(0)
  })
})
