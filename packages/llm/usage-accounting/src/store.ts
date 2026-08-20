/** Versioned append ledger and current-key monthly projection. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { beijingClock, priceUsage } from './pricing.ts'
import type { PricedUsage, PriceTable, UsageBuckets } from './pricing.ts'
import type { UsageAccountingDay, UsageAccountingSnapshot } from './types.ts'

const SCHEMA_VERSION = 1
const FILE_MODE = 0o600
const DIR_MODE = 0o700

/** One immutable settlement persisted at the price version active for the request. */
export interface UsageLedgerRecord extends UsageBuckets {
  requestId: string
  keyFingerprint: string
  occurredAt: string
  date: string
  model: string
  purpose: 'conversation' | 'compaction' | 'session-title'
  priceVersion: string | null
  cacheHitInputCostNanoyuan?: string | null
  cacheMissInputCostNanoyuan?: string | null
  outputCostNanoyuan?: string | null
  costNanoyuan: string
  unpricedTokens: number
}

interface UsageLedger {
  schemaVersion: 1
  trackingSince: string
  records: UsageLedgerRecord[]
}

function emptyDay(date: string): UsageAccountingDay {
  return {
    date,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitInputCostNanoyuan: '0',
    cacheMissInputCostNanoyuan: '0',
    outputCostNanoyuan: '0',
    costNanoyuan: '0',
    unpricedTokens: 0,
  }
}

const COST_DETAIL_FIELDS = [
  'cacheHitInputCostNanoyuan',
  'cacheMissInputCostNanoyuan',
  'outputCostNanoyuan',
] as const

function isNanoyuanString(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
}

function addCostDetail(current: string | null, next: string | null | undefined, tokenCount: number): string | null {
  if (current === null) return null
  if (next === null || next === undefined) return tokenCount === 0 ? current : null
  return String(BigInt(current) + BigInt(next))
}

function resolvedCostDetail(
  record: UsageLedgerRecord,
  priceTables: readonly PriceTable[],
): Pick<UsageLedgerRecord,
  'cacheHitInputCostNanoyuan' | 'cacheMissInputCostNanoyuan' | 'outputCostNanoyuan'> {
  if (COST_DETAIL_FIELDS.some(field => Object.hasOwn(record, field))) return record
  const table = priceTables.find(candidate => candidate.version === record.priceVersion)
  if (table === undefined) return record
  const priced = priceUsage(table, record.model, record, Date.parse(record.occurredAt), true)
  if (priced.costNanoyuan !== BigInt(record.costNanoyuan)
    || priced.unpricedTokens !== record.unpricedTokens
    || priced.cacheHitInputCostNanoyuan === null
    || priced.cacheMissInputCostNanoyuan === null
    || priced.outputCostNanoyuan === null) return record
  return {
    cacheHitInputCostNanoyuan: String(priced.cacheHitInputCostNanoyuan),
    cacheMissInputCostNanoyuan: String(priced.cacheMissInputCostNanoyuan),
    outputCostNanoyuan: String(priced.outputCostNanoyuan),
  }
}

function parseLedger(text: string, filename: string): UsageLedger {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`usage-accounting: cannot parse ${filename}; preserve the file and repair or migrate it`, { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`usage-accounting: ${filename} is not a versioned ledger object`)
  }
  const ledger = value as Partial<UsageLedger>
  if (ledger.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`usage-accounting: unsupported ledger schemaVersion in ${filename}; migration is required`)
  }
  if (typeof ledger.trackingSince !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ledger.trackingSince)) {
    throw new Error(`usage-accounting: invalid trackingSince in ${filename}`)
  }
  if (!Array.isArray(ledger.records)) throw new Error(`usage-accounting: invalid records in ${filename}`)
  for (const record of ledger.records) validateRecord(record, filename)
  return ledger as UsageLedger
}

