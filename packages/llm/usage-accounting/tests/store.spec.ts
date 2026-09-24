import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMBEDDED_PRICE_TABLE, priceUsage, RECOVERABLE_PRICE_TABLES } from '../src/pricing.ts'
import { ledgerInput, UsageLedgerStore } from '../src/store.ts'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)
const AUGUST_20 = Date.UTC(2026, 7, 20, 4)
const SEPTEMBER_15 = Date.UTC(2026, 8, 15, 1)
let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

function input(keyFingerprint: string, occurredAt: number, costNanoyuan: bigint) {
  const cacheHitInputCostNanoyuan = costNanoyuan / 10n
  const cacheMissInputCostNanoyuan = costNanoyuan / 5n
  return ledgerInput({
    keyFingerprint,
    model: 'deepseek-v4-flash',
    occurredAt,
    purpose: 'conversation',
    usage: {
      cacheHitInputTokens: 10,
      cacheMissInputTokens: 20,
      outputTokens: 30,
      cacheWriteTokens: 0,
    },
  }, {
    cacheHitInputCostNanoyuan,
    cacheMissInputCostNanoyuan,
    outputCostNanoyuan: costNanoyuan - cacheHitInputCostNanoyuan - cacheMissInputCostNanoyuan,
    costNanoyuan,
    unpricedTokens: 0,
    priceVersion: 'price-v1',
  })
}

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'request-1',
    ...input(KEY_A, AUGUST_20, 100n),
    ...overrides,
  }
}

async function replaceLedger(store: UsageLedgerStore, records: unknown[], trackingSince = '2026-08-20'): Promise<void> {
  await writeFile(store.ledgerPath, `${JSON.stringify({ schemaVersion: 1, trackingSince, records }, null, 2)}\n`, 'utf8')
}

