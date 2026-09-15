/** Host-private full-settlement intents; transport receipts remain separate from balance observations. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import { openItemQuerySchema, type OpenItemResult } from './open-items.ts'
import type { ReferenceResult } from './references.ts'
import { selectOpenItemWriteOffTarget, validateOpenItemWriteOff, writeOffPreflightStageSchema,
  type OpenItemWriteOffInput, type OpenItemWriteOffOutcome } from './open-item-write-off.ts'
import { OpenItemTargetClaims, type OpenItemClaimTarget } from './open-item-target-claims.ts'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const identifier = z.string().regex(/^[1-9]\d*$/)
const money = z.string().regex(/^-?\d+\.\d{2}$/).nullable()
const amounts = { amount: money, balance: money, baseAmount: money, baseBalance: money,
  settledAmount: money, badDebtAmount: money, offsetAmount: money, returnAmount: money }
const currencies = { currencyCode: z.string(), baseCurrencyCode: z.string() }
const ledger = { accountId: identifier, accountName: z.string().min(1) }
const page = z.strictObject({ ...ledger, selection: openItemQuerySchema, totalCount: z.number().int().nonnegative(),
  rows: z.array(z.strictObject({ ...amounts, ...currencies, id: identifier, date: z.iso.date(), summary: z.string(),
    subjectCode: z.string(), subjectName: z.string(), auxiliaryItemIds: z.string(), auxiliaryItemName: z.string(),
    initialBalance: z.boolean().nullable(), finished: z.boolean().nullable(), categoryName: z.string(), remark: z.string() })),
  summaries: z.array(z.strictObject({ ...amounts, ...currencies, kind: z.enum(['total', 'previous-page']) })),
  coverage: z.literal('unverified'), notice: z.string(),
}).refine(value => new Set(value.rows.map(row => row.id)).size === value.rows.length
  && value.rows.length <= value.selection.pageSize && value.rows.length <= value.totalCount
  && (value.rows.length === 0 || BigInt(value.selection.page - 1) * BigInt(value.selection.pageSize)
    + BigInt(value.rows.length) <= BigInt(value.totalCount)))
const cash = z.strictObject({ ...ledger, kind: z.literal('cash-accounts'), requestedLimit: z.number().int().positive(),
  returnedCount: z.number().int().nonnegative(), coverage: z.literal('unverified'), selection: z.literal('not-requested'),
  rows: z.array(z.strictObject({ id: identifier, code: z.string(), name: z.string(),
    status: z.enum(['enabled', 'disabled', 'unknown']), directionRaw: z.string().optional(),
    currencyId: z.string().optional(), accountType: z.number().int().optional() })), notice: z.string(),
}).refine(value => value.returnedCount === value.rows.length && value.rows.length <= value.requestedLimit
  && new Set(value.rows.map(row => row.id)).size === value.rows.length)

/** Original source and cash references; missing business-account identity permits inspection, never reservation. */
export interface OpenItemWriteOffEvidence {
  input: OpenItemWriteOffInput
  source: OpenItemResult
  cashAccounts: ReferenceResult
  businessAccountId?: Branded<'FinanceReferenceId'>
}

function evidenceSchema(maxBytes: number) {
  const fields = z.strictObject({ input: z.unknown(), source: page, cashAccounts: cash,
    businessAccountId: identifier.refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)).optional() })
  // Preserve original property order: the sender compares the complete serialized source and cash references.
  return z.custom<OpenItemWriteOffEvidence>((value) => {
    const result = fields.safeParse(value)
    if (!result.success) return false
    try {
      const input = validateOpenItemWriteOff(result.data.input, maxBytes)
      const source = result.data.source as OpenItemResult
      const accounts = result.data.cashAccounts
      selectOpenItemWriteOffTarget(input, source, { id: source.accountId, name: source.accountName })
      const targetCash = accounts.rows.find(row => row.id === input.cashAccountId)
      return accounts.accountId === source.accountId && accounts.accountName === source.accountName
        && targetCash?.status === 'enabled' && Boolean(targetCash.currencyId)
    } catch {
      // Durable JSON with an invalid intent or ineligible projected target cannot become a send reservation.
      return false
    }
  }, '核销原始记录、金额或资金账户不一致。')
}
const outcome = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('accepted'), receiptId: z.string().regex(/^[1-9]\d{0,199}$/) }),
  z.strictObject({ state: z.literal('rejected'), code: z.number().int().min(200).max(299) }),
  z.strictObject({ state: z.literal('outcome-unknown') }),
  z.strictObject({ state: z.literal('not-sent'), reason: z.enum(['preflight-failed', 'cancelled']),
    preflightStage: writeOffPreflightStageSchema.optional() }),
])
const metadata = z.strictObject({ schemaVersion: z.literal(1), id: z.uuid(), ownerDigest: digest,
  configurationDigest: digest, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  phase: z.enum(['prepared', 'outcome-unknown', 'accepted', 'rejected', 'not-sent']), outcome: outcome.optional(),
})
/** Local write-off ID, distinct from both the vendor open-item and receipt IDs. */
export type OpenItemWriteOffId = Branded<'OpenItemWriteOffId'>
/** Immutable reserved evidence with one transport observation; no readback can release the target claim. */
export type OpenItemWriteOffRecord = Omit<z.infer<typeof metadata>, 'id' | 'outcome'> & {
  id: OpenItemWriteOffId
  evidence: OpenItemWriteOffEvidence
  outcome?: OpenItemWriteOffOutcome
}

