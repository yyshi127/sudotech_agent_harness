import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMBEDDED_PRICE_TABLE, priceUsage } from '../src/pricing.ts'
import { ledgerInput, UsageLedgerStore } from '../src/store.ts'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)
const AUGUST_20 = Date.UTC(2026, 7, 20, 4)
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
})
