/** Atomic prepared-voucher versions and irreversible pre-send reservations; no network operations. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import { validateVoucherPreparation, type VoucherPreparationInput } from './voucher-preparation.ts'
import { buildVoucherSubmission, type VoucherSubmissionIdentity, type VoucherSubmissionOutcome } from './voucher-submission.ts'

/** Opaque local voucher operation identifier, distinct from a Youcheng voucher ID. */
export type PreparedVoucherId = Branded<'PreparedVoucherId'>
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const original = z.strictObject({ sourcePath: z.string().min(1), name: z.string().min(1), sha256: digest,
  size: z.number().int().positive(), objectKey: z.string().min(1), storageRevision: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(), downloadUrl: z.url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  }),
})
/** Private receipt for one approved original; signed URLs never belong in model-visible records. */
export type VoucherOriginalReceipt = z.infer<typeof original>
const submission = z.strictObject({ accountId: z.string().min(1),
  identity: z.strictObject({ accountName: z.string().min(1), appId: z.string().min(1), flowId: z.uuid(),
    attachmentUrls: z.array(z.string()) }), payload: z.unknown(),
})
const outcome = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('accepted'), voucherId: z.string().regex(/^\d{1,200}$/) }),
  z.strictObject({ state: z.literal('rejected'), code: z.number().int().min(200).max(299) }),
  z.strictObject({ state: z.literal('outcome-unknown') }),
  z.strictObject({ state: z.literal('not-sent'), reason: z.enum(['preflight-failed', 'cancelled']) }),
])
const schema = z.strictObject({ schemaVersion: z.literal(1), id: z.uuid(), ownerDigest: digest,
  configurationDigest: digest, version: z.number().int().positive(),
  phase: z.enum(['prepared', 'outcome-unknown', 'accepted', 'rejected', 'not-sent']), input: z.unknown(),
  submission: submission.optional(), outcome: outcome.optional(),
  originals: z.array(original).optional(),
}).refine(value => value.phase === 'prepared' ? value.submission === undefined && value.outcome === undefined
  : value.submission !== undefined && (value.outcome === undefined ? value.phase === 'outcome-unknown' : value.phase === value.outcome.state))

/** Durable proposal; outcome-unknown prevents editing or a second submission reservation. */
export interface PreparedVoucherRecord {
  schemaVersion: 1
  id: PreparedVoucherId
  ownerDigest: string
  configurationDigest: string
  version: number
  phase: 'prepared' | VoucherSubmissionOutcome['state']
  input: VoucherPreparationInput
  submission?: { accountId: string; identity: VoucherSubmissionIdentity; payload: object }
  outcome?: VoucherSubmissionOutcome
  originals?: VoucherOriginalReceipt[]
}

/** Per-owner records; callers must derive owner and configuration identity outside model arguments. */
export class VoucherRecords {
  private readonly directory: string
  private readonly ownerDigest: string

  /**
   * @param root - Private Host data directory.
   * @param owner - Host-derived client/session identity.
   * @param limits - Input/record limits.
   */
  constructor(root: string, owner: string, private readonly limits: { maxEntries: number; maxBytes: number }) {
    this.ownerDigest = createHash('sha256').update(owner).digest('hex')
    this.directory = join(root, this.ownerDigest)
  }

  private file(id: PreparedVoucherId): string {
    return join(this.directory, `${z.uuid().parse(id)}.json`)
  }

  private async save(record: PreparedVoucherRecord): Promise<void> {
    const content = JSON.stringify(record) + '\n'
    if (Buffer.byteLength(content, 'utf8') > this.limits.maxBytes) throw new Error('凭证准备记录超过大小限制。')
    await writeFileAtomic(this.file(record.id), content, { mode: 0o600, dirMode: 0o700 })
  }

  /**
   * Read and validate a persisted proposal without converting an uncertain submission to a new draft.
   * @param id - Local identifier obtained from preparation.
   * @returns Record belonging to this owner; missing/corrupt/foreign records reject.
   */
  async read(id: PreparedVoucherId): Promise<PreparedVoucherRecord> {
    const bytes = await readFile(this.file(id))
    if (bytes.length > this.limits.maxBytes) throw new Error('凭证准备记录超过大小限制。')
    const parsed = schema.parse(JSON.parse(bytes.toString('utf8')))
    if (parsed.id !== id || parsed.ownerDigest !== this.ownerDigest) throw new Error('凭证准备记录归属不一致。')
    const prepared = validateVoucherPreparation(parsed.input, this.limits)
    const { submission: reserved, outcome: observed, originals: uploaded, ...fields } = parsed
    const record = { ...fields, id, input: prepared.input, ...observed === undefined ? {} : { outcome: observed },
      ...uploaded === undefined ? {} : { originals: uploaded } }
    if (record.originals !== undefined && new Set(record.originals.map(item => item.sourcePath)).size !== record.originals.length) {
      throw new Error('原件上传记录重复。')
    }
    if (reserved !== undefined) {
      if (reserved.identity.flowId !== id) throw new Error('凭证提交标识与准备记录不一致。')
      const payload = buildVoucherSubmission(prepared.input, reserved.identity, this.limits)
      if (prepared.input.sourcePaths.some((path, index) => record.originals?.find(item => item.sourcePath === path)?.downloadUrl
        !== reserved.identity.attachmentUrls[index])) throw new Error('凭证提交原件缺少一致的上传记录。')
      if (JSON.stringify(payload) !== JSON.stringify(reserved.payload)) throw new Error('凭证持久化提交内容不一致。')
      return { ...record, submission: { ...reserved, payload } }
    }
    return record
  }

