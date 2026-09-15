/** Versioned deletion previews and cross-session target claims; no network or vendor-lock guarantee. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { VoucherDeletionInspection, VoucherDeletionPayload, VoucherDeletionOutcome } from './voucher-deletion.ts'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const text = z.string().min(1)
const payloadSchema = z.strictObject({ accountName: text,
  cerInfoList: z.tuple([z.strictObject({ cerId: text })]) })
const outcomeSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('accepted') }),
  z.strictObject({ state: z.literal('rejected'), code: z.number().int().min(200).max(299) }),
  z.strictObject({ state: z.literal('outcome-unknown') }),
  z.strictObject({ state: z.literal('not-sent'), reason: z.enum(['preflight-failed', 'cancelled']) }),
])
const recordSchema = z.strictObject({ schemaVersion: z.literal(2), id: z.uuid(), ownerDigest: digest,
  version: z.number().int().positive(), configurationDigest: digest, accountId: text,
  fingerprint: digest, previewJson: text, payload: payloadSchema,
  phase: z.enum(['prepared', 'outcome-unknown', 'accepted', 'rejected', 'not-sent']), outcome: outcomeSchema.optional(),
}).refine(record => record.outcome === undefined ? ['prepared', 'outcome-unknown'].includes(record.phase)
  : record.phase === record.outcome.state)
const claimSchema = z.strictObject({ id: z.uuid(), accountId: text, voucherId: text })

/** Local deletion operation ID, distinct from the vendor voucher and original creation IDs. */
export type VoucherDeletionId = Branded<'VoucherDeletionId'>
/** Private preview text and exact vendor request; accepted does not mean verified deletion. */
export type VoucherDeletionRecord = Omit<z.infer<typeof recordSchema>, 'id'> & { id: VoucherDeletionId }

/** Shared per client/environment/ledger, not per session; claims survive process restarts. */
export class VoucherDeletionRecords {
  private readonly directory: string
  private readonly ownerDigest: string

  /**
   * @param root - Private Host deletion-record root.
   * @param owner - Host-derived stable client/environment/ledger identity, shared by its sessions.
   * @param maxBytes - Maximum complete preview, record and target-claim size.
   */
  constructor(root: string, owner: string, private readonly maxBytes: number) {
    this.ownerDigest = hash(owner)
    this.directory = join(root, this.ownerDigest)
  }

  private file(id: VoucherDeletionId): string { return join(this.directory, `${z.uuid().parse(id)}.json`) }
  private target(record: VoucherDeletionRecord): string {
    return join(this.directory, `target-${hash(JSON.stringify([record.accountId, record.payload.cerInfoList[0].cerId]))}.json`)
  }
  private serialize(value: unknown): string {
    const content = JSON.stringify(value) + '\n'
    if (Buffer.byteLength(content, 'utf8') > this.maxBytes) throw new Error('凭证删除记录超过大小限制。')
    return content
  }
  private async readJson(path: string): Promise<unknown> {
    const bytes = await readFile(path)
    if (bytes.length > this.maxBytes) throw new Error('凭证删除记录超过大小限制。')
    return JSON.parse(bytes.toString('utf8'))
  }
  private async save(record: VoucherDeletionRecord): Promise<void> {
    await writeFileAtomic(this.file(record.id), this.serialize(record), { mode: 0o600, dirMode: 0o700 })
  }
  private assertPrepared(record: VoucherDeletionRecord, version: number, configurationDigest: string): void {
    if (record.phase !== 'prepared' || record.version !== version) throw new Error('删除版本已变化或存在发送记录，不得重复发送。')
    if (record.configurationDigest !== configurationDigest) throw new Error('账套配置已变化，请重新预览确认。')
  }
  private proposal(inspection: VoucherDeletionInspection, payload: VoucherDeletionPayload, configurationDigest: string) {
    const parsed = payloadSchema.parse(payload)
    if (inspection.blockers.length > 0 || inspection.detail.accountName !== parsed.accountName
      || inspection.detail.voucherId !== parsed.cerInfoList[0].cerId) throw new Error('删除预览与目标不一致或存在限制。')
    return { accountId: inspection.detail.accountId, fingerprint: digest.parse(inspection.fingerprint),
      configurationDigest: digest.parse(configurationDigest), previewJson: this.serialize(inspection), payload: parsed }
  }

  /**
   * Load a private record without resetting uncertain outcomes or trusting a foreign target claim.
   * @param id - ID returned by this owner's preparation.
   * @returns Validated record; corrupt, oversized, mismatched and foreign records reject.
   */
  async read(id: VoucherDeletionId): Promise<VoucherDeletionRecord> {
    const parsed = recordSchema.parse(await this.readJson(this.file(id)))
    if (parsed.id !== id || parsed.ownerDigest !== this.ownerDigest) throw new Error('凭证删除记录归属不一致。')
    const preview = z.object({ fingerprint: digest, detail: z.object({ accountId: text, accountName: text, voucherId: text }) })
      .parse(JSON.parse(parsed.previewJson))
    if (preview.fingerprint !== parsed.fingerprint || preview.detail.accountId !== parsed.accountId
      || preview.detail.accountName !== parsed.payload.accountName || preview.detail.voucherId !== parsed.payload.cerInfoList[0].cerId) {
      throw new Error('凭证删除记录与预览不一致。')
    }
    return { ...parsed, id }
  }