/** Serializes local deletion/write-off sends for one target across sessions; remote writers remain outside this claim. */
export class OpenItemWriteOffRecords {
  private readonly ownerDigest: string
  private readonly directory: string
  private readonly schema
  private readonly claims: OpenItemTargetClaims

  /**
   * @param root - Host-private write-off record root.
   * @param owner - Host-derived client/environment/ledger identity.
   * @param maxBytes - Complete record cap, including the largest accepted receipt.
   * @param targetClaimsRoot - Host-private target-claim root shared with deletion records.
   */
  constructor(root: string, owner: string, private readonly maxBytes: number, targetClaimsRoot: string) {
    this.ownerDigest = hash(owner)
    this.directory = join(root, this.ownerDigest)
    this.schema = metadata.extend({ evidence: evidenceSchema(maxBytes) }).refine(value => value.outcome === undefined
      ? value.phase === 'prepared' || value.phase === 'outcome-unknown' : value.phase === value.outcome.state)
    this.claims = new OpenItemTargetClaims(targetClaimsRoot, owner, maxBytes)
  }

  private path(id: OpenItemWriteOffId): string { return join(this.directory, `${z.uuid().parse(id)}.json`) }
  private target(record: OpenItemWriteOffRecord): OpenItemClaimTarget {
    return { ledgerId: record.evidence.source.accountId, openItemId: record.evidence.input.openItemId }
  }
  private encode(value: unknown): string {
    const data = JSON.stringify(value) + '\n'
    if (Buffer.byteLength(data) > this.maxBytes) throw new Error('核销记录超过大小限制。')
    return data
  }
  private async load(path: string): Promise<unknown> {
    const data = await readFile(path)
    if (data.length > this.maxBytes) throw new Error('核销记录超过大小限制。')
    return JSON.parse(data.toString('utf8'))
  }
  private save(record: OpenItemWriteOffRecord): Promise<void> {
    return writeFileAtomic(this.path(record.id), this.encode(record), { mode: 0o600, dirMode: 0o700 })
  }
  private requirePrepared(record: OpenItemWriteOffRecord, version: number, configurationDigest: string): void {
    if (record.phase !== 'prepared' || record.version !== version) throw new Error('核销版本已变化或已有发送意图，不得重发。')
    if (record.configurationDigest !== configurationDigest) throw new Error('账套配置已变化，请重新预览确认。')
  }

  /**
   * Restore original evidence without releasing an existing send claim.
   * @param id - Local operation owned by the current client/environment/ledger.
   * @returns Validated original evidence and receipt; corrupt or foreign records reject without repair.
   */
  async read(id: OpenItemWriteOffId): Promise<OpenItemWriteOffRecord> {
    const record = this.schema.parse(await this.load(this.path(id)))
    if (record.id !== id || record.ownerDigest !== this.ownerDigest) throw new Error('核销记录归属不一致。')
    return record as OpenItemWriteOffRecord
  }

  /**
   * Persist an unsent preview without reserving its business target.
   * @param evidence - Original positive full-balance intent, source page and cash references.
   * @param configurationDigest - Host-derived configuration identity, never credentials.
   * @returns Unsent version one; this does not qualify raw eligibility or grant consent.
   */
  async create(evidence: OpenItemWriteOffEvidence, configurationDigest: string): Promise<OpenItemWriteOffRecord> {
    const record = this.schema.parse({ schemaVersion: 1, id: randomUUID(), ownerDigest: this.ownerDigest,
      configurationDigest, version: 1, evidence, phase: 'prepared' }) as OpenItemWriteOffRecord
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.save(record)
    return record
  }

