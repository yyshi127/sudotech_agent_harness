/** Durable AR/AP deletion previews and shared ledger/record claims; no network or approval UI. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { OpenItemDeletionInventory, OpenItemDeletionOutcome } from './open-item-deletion.ts'
import type { OpenItemId } from './open-items.ts'
import { OpenItemTargetClaims, type OpenItemClaimTarget } from './open-item-target-claims.ts'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const identifier = z.string().regex(/^[1-9]\d*$/)
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const direction = z.enum(['receivable', 'payable'])
const money = z.string().regex(/^-?\d+\.\d{2}$/).nullable()
const row = z.strictObject({ id: identifier.transform(value => value as OpenItemId), date: z.iso.date(),
  summary: z.string(), subjectCode: z.string(), subjectName: z.string(), auxiliaryItemIds: z.string(),
  auxiliaryItemName: z.string(), currencyCode: z.string(), baseCurrencyCode: z.string(),
  amount: money, balance: money, baseAmount: money, baseBalance: money, settledAmount: money,
  badDebtAmount: money, offsetAmount: money, returnAmount: money, initialBalance: z.boolean().nullable(),
  finished: z.boolean().nullable(), categoryName: z.string(), remark: z.string() })
const account = { accountId: identifier, accountName: z.string().min(1) }
const inventoryFields = z.strictObject({ ...account,
  selection: z.strictObject({ direction, periodStart: period, periodEnd: period }),
  totalCount: z.number().int().nonnegative(), rows: z.array(row), fingerprints: z.record(identifier, digest),
  contentFingerprints: z.record(identifier, digest),
  target: z.strictObject({ ...account, direction,
    businessAccountId: identifier.transform(value => value as Branded<'FinanceReferenceId'>),
    row, fingerprint: digest, attachmentCount: z.number().int().nonnegative(),
    blockers: z.array(z.string()), unverified: z.array(z.string()) }),
  scope: z.literal('selected-direction-periods'),
}).refine((value) => {
  const ids = value.rows.map(item => item.id)
  const target = value.target
  return value.selection.periodStart <= value.selection.periodEnd && value.totalCount === ids.length
    && new Set(ids).size === ids.length && Object.keys(value.fingerprints).length === ids.length
    && ids.every(id => Object.hasOwn(value.fingerprints, id))
    && Object.keys(value.contentFingerprints).length === ids.length
    && ids.every(id => Object.hasOwn(value.contentFingerprints, id))
    && value.rows.every(item => item.date.slice(0, 7) >= value.selection.periodStart && item.date.slice(0, 7) <= value.selection.periodEnd)
    && value.accountId === target.accountId && value.accountName === target.accountName
    && value.selection.direction === target.direction && value.fingerprints[target.row.id] === target.fingerprint
    && JSON.stringify(value.rows.find(item => item.id === target.row.id)) === JSON.stringify(target.row)
}, '应收应付删除清单与目标不一致。')
// The sender compares full serialized evidence; parsing must not reorder or strip its original fields.
const inventorySchema = z.custom<z.infer<typeof inventoryFields>>(value => inventoryFields.safeParse(value).success,
  '应收应付删除清单不完整或目标不一致。')
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
/** Host-local deletion ID, never the vendor open-item ID. */
export type OpenItemDeletionId = Branded<'OpenItemDeletionId'>
/** Exact original-scope evidence with separate transport state; unknown constraints remain visible. */
export type OpenItemDeletionRecord = Omit<z.infer<typeof schema>, 'id'> & { id: OpenItemDeletionId }

/** Uses atomic replacement and file locks; callers own fresh risk qualification, confirmation and dispatch. */
export class OpenItemDeletionRecords {
  private readonly ownerDigest: string
  private readonly directory: string
  private readonly claims: OpenItemTargetClaims