  /**
   * Save a local preview without reserving its target or granting send authority.
   * @param inspection - Fresh identity-checked evidence.
   * @param payload - Minimal request derived by the Host from the inspected voucher.
   * @param configurationDigest - Current Host configuration identity.
   * @returns Initial exact version for mandatory confirmation.
   */
  async create(inspection: VoucherDeletionInspection, payload: VoucherDeletionPayload,
    configurationDigest: string): Promise<VoucherDeletionRecord> {
    const record: VoucherDeletionRecord = { schemaVersion: 2, id: randomUUID() as VoucherDeletionId,
      ownerDigest: this.ownerDigest, version: 1, phase: 'prepared', ...this.proposal(inspection, payload, configurationDigest) }
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.save(record)
    return record
  }

  /**
   * Replace only an unsent exact preview; the old confirmation version becomes unusable.
   * @param id - Existing local operation.
   * @param version - Expected current version.
   * @param inspection - Fresh evidence for the newly previewed target.
   * @param payload - Minimal request derived by the Host from the inspected voucher.
   * @param configurationDigest - Configuration to bind the new preview to.
   * @returns Incremented version; sent records cannot be revised.
   */
  async revise(id: VoucherDeletionId, version: number, inspection: VoucherDeletionInspection,
    payload: VoucherDeletionPayload, configurationDigest: string): Promise<VoucherDeletionRecord> {
    const proposal = this.proposal(inspection, payload, configurationDigest)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertPrepared(current, version, current.configurationDigest)
      const next = { ...current, ...proposal, version: current.version + 1 }
      await this.save(next)
      return next
    })
  }

  /**
   * Confirm one exact version and claim its target before any business request can be sent.
   * @param id - Prepared operation.
   * @param version - Preview version approved by the user.
   * @param configurationDigest - Current Host configuration digest.
   * @param authorize - Mandatory Host approval plus fresh configuration/state checks; rejection throws.
   * @returns Persisted uncertain reservation. Same-target attempts across sessions cannot reserve concurrently.
   */
  async reserve(id: VoucherDeletionId, version: number, configurationDigest: string,
    authorize: (record: VoucherDeletionRecord) => Promise<void>): Promise<VoucherDeletionRecord> {
    const preview = await this.read(id)
    this.assertPrepared(preview, version, configurationDigest)
    const approved = JSON.stringify(preview)
    await authorize(preview)
    if (JSON.stringify(preview) !== approved) throw new Error('凭证删除预览内容已变化，请重新确认。')
    return withFileLock(this.target(preview) + '.lock', async () => withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertPrepared(current, version, configurationDigest)
      if (JSON.stringify(current) !== approved) throw new Error('凭证删除预览内容已变化，请重新确认。')
      let previous: z.infer<typeof claimSchema> | undefined
      try { previous = claimSchema.parse(await this.readJson(this.target(current))) }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      if (previous !== undefined) {
        const prior = await this.read(previous.id as VoucherDeletionId)
        if (previous.accountId !== current.accountId || previous.voucherId !== current.payload.cerInfoList[0].cerId
          || prior.accountId !== previous.accountId || prior.payload.cerInfoList[0].cerId !== previous.voucherId) {
          throw new Error('已有删除目标记录不一致，不能发送。')
        }
        if (prior.phase !== 'not-sent' && prior.phase !== 'rejected') throw new Error('该凭证已有删除发送意图；请查询原记录，不得再次发送。')
      }
      const next: VoucherDeletionRecord = { ...current, phase: 'outcome-unknown' }
      this.serialize({ ...next, phase: 'not-sent', outcome: { state: 'not-sent', reason: 'preflight-failed' } })
      // Claim first: a crash before saving the uncertain record still blocks another operation for this target.
      await writeFileAtomic(this.target(current), this.serialize({ id, accountId: current.accountId,
        voucherId: current.payload.cerInfoList[0].cerId }), { mode: 0o600, dirMode: 0o700 })
      await this.save(next)
      return next
    }))
  }

  /**
   * Retain one observed transport result, including after caller cancellation.
   * @param id - Reserved local operation.
   * @param version - Exact reserved version.
   * @param outcome - Sanitized sender observation, never a claim of verified absence.
   * @returns Persisted observation; only explicit rejection/not-sent allows a separately confirmed new proposal.
   */
  async recordOutcome(id: VoucherDeletionId, version: number, outcome: VoucherDeletionOutcome): Promise<VoucherDeletionRecord> {
    const observed = outcomeSchema.parse(outcome)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      if (current.phase !== 'outcome-unknown' || current.version !== version || current.outcome !== undefined) {
        throw new Error('删除结果不属于尚未记录结果的准确发送版本。')
      }
      const next = { ...current, phase: observed.state, outcome: observed }
      await this.save(next)
      return next
    })
  }
}