function validateRecord(value: unknown, filename: string): asserts value is UsageLedgerRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`usage-accounting: invalid request record in ${filename}`)
  }
  const record = value as Record<string, unknown>
  const integerFields = [
    'cacheHitInputTokens', 'cacheMissInputTokens', 'outputTokens', 'cacheWriteTokens', 'unpricedTokens',
  ]
  if (integerFields.some(field => !Number.isSafeInteger(record[field]) || Number(record[field]) < 0)) {
    throw new Error(`usage-accounting: invalid token count in ${filename}`)
  }
  if (typeof record.requestId !== 'string' || record.requestId.length === 0
    || typeof record.keyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(record.keyFingerprint)
    || typeof record.occurredAt !== 'string' || !Number.isFinite(Date.parse(record.occurredAt))
    || typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)
    || typeof record.model !== 'string' || record.model.length === 0
    || !['conversation', 'compaction', 'session-title'].includes(String(record.purpose))
    || !(record.priceVersion === null || typeof record.priceVersion === 'string')
    || typeof record.costNanoyuan !== 'string' || !/^(0|[1-9]\d*)$/.test(record.costNanoyuan)) {
    throw new Error(`usage-accounting: invalid request metadata in ${filename}`)
  }
  const hasDetail = COST_DETAIL_FIELDS.map(field => Object.hasOwn(record, field))
  if (hasDetail.some(Boolean) && !hasDetail.every(Boolean)) {
    throw new Error(`usage-accounting: incomplete cost breakdown in ${filename}`)
  }
  if (hasDetail.every(Boolean)) {
    const detail = COST_DETAIL_FIELDS.map(field => record[field])
    if (!detail.every(value => value === null)) {
      if (!detail.every(isNanoyuanString)) {
        throw new Error(`usage-accounting: invalid cost breakdown in ${filename}`)
      }
      const detailTotal = detail.reduce((sum, value) => sum + BigInt(value), 0n)
      if (detailTotal !== BigInt(record.costNanoyuan)) {
        throw new Error(`usage-accounting: cost breakdown does not equal total in ${filename}`)
      }
    }
  }
}