  /**
   * @param root - Host-private deletion-record root.
   * @param owner - Host-derived client/environment/ledger identity shared across its sessions.
   * @param maxBytes - Complete record cap including the eventual transport outcome.
   * @param targetClaimsRoot - Host-private target-claim root shared with write-off records.
   */
  constructor(root: string, owner: string, private readonly maxBytes: number, targetClaimsRoot: string) {
    this.ownerDigest = hash(owner)
    this.directory = join(root, this.ownerDigest)
    this.claims = new OpenItemTargetClaims(targetClaimsRoot, owner, maxBytes)
  }

  private file(id: OpenItemDeletionId): string { return join(this.directory, `${z.uuid().parse(id)}.json`) }
  private target(record: OpenItemDeletionRecord): OpenItemClaimTarget {
    return { ledgerId: record.inventory.accountId, openItemId: record.inventory.target.row.id }
  }
  private serialize(value: unknown): string {
    const content = JSON.stringify(value) + '\n'
    if (Buffer.byteLength(content) > this.maxBytes) throw new Error('应收应付删除记录超过大小限制。')
    return content
  }
  private async json(path: string): Promise<unknown> {
    const bytes = await readFile(path)
    if (bytes.length > this.maxBytes) throw new Error('应收应付删除记录超过大小限制。')
    return JSON.parse(bytes.toString('utf8'))
  }
  private async save(record: OpenItemDeletionRecord): Promise<void> {
    await writeFileAtomic(this.file(record.id), this.serialize(record), { mode: 0o600, dirMode: 0o700 })
  }
  private current(record: OpenItemDeletionRecord, version: number, configurationDigest: string): void {
    if (record.phase !== 'prepared' || record.version !== version) throw new Error('应收应付删除版本已变化或存在发送记录，不得重发。')
    if (record.configurationDigest !== configurationDigest) throw new Error('账套配置已变化，请重新预览确认。')
  }

  /**
   * Read persisted evidence without clearing an uncertain outcome or shared claim.
   * @param id - Local ID owned by this client's ledger.
   * @returns Validated complete record; corrupt, inconsistent, foreign or oversized records reject.
   */
  async read(id: OpenItemDeletionId): Promise<OpenItemDeletionRecord> {
    const record = schema.parse(await this.json(this.file(id)))
    if (record.id !== id || record.ownerDigest !== this.ownerDigest) throw new Error('应收应付删除记录归属不一致。')
    return { ...record, id }
  }

  /**
   * Persist a preview, including known blockers and unknown constraints, without granting deletion authority.
   * @param inventory - Fresh target-bearing original-scope evidence.
   * @param configurationDigest - Host-derived current configuration identity.
   * @returns Initial version; no shared target claim is created.
   */
  async create(inventory: OpenItemDeletionInventory, configurationDigest: string): Promise<OpenItemDeletionRecord> {
    const record: OpenItemDeletionRecord = { schemaVersion: 1, id: randomUUID() as OpenItemDeletionId,
      ownerDigest: this.ownerDigest, configurationDigest: digest.parse(configurationDigest), version: 1,
      inventory: inventorySchema.parse(inventory), phase: 'prepared' }
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.save(record)
    return record
  }

  /**
   * Replace an unsent exact version; every change invalidates previous confirmation.
   * @param id - Local deletion ID.
   * @param version - Expected current preview version.
   * @param inventory - Complete replacement evidence, preserving direction and unknown values.
   * @param configurationDigest - Host configuration bound to the replacement.
   * @returns Incremented preview; existing send intent prevents revision.
   */
  async revise(id: OpenItemDeletionId, version: number, inventory: OpenItemDeletionInventory,
    configurationDigest: string): Promise<OpenItemDeletionRecord> {
    const replacement = inventorySchema.parse(inventory)
    const configuration = digest.parse(configurationDigest)
    return withFileLock(this.file(id) + '.lock', async () => {
      const record = await this.read(id)
      this.current(record, version, record.configurationDigest)
      const next = { ...record, inventory: replacement, configurationDigest: configuration, version: record.version + 1 }
      await this.save(next)
      return next
    })
  }