describe('UsageLedgerStore', () => {
  it('initializes once without rewriting an existing valid ledger', async () => {
    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    const before = await readFile(store.ledgerPath, 'utf8')
    await store.init(AUGUST_20 + 1_000)
    expect(await readFile(store.ledgerPath, 'utf8')).toBe(before)
    const snapshot = await store.snapshot(undefined, 0, AUGUST_20)
    expect(snapshot).toMatchObject({
      trackingSince: '2026-08-20',
      keyConfigured: false,
      days: [],
      revision: 0,
    })
  })

  it('shows only the current key and current Beijing month while retaining older rows', async () => {
    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    await Promise.all([
      store.append(input(KEY_A, AUGUST_20, 100n)),
      store.append(input(KEY_A, AUGUST_20 + 1_000, 200n)),
      store.append(input(KEY_B, AUGUST_20, 900n)),
      store.append(input(KEY_A, Date.UTC(2026, 6, 20, 4), 800n)),
    ])

    const a = await store.snapshot(KEY_A, 4, AUGUST_20)
    expect(a.days).toEqual([{
      date: '2026-08-20',
      cacheHitInputTokens: 20,
      cacheMissInputTokens: 40,
      outputTokens: 60,
      totalTokens: 120,
      cacheHitInputCostNanoyuan: '30',
      cacheMissInputCostNanoyuan: '60',
      outputCostNanoyuan: '210',
      costNanoyuan: '300',
      unpricedTokens: 0,
    }])
    expect(a.total).toMatchObject({
      totalTokens: 120,
      cacheHitInputCostNanoyuan: '30',
      cacheMissInputCostNanoyuan: '60',
      outputCostNanoyuan: '210',
      costNanoyuan: '300',
    })
    expect(a.revision).toBe(4)

    const b = await store.snapshot(KEY_B, 4, AUGUST_20)
    expect(b.total).toMatchObject({ totalTokens: 60, costNanoyuan: '900' })
    const raw = await readFile(store.ledgerPath, 'utf8')
    const ledger = JSON.parse(raw) as { records: unknown[] }
    expect(ledger.records).toHaveLength(4)
  })

  it('accepts older schema-v1 rows without inventing a category breakdown', async () => {
    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    await store.append(input(KEY_A, AUGUST_20, 100n))
    const legacy = JSON.parse(await readFile(store.ledgerPath, 'utf8')) as {
      records: Array<Record<string, unknown>>
    }
    const record = legacy.records[0]!
    delete record.cacheHitInputCostNanoyuan
    delete record.cacheMissInputCostNanoyuan
    delete record.outputCostNanoyuan
    await writeFile(store.ledgerPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    expect((await store.snapshot(KEY_A, 1, AUGUST_20)).days[0]).toMatchObject({
      cacheHitInputCostNanoyuan: null,
      cacheMissInputCostNanoyuan: null,
      outputCostNanoyuan: null,
      costNanoyuan: '100',
    })
  })

  it('recovers legacy category costs only from an exact matching tariff', async () => {
    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    const usage = {
      cacheHitInputTokens: 10,
      cacheMissInputTokens: 20,
      outputTokens: 30,
      cacheWriteTokens: 0,
    }
    await store.append(ledgerInput({
      keyFingerprint: KEY_A,
      model: 'deepseek-v4-flash',
      occurredAt: AUGUST_20,
      purpose: 'conversation',
      usage,
    }, priceUsage(EMBEDDED_PRICE_TABLE, 'deepseek-v4-flash', usage, AUGUST_20, true)))
    const legacy = JSON.parse(await readFile(store.ledgerPath, 'utf8')) as {
      records: Array<Record<string, unknown>>
    }
    const record = legacy.records[0]!
    delete record.cacheHitInputCostNanoyuan
    delete record.cacheMissInputCostNanoyuan
    delete record.outputCostNanoyuan
    await writeFile(store.ledgerPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    expect((await store.snapshot(KEY_A, 1, AUGUST_20, [EMBEDDED_PRICE_TABLE])).days[0]).toMatchObject({
      cacheHitInputCostNanoyuan: '200',
      cacheMissInputCostNanoyuan: '20000',
      outputCostNanoyuan: '120000',
      costNanoyuan: '140200',
    })
  })

  it('retains the prior tariff only for exact legacy category recovery', async () => {
    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    const legacyTable = RECOVERABLE_PRICE_TABLES[0]!
    const usage = {
      cacheHitInputTokens: 10,
      cacheMissInputTokens: 20,
      outputTokens: 30,
      cacheWriteTokens: 0,
    }
    await store.append(ledgerInput({
      keyFingerprint: KEY_A,
      model: 'deepseek-v4-flash',
      occurredAt: AUGUST_20,
      purpose: 'conversation',
      usage,
    }, priceUsage(legacyTable, 'deepseek-v4-flash', usage, AUGUST_20, true)))
    const ledger = JSON.parse(await readFile(store.ledgerPath, 'utf8')) as {
      records: Array<Record<string, unknown>>
    }
    delete ledger.records[0]!.cacheHitInputCostNanoyuan
    delete ledger.records[0]!.cacheMissInputCostNanoyuan
    delete ledger.records[0]!.outputCostNanoyuan
    await writeFile(store.ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')

    expect((await store.snapshot(KEY_A, 1, AUGUST_20, RECOVERABLE_PRICE_TABLES)).days[0]).toMatchObject({
      cacheHitInputCostNanoyuan: '500',
      cacheMissInputCostNanoyuan: '30000',
      outputCostNanoyuan: '135000',
      costNanoyuan: '165500',
    })
  })

  it('preserves incompatible data and fails instead of partially migrating it', async () => {
    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    const incompatible = '{"schemaVersion":2,"trackingSince":"2026-08-20","records":[]}\n'
    await writeFile(store.ledgerPath, incompatible, 'utf8')
    await expect(store.init(AUGUST_20)).rejects.toThrow(/migration is required/)
    expect(await readFile(store.ledgerPath, 'utf8')).toBe(incompatible)
  })

  it.each([
    ['non-object ledger', null, /not a versioned ledger object/],
    ['invalid tracking date', { schemaVersion: 1, trackingSince: 'August 20', records: [] }, /invalid trackingSince/],
    ['non-array records', { schemaVersion: 1, trackingSince: '2026-08-20', records: {} }, /invalid records/],
    ['non-object request', { schemaVersion: 1, trackingSince: '2026-08-20', records: [null] }, /invalid request record/],
    ['negative token count', { schemaVersion: 1, trackingSince: '2026-08-20', records: [record({ outputTokens: -1 })] }, /invalid token count/],
    ['invalid request metadata', { schemaVersion: 1, trackingSince: '2026-08-20', records: [record({ requestId: '' })] }, /invalid request metadata/],
    ['incomplete breakdown', {
      schemaVersion: 1,
      trackingSince: '2026-08-20',
      records: [record({ cacheMissInputCostNanoyuan: undefined })],
    }, /incomplete cost breakdown/],
    ['invalid breakdown', {
      schemaVersion: 1,
      trackingSince: '2026-08-20',
      records: [record({ cacheHitInputCostNanoyuan: '-1' })],
    }, /invalid cost breakdown/],
    ['mismatched breakdown total', {
      schemaVersion: 1,
      trackingSince: '2026-08-20',
      records: [record({ cacheHitInputCostNanoyuan: '1' })],
    }, /cost breakdown does not equal total/],
  ])('rejects a %s without rewriting it', async (_label, value, expected) => {
    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    const text = `${JSON.stringify(value)}\n`
    await writeFile(store.ledgerPath, text, 'utf8')

    await expect(store.init(AUGUST_20)).rejects.toThrow(expected)
    expect(await readFile(store.ledgerPath, 'utf8')).toBe(text)
  })

  it('preserves malformed JSON and non-ENOENT read failures', async () => {
    const malformed = new UsageLedgerStore(home)
    await malformed.init(AUGUST_20)
    await writeFile(malformed.ledgerPath, '{', 'utf8')
    await expect(malformed.init(AUGUST_20)).rejects.toThrow(/cannot parse/)
    expect(await readFile(malformed.ledgerPath, 'utf8')).toBe('{')

    const otherHome = join(home, 'other')
    const unreadable = new UsageLedgerStore(otherHome)
    await mkdir(unreadable.ledgerPath, { recursive: true })
    await expect(unreadable.init(AUGUST_20)).rejects.toThrow()
  })

  it('serializes racing initialization through the atomic ledger lock', async () => {
    const first = new UsageLedgerStore(home)
    const second = new UsageLedgerStore(home)

    await Promise.all([first.init(AUGUST_20), second.init(AUGUST_20 + 86_400_000)])

    const snapshot = await first.snapshot(undefined, 0, AUGUST_20)
    expect(snapshot.trackingSince).toMatch(/^2026-08-2[01]$/u)
  })

  it('aggregates multiple days and keeps unavailable legacy details unavailable', async () => {
    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    const zeroLegacy = record({
      requestId: 'zero-legacy',
      cacheHitInputTokens: 0,
      cacheMissInputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      costNanoyuan: '0',
    })
    delete zeroLegacy.cacheHitInputCostNanoyuan
    delete zeroLegacy.cacheMissInputCostNanoyuan
    delete zeroLegacy.outputCostNanoyuan
    const nonzeroLegacy = record({ requestId: 'nonzero-legacy' })
    delete nonzeroLegacy.cacheHitInputCostNanoyuan
    delete nonzeroLegacy.cacheMissInputCostNanoyuan
    delete nonzeroLegacy.outputCostNanoyuan
    const nextDay = record({
      requestId: 'next-day',
      occurredAt: new Date(AUGUST_20 + 86_400_000).toISOString(),
      date: '2026-08-21',
    })
    await replaceLedger(store, [zeroLegacy, nonzeroLegacy, nextDay])

    const snapshot = await store.snapshot(KEY_A, 3, AUGUST_20)

    expect(snapshot.days.map(day => day.date)).toEqual(['2026-08-20', '2026-08-21'])
    expect(snapshot.days[0]).toMatchObject({
      cacheHitInputCostNanoyuan: null,
      cacheMissInputCostNanoyuan: null,
      outputCostNanoyuan: null,
    })
    expect(snapshot.total.cacheHitInputCostNanoyuan).toBeNull()
  })

  it('does not reconstruct legacy details when the matching tariff disagrees with the stored total', async () => {
    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    const legacy = record({ priceVersion: EMBEDDED_PRICE_TABLE.version, costNanoyuan: '1' })
    delete legacy.cacheHitInputCostNanoyuan
    delete legacy.cacheMissInputCostNanoyuan
    delete legacy.outputCostNanoyuan
    await replaceLedger(store, [legacy])

    expect((await store.snapshot(KEY_A, 1, AUGUST_20, [EMBEDDED_PRICE_TABLE])).days[0]).toMatchObject({
      cacheHitInputCostNanoyuan: null,
      cacheMissInputCostNanoyuan: null,
      outputCostNanoyuan: null,
    })
  })

  it('persists null category costs for unpriced requests', async () => {
    const usage = {
      cacheHitInputTokens: 1,
      cacheMissInputTokens: 2,
      outputTokens: 3,
      cacheWriteTokens: 4,
    }

    const unpriced = ledgerInput({
      keyFingerprint: KEY_A,
      model: 'custom-model',
      occurredAt: AUGUST_20,
      purpose: 'conversation',
      usage,
    }, {
      cacheHitInputCostNanoyuan: null,
      cacheMissInputCostNanoyuan: null,
      outputCostNanoyuan: null,
      costNanoyuan: 0n,
      unpricedTokens: 10,
      priceVersion: null,
    })
    expect(unpriced).toMatchObject({
      cacheHitInputCostNanoyuan: null,
      cacheMissInputCostNanoyuan: null,
      outputCostNanoyuan: null,
      unpricedTokens: 10,
    })

    const store = new UsageLedgerStore(home)
    await store.init(AUGUST_20)
    await store.append(unpriced)
    expect((await store.snapshot(KEY_A, 1, AUGUST_20)).total.unpricedTokens).toBe(10)
  })

  it('recovers only the affected default-Messages rows without rewriting the ledger', async () => {
    const usage = {
      cacheHitInputTokens: 10,
      cacheMissInputTokens: 20,
      outputTokens: 30,
      cacheWriteTokens: 4,
    }
    const affected = (keyFingerprint: string, model: string, occurredAt: number) => ledgerInput({
      keyFingerprint,
      model,
      occurredAt,
      purpose: 'conversation',
      usage,
    }, priceUsage(EMBEDDED_PRICE_TABLE, model, usage, occurredAt, false))
    const store = new UsageLedgerStore(home)
    await store.init(SEPTEMBER_15)
    await store.append(affected(KEY_A, 'deepseek-flash', SEPTEMBER_15))
    await store.append(affected(KEY_B, 'deepseek-flash', SEPTEMBER_15))
    await store.append(affected(KEY_A, 'custom-model', SEPTEMBER_15))
    await store.append(affected(KEY_A, 'deepseek-flash', AUGUST_20))

    const before = await readFile(store.ledgerPath, 'utf8')
    const wrongVersion = { ...EMBEDDED_PRICE_TABLE, version: 'future-price-version' }

    expect((await store.snapshot(KEY_A, 1, SEPTEMBER_15, [wrongVersion], true)).total).toMatchObject({
      costNanoyuan: '0',
      unpricedTokens: 128,
    })

    expect((await store.snapshot(KEY_A, 1, SEPTEMBER_15, [EMBEDDED_PRICE_TABLE], true)).total).toMatchObject({
      totalTokens: 128,
      cacheHitInputCostNanoyuan: null,
      cacheMissInputCostNanoyuan: null,
      outputCostNanoyuan: null,
      costNanoyuan: '280400',
      unpricedTokens: 68,
    })
    expect((await store.snapshot(KEY_B, 1, SEPTEMBER_15)).total).toMatchObject({
      costNanoyuan: '0',
      unpricedTokens: 64,
    })
    expect(await readFile(store.ledgerPath, 'utf8')).toBe(before)
  })
})
