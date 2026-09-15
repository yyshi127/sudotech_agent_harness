/** Durable journal deletion previews and per-target claims, shared across the bound client's sessions. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { JournalDeletionInventory, JournalDeletionOutcome } from './journal-deletion.ts'
import type { JournalEntryId } from './journals.ts'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const identifier = z.string().regex(/^[1-9]\d*$/)
const money = z.string().regex(/^-?\d+\.\d{2}$/).nullable()
const values = { summary: z.string(), accountCode: z.string(), accountName: z.string(), currencyCode: z.string(),
  baseCurrencyCode: z.string(), income: money, expense: money, balance: money, baseIncome: money, baseExpense: money,
  baseBalance: money, categoryName: z.string(), keeperName: z.string() }
const row = z.strictObject({ ...values, id: identifier.transform(value => value as JournalEntryId), date: z.iso.date() })
const account = { accountId: identifier, accountName: z.string().min(1) }
const inventoryFields = z.strictObject({ ...account,
  selection: z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), cashAccountId: identifier }),
  totalCount: z.number().int().nonnegative(), rows: z.array(row), fingerprints: z.record(identifier, digest),
  summaries: z.array(z.strictObject({ ...values, kind: z.enum(['opening', 'total']) })),
  target: z.strictObject({ ...account, cashAccountId: identifier, row, fingerprint: digest,
    reviewStatus: z.literal(0), channel: z.literal('ADD'), attachmentCount: z.literal(0), blockers: z.tuple([]) }),
  scope: z.literal('selected-month'), notice: z.string(),
}).refine((value) => {
  const ids = value.rows.map(item => item.id)
  const target = value.target
  const found = value.rows.find(item => item.id === target.row.id)
  return value.totalCount === ids.length && new Set(ids).size === ids.length
    && Object.keys(value.fingerprints).length === ids.length && ids.every(id => Object.hasOwn(value.fingerprints, id))
    && value.rows.every(item => item.date.startsWith(value.selection.month + '-'))
    && value.accountId === target.accountId && value.accountName === target.accountName
    && value.selection.cashAccountId === target.cashAccountId && value.fingerprints[target.row.id] === target.fingerprint
    && JSON.stringify(found) === JSON.stringify(target.row)
}, '日记账删除清单与目标不一致。')
// Preserve the original field order: the sender compares this evidence byte-for-byte with its fresh inventory.
const inventorySchema = z.custom<z.infer<typeof inventoryFields>>(value => inventoryFields.safeParse(value).success,
  '日记账删除清单不完整、目标不一致或存在操作限制。')
const outcomeSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('accepted') }),
  z.strictObject({ state: z.literal('rejected'), code: z.number().int().min(200).max(299) }),
  z.strictObject({ state: z.literal('outcome-unknown') }),
  z.strictObject({ state: z.literal('not-sent'), reason: z.enum(['preflight-failed', 'cancelled']) }),
])
const schema = z.strictObject({ schemaVersion: z.literal(1), id: z.uuid(), ownerDigest: digest,
  configurationDigest: digest, version: z.number().int().positive(), inventory: inventorySchema,
  phase: z.enum(['prepared', 'outcome-unknown', 'accepted', 'rejected', 'not-sent']), outcome: outcomeSchema.optional(),
}).refine(record => record.outcome === undefined ? ['prepared', 'outcome-unknown'].includes(record.phase)
  : record.phase === record.outcome.state)
const claimSchema = z.strictObject({ id: z.uuid(), accountId: identifier, journalId: identifier })

/** Local operation ID, distinct from a vendor journal ID. */
export type JournalDeletionId = Branded<'JournalDeletionId'>
/** Exact monthly evidence and durable transport state; acceptance does not establish deletion. */
export type JournalDeletionRecord = Omit<z.infer<typeof schema>, 'id'> & { id: JournalDeletionId }

/** Uses the existing atomic-write and file-lock primitives; no network, approval UI or vendor lock is supplied here. */
export class JournalDeletionRecords {
  private readonly ownerDigest: string
  private readonly directory: string

  /**
   * @param root - Private Host root dedicated to journal deletions.
   * @param owner - Host-derived client/environment/ledger identity, never session- or model-selected.
   * @param maxBytes - Maximum complete record size including eventual transport outcome.
   */
  constructor(root: string, owner: string, private readonly maxBytes: number) {
    this.ownerDigest = hash(owner)
    this.directory = join(root, this.ownerDigest)
  }

  private file(id: JournalDeletionId): string { return join(this.directory, `${z.uuid().parse(id)}.json`) }
  private target(record: JournalDeletionRecord): string {
    return join(this.directory, `target-${hash(JSON.stringify([record.inventory.accountId, record.inventory.target.row.id]))}.json`)
  }
  private serialize(value: unknown): string {
    const content = JSON.stringify(value) + '\n'
    if (Buffer.byteLength(content) > this.maxBytes) throw new Error('日记账删除记录超过大小限制。')
    return content
  }
  private async json(path: string): Promise<unknown> {
    const bytes = await readFile(path)
    if (bytes.length > this.maxBytes) throw new Error('日记账删除记录超过大小限制。')
    return JSON.parse(bytes.toString('utf8'))
  }
  private async save(record: JournalDeletionRecord): Promise<void> {
    await writeFileAtomic(this.file(record.id), this.serialize(record), { mode: 0o600, dirMode: 0o700 })
  }
  private current(record: JournalDeletionRecord, version: number, configurationDigest: string): void {
    if (record.phase !== 'prepared' || record.version !== version) throw new Error('日记账删除版本已变化或存在发送记录，不得重发。')
    if (record.configurationDigest !== configurationDigest) throw new Error('账套配置已变化，请重新预览确认。')
  }