  /**
   * Replace only an unsent preview, invalidating its previous confirmation.
   * @param id - Unsent local operation.
   * @param version - Current preview version; stale confirmations reject.
   * @param evidence - Complete replacement, including any changed target, amount, date or cash account.
   * @param configurationDigest - Host-derived configuration identity for the new preview.
   * @returns Incremented unsent version; reserved versions cannot be revised.
   */
  async revise(id: OpenItemWriteOffId, version: number, evidence: OpenItemWriteOffEvidence,
    configurationDigest: string): Promise<OpenItemWriteOffRecord> {
    return withFileLock(this.path(id) + '.lock', async () => {
      const original = await this.read(id)
      this.requirePrepared(original, version, original.configurationDigest)
      const record = this.schema.parse({ ...original, evidence, configurationDigest, version: version + 1 }) as OpenItemWriteOffRecord
      await this.save(record)
      return record
    })
  }

  /**
   * Consume the target's local send allowance only after exact-version authorization.
   * @param id - Prepared local write-off operation.
   * @param version - Exact version presented for mandatory confirmation.
   * @param configurationDigest - Current Host configuration identity.
   * @param authorize - Fresh state, currency and known-link checks, period-limit disclosure and exact consent; never dispatches.
   * @returns Durable uncertain reservation before dispatch; torn claims block retries after restart.
   */
  async reserve(id: OpenItemWriteOffId, version: number, configurationDigest: string,
    authorize: (record: OpenItemWriteOffRecord) => Promise<void>): Promise<OpenItemWriteOffRecord> {
    const preview = await this.read(id)
    this.requirePrepared(preview, version, configurationDigest)
    if (preview.evidence.businessAccountId === undefined) throw new Error('核销记录缺少原始业务账户身份，请重新预览。')
    const original = JSON.stringify(preview)
    const { accountId: ledgerId } = preview.evidence.source
    const { openItemId } = preview.evidence.input
    const target = { ledgerId, openItemId }
    await authorize(preview)
    return this.claims.withLock(target, async () => withFileLock(this.path(id) + '.lock', async () => {
      const record = await this.read(id)
      this.requirePrepared(record, version, configurationDigest)
      if (JSON.stringify(record) !== original) throw new Error('核销内容已变化，请重新确认。')
      const priorClaim = await this.claims.read(target)
      if (priorClaim !== undefined) {
        throw new Error(priorClaim.operation === 'write-off' ? '该往来已有核销发送意图，请只读核查原记录。'
          : '该往来已有删除发送意图，请只读核查原记录。')
      }
      const reserved: OpenItemWriteOffRecord = { ...record, phase: 'outcome-unknown' }
      this.encode({ ...reserved, phase: 'accepted', outcome: { state: 'accepted', receiptId: '9'.repeat(200) } })
      // A claim without its matching uncertain record is deliberately not recoverable into another send.
      await this.claims.create(target, { id, operation: 'write-off', direction: record.evidence.input.direction })
      await this.save(reserved)
      return reserved
    }))
  }

  /**
   * Append one transport observation without changing the original settlement expectation.
   * @param id - Reserved local operation.
   * @param version - Exact reserved version.
   * @param observation - One sanitized transport result; receiptId never becomes a journal ID.
   * @returns Original evidence plus the result; accepted/unknown claims remain consumed even if balances match.
   */
  async recordOutcome(id: OpenItemWriteOffId, version: number, observation: OpenItemWriteOffOutcome): Promise<OpenItemWriteOffRecord> {
    const sanitized = outcome.parse(observation)
    const preview = await this.read(id)
    const target = this.target(preview)
    return this.claims.withLock(target, async () => withFileLock(this.path(id) + '.lock', async () => {
      const current = await this.read(id)
      if (current.phase !== 'outcome-unknown' || current.version !== version || current.outcome !== undefined) {
        throw new Error('核销回执不属于尚未记录结果的准确发送版本。')
      }
      if (JSON.stringify(this.target(current)) !== JSON.stringify(target)) {
        throw new Error('核销目标已变化，不能记录回执。')
      }
      const claim = await this.claims.read(target)
      if (claim === undefined || claim.id !== id || claim.operation !== 'write-off'
        || claim.direction !== current.evidence.input.direction) {
        throw new Error('核销目标占用记录不一致，不能记录回执。')
      }
      const record = this.schema.parse({ ...current, phase: sanitized.state, outcome: sanitized }) as OpenItemWriteOffRecord
      await this.save(record)
      if (sanitized.state === 'rejected' || sanitized.state === 'not-sent') {
        await this.claims.release(target, { id, operation: 'write-off', direction: current.evidence.input.direction })
      }
      return record
    }))
  }
}