  /**
   * Reserve one ledger/record across sessions and local mutation types; changing direction cannot bypass the claim.
   * @param id - Prepared local deletion ID.
   * @param version - Exact version approved by the user.
   * @param configurationDigest - Current Host configuration identity.
   * @param authorize - Mandatory risk qualification, fresh-state checks and exact-version consent; never sends.
   * @returns Durable uncertain reservation. A torn claim/record pair blocks another send, including after restart.
   */
  async reserve(id: OpenItemDeletionId, version: number, configurationDigest: string,
    authorize: (record: OpenItemDeletionRecord) => Promise<void>): Promise<OpenItemDeletionRecord> {
    const preview = await this.read(id)
    this.current(preview, version, configurationDigest)
    if (preview.inventory.target.blockers.length > 0) throw new Error('目标存在删除限制，不能发送。')
    const target = this.target(preview)
    const approved = JSON.stringify(preview)
    await authorize(preview)
    return this.claims.withLock(target, async () => withFileLock(this.file(id) + '.lock', async () => {
      const record = await this.read(id)
      this.current(record, version, configurationDigest)
      if (JSON.stringify(record) !== approved) throw new Error('删除预览内容已变化，请重新确认。')
      const claim = await this.claims.read(target)
      if (claim !== undefined) {
        if (claim.operation === 'deletion' && claim.direction !== record.inventory.selection.direction) {
          throw new Error('已有应收应付删除目标记录不一致，不能发送。')
        }
        throw new Error(claim.operation === 'deletion' ? '该往来已有删除发送意图，请只读检查原记录。'
          : '该往来已有核销发送意图，请只读检查原记录。')
      }
      const next: OpenItemDeletionRecord = { ...record, phase: 'outcome-unknown' }
      this.serialize({ ...next, phase: 'not-sent', outcome: { state: 'not-sent', reason: 'preflight-failed' } })
      // Saving the claim first prevents another send if the process stops before the uncertain record is written.
      await this.claims.create(target, { id, operation: 'deletion', direction: record.inventory.selection.direction })
      await this.save(next)
      return next
    }))
  }

  /**
   * Persist a single sanitized transport observation independently of later readback.
   * @param id - Reserved local operation.
   * @param version - Exact reserved version.
   * @param outcome - Transport outcome; acceptance does not establish absence or safe related balances.
   * @returns Saved observation; only rejected/not-sent permits a separately confirmed new proposal.
   */
  async recordOutcome(id: OpenItemDeletionId, version: number, outcome: OpenItemDeletionOutcome): Promise<OpenItemDeletionRecord> {
    const observed = outcomeSchema.parse(outcome)
    const preview = await this.read(id)
    const target = this.target(preview)
    return this.claims.withLock(target, async () => withFileLock(this.file(id) + '.lock', async () => {
      const record = await this.read(id)
      if (record.phase !== 'outcome-unknown' || record.version !== version || record.outcome !== undefined) {
        throw new Error('应收应付删除结果不属于尚未记录结果的准确发送版本。')
      }
      if (JSON.stringify(this.target(record)) !== JSON.stringify(target)) {
        throw new Error('应收应付删除目标已变化，不能记录结果。')
      }
      const claim = await this.claims.read(target)
      if (claim === undefined || claim.id !== id || claim.operation !== 'deletion'
        || claim.direction !== record.inventory.selection.direction) {
        throw new Error('应收应付删除目标占用记录不一致，不能记录结果。')
      }
      const next = { ...record, phase: observed.state, outcome: observed }
      await this.save(next)
      if (observed.state === 'rejected' || observed.state === 'not-sent') {
        await this.claims.release(target, { id, operation: 'deletion', direction: record.inventory.selection.direction })
      }
      return next
    }))
  }
}