  /**
   * Read and validate complete persisted evidence without clearing uncertain claims.
   * @param id - Local ID previously returned for this owner.
   * @returns Validated record; missing, corrupt, oversized or inconsistent evidence rejects.
   */
  async read(id: JournalDeletionId): Promise<JournalDeletionRecord> {
    const parsed = schema.parse(await this.json(this.file(id)))
    if (parsed.id !== id || parsed.ownerDigest !== this.ownerDigest) throw new Error('日记账删除记录归属不一致。')
    return { ...parsed, id }
  }

  /**
   * Persist a target-bearing, explicit-account preview without reserving or authorizing deletion.
   * @param inventory - Fresh two-pass evidence, including target and surviving rows for balance comparison.
   * @param configurationDigest - Current Host-derived configuration identity.
   * @returns Initial preview version; unsupported states and incomplete identities reject.
   */
  async create(inventory: JournalDeletionInventory, configurationDigest: string): Promise<JournalDeletionRecord> {
    const record: JournalDeletionRecord = { schemaVersion: 1, id: randomUUID() as JournalDeletionId,
      ownerDigest: this.ownerDigest, configurationDigest: digest.parse(configurationDigest), version: 1,
      inventory: inventorySchema.parse(inventory), phase: 'prepared' }
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.save(record)
    return record
  }

  /**
   * Replace only an unsent exact preview and invalidate its old confirmation.
   * @param id - Local deletion operation.
   * @param version - Expected current preview version.
   * @param inventory - Replacement fresh complete target evidence.
   * @param configurationDigest - Configuration bound to the replacement.
   * @returns Incremented version; any send intent prevents revision.
   */
  async revise(id: JournalDeletionId, version: number, inventory: JournalDeletionInventory,
    configurationDigest: string): Promise<JournalDeletionRecord> {
    const replacement = inventorySchema.parse(inventory)
    const configuration = digest.parse(configurationDigest)
    return withFileLock(this.file(id) + '.lock', async () => {
      const record = await this.read(id)
      this.current(record, version, record.configurationDigest)
      const next = { ...record, version: record.version + 1, inventory: replacement, configurationDigest: configuration }
      await this.save(next)
      return next
    })
  }

  /**
   * Claim one journal across sessions before allowing the caller to dispatch once.
   * @param id - Prepared local operation.
   * @param version - Exact preview version approved by the user.
   * @param configurationDigest - Current Host configuration identity.
   * @param authorize - Mandatory Host approval and fresh checks; never sends the business request.
   * @returns Durable uncertain reservation. A crash between claim and record saves still blocks another send.
   */
  async reserve(id: JournalDeletionId, version: number, configurationDigest: string,
    authorize: (record: JournalDeletionRecord) => Promise<void>): Promise<JournalDeletionRecord> {
    const preview = await this.read(id)
    this.current(preview, version, configurationDigest)
    const approved = JSON.stringify(preview)
    await authorize(preview)
    if (JSON.stringify(preview) !== approved) throw new Error('日记账删除预览内容已变化，请重新确认。')
    return withFileLock(this.target(preview) + '.lock', async () => withFileLock(this.file(id) + '.lock', async () => {
      const record = await this.read(id)
      this.current(record, version, configurationDigest)
      if (JSON.stringify(record) !== approved) throw new Error('日记账删除预览内容已变化，请重新确认。')
      let claim: z.infer<typeof claimSchema> | undefined
      try { claim = claimSchema.parse(await this.json(this.target(record))) }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      if (claim !== undefined) {
        const prior = await this.read(claim.id as JournalDeletionId)
        if (claim.accountId !== record.inventory.accountId || claim.journalId !== record.inventory.target.row.id
          || prior.inventory.accountId !== claim.accountId || prior.inventory.target.row.id !== claim.journalId) {
          throw new Error('已有日记账删除目标记录不一致，不能发送。')
        }
        if (prior.phase !== 'not-sent' && prior.phase !== 'rejected') throw new Error('该流水已有删除发送意图，请只读检查原记录。')
      }
      const next: JournalDeletionRecord = { ...record, phase: 'outcome-unknown' }
      this.serialize({ ...next, phase: 'not-sent', outcome: { state: 'not-sent', reason: 'preflight-failed' } })
      // A surviving claim must block even if a process stops before saving the operation's uncertain phase.
      await writeFileAtomic(this.target(record), this.serialize({ id, accountId: record.inventory.accountId,
        journalId: record.inventory.target.row.id }), { mode: 0o600, dirMode: 0o700 })
      await this.save(next)
      return next
    }))
  }

  /**
   * Save the single observed outcome, including when the caller has already cancelled.
   * @param id - Reserved local operation.
   * @param version - Exact sent version.
   * @param outcome - Sanitized observation, not a readback conclusion.
   * @returns Persisted outcome; only rejected/not-sent allows a separately confirmed new proposal.
   */
  async recordOutcome(id: JournalDeletionId, version: number, outcome: JournalDeletionOutcome): Promise<JournalDeletionRecord> {
    const observed = outcomeSchema.parse(outcome)
    return withFileLock(this.file(id) + '.lock', async () => {
      const record = await this.read(id)
      if (record.phase !== 'outcome-unknown' || record.version !== version || record.outcome !== undefined) {
        throw new Error('日记账删除结果不属于尚未记录结果的准确发送版本。')
      }
      const next = { ...record, phase: observed.state, outcome: observed }
      await this.save(next)
      return next
    })
  }
}