  /**
   * Persist a new proposal, not approval or an external write.
   * @param input - Untrusted proposed values.
   * @param configurationDigest - Host-computed identity/revision digest, never raw credentials.
   * @returns Initial durable version.
   */
  async create(input: unknown, configurationDigest: string): Promise<PreparedVoucherRecord> {
    const prepared = validateVoucherPreparation(input, this.limits)
    const record: PreparedVoucherRecord = { schemaVersion: 1, id: randomUUID() as PreparedVoucherId,
      ownerDigest: this.ownerDigest, configurationDigest: digest.parse(configurationDigest), version: 1,
      phase: 'prepared', input: prepared.input }
    await this.save(record)
    return record
  }

  private assertCurrent(record: PreparedVoucherRecord, version: number, configurationDigest: string): void {
    if (record.phase !== 'prepared') throw new Error('凭证已有发送记录或结果未知，不得修改或重复提交；请先回查。')
    if (record.version !== version || record.configurationDigest !== configurationDigest) {
      throw new Error('凭证版本或账套配置已变化，请重新预览确认。')
    }
  }

  /**
   * Replace a still-unsent version; stale callers cannot overwrite a later preparation.
   * @param id - Local proposal ID.
   * @param version - Version the caller inspected.
   * @param configurationDigest - Same Host configuration identity used to prepare.
   * @param input - Replacement untrusted input.
   * @returns Incremented durable version; prior confirmation no longer applies.
   */
  async revise(id: PreparedVoucherId, version: number, configurationDigest: string, input: unknown): Promise<PreparedVoucherRecord> {
    const prepared = validateVoucherPreparation(input, this.limits)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertCurrent(current, version, configurationDigest)
      const next = { ...current, version: current.version + 1, input: prepared.input }
      await this.save(next)
      return next
    })
  }

  /**
   * Persist a private original-upload receipt for an unchanged, still-unsent approved version.
   * @param id - Local prepared operation.
   * @param version - Version approved for this upload.
   * @param configurationDigest - Captured Finance configuration identity.
   * @param receipt - Host-owned upload result and verified local file identity.
   * @returns Completion of receipt persistence; this does not establish vendor association.
   */
  async recordOriginal(id: PreparedVoucherId, version: number, configurationDigest: string,
    receipt: VoucherOriginalReceipt): Promise<void> {
    const uploaded = original.parse(receipt)
    await withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertCurrent(current, version, configurationDigest)
      if (!current.input.sourcePaths.includes(uploaded.sourcePath)) throw new Error('上传原件不属于本次凭证来源。')
      const originals = [...(current.originals ?? []).filter(item => item.sourcePath !== uploaded.sourcePath), uploaded]
      await this.save({ ...current, originals })
    })
  }

  /**
   * Authorize an exact proposal, then persist uncertainty before the caller sends any business request.
   * @param id - Local proposal ID; also usable as the stable external flowId.
   * @param version - Previewed version.
   * @param configurationDigest - Captured Host configuration identity.
   * @param authorize - Host approval and current configuration/cancellation checks; returns the verified destination and originals.
   * @returns Reserved record; this method neither sends nor proves successful creation. Repeated reservations reject.
   */
  async reserve(id: PreparedVoucherId, version: number, configurationDigest: string,
    authorize: (record: PreparedVoucherRecord) => Promise<{ accountId: string; identity: VoucherSubmissionIdentity }>,
  ): Promise<PreparedVoucherRecord> {
    const preview = await this.read(id)
    this.assertCurrent(preview, version, configurationDigest)
    const authorized = submission.omit({ payload: true }).parse(await authorize(preview))
    if (!authorized.accountId.trim() || authorized.identity.flowId !== id) throw new Error('凭证提交标识或目标账套不一致。')
    const payload = buildVoucherSubmission(preview.input, authorized.identity, this.limits)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertCurrent(current, version, configurationDigest)
      if (current.input.sourcePaths.some((path, index) => current.originals?.find(item => item.sourcePath === path)?.downloadUrl
        !== authorized.identity.attachmentUrls[index])) throw new Error('原件上传记录已变化或不完整，不能提交。')
      const next: PreparedVoucherRecord = { ...current, phase: 'outcome-unknown', submission: { ...authorized, payload } }
      const longestObservation = { ...next, phase: 'accepted', outcome: { state: 'accepted', voucherId: '9'.repeat(200) } }
      if (Buffer.byteLength(JSON.stringify(longestObservation) + '\n', 'utf8') > this.limits.maxBytes) {
        throw new Error('凭证记录没有足够空间保存接口结果，不能发送。')
      }
      await this.save(next)
      return next
    })
  }

  /**
   * Persist a single transport observation without treating acceptance as verified completion.
   * @param id - Reserved local operation ID.
   * @param version - Exact sent version.
   * @param result - Sanitized sender outcome; no raw provider response or secret.
   * @returns Durable outcome; all sent records remain ineligible for a second reservation.
   */
  async recordOutcome(id: PreparedVoucherId, version: number, result: VoucherSubmissionOutcome): Promise<PreparedVoucherRecord> {
    const observed = outcome.parse(result)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      if (current.phase !== 'outcome-unknown' || current.version !== version || current.submission === undefined) {
        throw new Error('凭证结果必须对应尚未确认的准确提交版本。')
      }
      const next = { ...current, phase: observed.state, outcome: observed }
      await this.save(next)
      return next
    })
  }
}