async function readOptional(filename: string): Promise<string | undefined> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function render(ledger: UsageLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`
}

/** Durable ledger rooted below the fixed Harness home. */
export class UsageLedgerStore {
  /** Accounting storage directory. */
  readonly root: string
  /** Schema-v1 request ledger path. */
  readonly ledgerPath: string

  /** @param dshHome - fixed Harness data directory. */
  constructor(dshHome: string) {
    this.root = join(dshHome, 'usage-accounting')
    this.ledgerPath = join(this.root, 'usage-v1.json')
  }

  /**
   * Create the root and validate or initialize the ledger without rewriting existing data.
   * @param now - initialization timestamp used only for a new ledger.
   */
  async init(now = Date.now()): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: DIR_MODE })
    const existing = await readOptional(this.ledgerPath)
    if (existing !== undefined) {
      parseLedger(existing, this.ledgerPath)
      return
    }
    await withFileLock(this.ledgerPath, async () => {
      const raced = await readOptional(this.ledgerPath)
      if (raced !== undefined) {
        parseLedger(raced, this.ledgerPath)
        return
      }
      const ledger: UsageLedger = {
        schemaVersion: SCHEMA_VERSION,
        trackingSince: beijingClock(now).date,
        records: [],
      }
      await writeFileAtomic(this.ledgerPath, render(ledger), { mode: FILE_MODE, dirMode: DIR_MODE })
    })
  }

  /**
   * Append one request under a cross-process read/modify/write lock.
   * @param input - validated request fields before request-id assignment.
   */
  async append(input: Omit<UsageLedgerRecord, 'requestId'>): Promise<void> {
    await withFileLock(this.ledgerPath, async () => {
      const text = await readFile(this.ledgerPath, 'utf8')
      const ledger = parseLedger(text, this.ledgerPath)
      const record: UsageLedgerRecord = { requestId: randomUUID(), ...input }
      validateRecord(record, this.ledgerPath)
      const next: UsageLedger = { ...ledger, records: [...ledger.records, record] }
      await writeFileAtomic(this.ledgerPath, render(next), { mode: FILE_MODE, dirMode: DIR_MODE })
    })
  }

  /**
   * Read the current-key current-month aggregate directly from the atomic file.
   * @param keyFingerprint - current key fingerprint, or undefined when unconfigured.
   * @param revision - process-local committed revision exposed to the client.
   * @param now - timestamp selecting the current Beijing month and day.
   * @param priceTables - exact tariff versions allowed to recover legacy category costs.
   * @returns current-key monthly usage snapshot.
   */
  async snapshot(
    keyFingerprint: string | undefined,
    revision: number,
    now = Date.now(),
    priceTables: readonly PriceTable[] = [],
  ): Promise<UsageAccountingSnapshot> {
    const ledger = parseLedger(await readFile(this.ledgerPath, 'utf8'), this.ledgerPath)
    const clock = beijingClock(now)
    const byDate = new Map<string, UsageAccountingDay>()
    if (keyFingerprint !== undefined) {
      for (const record of ledger.records) {
        if (record.keyFingerprint !== keyFingerprint || !record.date.startsWith(`${clock.month}-`)) continue
        const row = byDate.get(record.date) ?? emptyDay(record.date)
        row.cacheHitInputTokens += record.cacheHitInputTokens
        row.cacheMissInputTokens += record.cacheMissInputTokens
        row.outputTokens += record.outputTokens
        row.totalTokens += record.cacheHitInputTokens + record.cacheMissInputTokens
          + record.outputTokens + record.cacheWriteTokens
        const detail = resolvedCostDetail(record, priceTables)
        row.cacheHitInputCostNanoyuan = addCostDetail(
          row.cacheHitInputCostNanoyuan,
          detail.cacheHitInputCostNanoyuan,
          record.cacheHitInputTokens,
        )
        row.cacheMissInputCostNanoyuan = addCostDetail(
          row.cacheMissInputCostNanoyuan,
          detail.cacheMissInputCostNanoyuan,
          record.cacheMissInputTokens,
        )
        row.outputCostNanoyuan = addCostDetail(
          row.outputCostNanoyuan,
          detail.outputCostNanoyuan,
          record.outputTokens,
        )
        row.costNanoyuan = String(BigInt(row.costNanoyuan) + BigInt(record.costNanoyuan))
        row.unpricedTokens += record.unpricedTokens
        byDate.set(record.date, row)
      }
    }
    const days = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
    const total = days.reduce((sum, day) => ({
      date: clock.month,
      cacheHitInputTokens: sum.cacheHitInputTokens + day.cacheHitInputTokens,
      cacheMissInputTokens: sum.cacheMissInputTokens + day.cacheMissInputTokens,
      outputTokens: sum.outputTokens + day.outputTokens,
      totalTokens: sum.totalTokens + day.totalTokens,
      cacheHitInputCostNanoyuan: addCostDetail(
        sum.cacheHitInputCostNanoyuan,
        day.cacheHitInputCostNanoyuan,
        day.cacheHitInputTokens,
      ),
      cacheMissInputCostNanoyuan: addCostDetail(
        sum.cacheMissInputCostNanoyuan,
        day.cacheMissInputCostNanoyuan,
        day.cacheMissInputTokens,
      ),
      outputCostNanoyuan: addCostDetail(
        sum.outputCostNanoyuan,
        day.outputCostNanoyuan,
        day.outputTokens,
      ),
      costNanoyuan: String(BigInt(sum.costNanoyuan) + BigInt(day.costNanoyuan)),
      unpricedTokens: sum.unpricedTokens + day.unpricedTokens,
    }), emptyDay(clock.month))
    return {
      revision,
      month: clock.month,
      today: clock.date,
      trackingSince: ledger.trackingSince,
      keyConfigured: keyFingerprint !== undefined,
      days,
      total,
    }
  }
}

/**
 * Build one ledger input from request metadata, provider usage, and fixed pricing.
 * @param observation - request identity, timing, purpose, and token buckets.
 * @param priced - cost fixed with the active request-time tariff.
 * @returns durable record fields before request-id assignment.
 */
export function ledgerInput(
  observation: {
    keyFingerprint: string
    model: string
    occurredAt: number
    purpose: UsageLedgerRecord['purpose']
    usage: UsageBuckets
  },
  priced: PricedUsage,
): Omit<UsageLedgerRecord, 'requestId'> {
  return {
    keyFingerprint: observation.keyFingerprint,
    occurredAt: new Date(observation.occurredAt).toISOString(),
    date: beijingClock(observation.occurredAt).date,
    model: observation.model,
    purpose: observation.purpose,
    ...observation.usage,
    priceVersion: priced.priceVersion,
    cacheHitInputCostNanoyuan: priced.cacheHitInputCostNanoyuan === null
      ? null
      : String(priced.cacheHitInputCostNanoyuan),
    cacheMissInputCostNanoyuan: priced.cacheMissInputCostNanoyuan === null
      ? null
      : String(priced.cacheMissInputCostNanoyuan),
    outputCostNanoyuan: priced.outputCostNanoyuan === null
      ? null
      : String(priced.outputCostNanoyuan),
    costNanoyuan: String(priced.costNanoyuan),
    unpricedTokens: priced.unpricedTokens,
  }
}
