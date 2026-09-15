/** Durable reservations for subject and auxiliary-item creation; business mappings stay in their owning modules. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { subjectAccountingSelectionSchema, type SubjectPreparationInput } from './subject-preparation.ts'
import { buildSubjectSubmission } from './subject-submission.ts'
import { buildAuxiliarySubmission, type AuxiliaryPreparationInput } from './auxiliary-preparation.ts'
import { validateMasterDataProposal as proposal } from './master-data-preparation.ts'

/** Local operation ID, not a subject code or auxiliary item ID. */
export type PreparedMasterDataId = Branded<'PreparedMasterDataId'>
/** Only the two approved master-data creation operations are represented. */
export type MasterDataProposal = { kind: 'subject'; input: SubjectPreparationInput }
  | { kind: 'auxiliary-item'; input: AuxiliaryPreparationInput }
const text = z.string().min(1).max(500)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const targetClaim = z.strictObject({ ownerDigest: digest, id: z.uuid() })
const ledger = { accountId: text, accountName: text }
const selectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('subject'), ...ledger,
    accounting: subjectAccountingSelectionSchema.optional(),
    parent: z.strictObject({ code: text, name: text }).nullable(),
    parentImpact: z.enum(['new-root', 'existing-branch', 'requires-leaf-promotion-check']),
    sameNameElsewhere: z.array(z.strictObject({ code: text, parentCode: z.string().optional() })
      .transform(({ code, parentCode }) => ({ code, ...parentCode === undefined ? {} : { parentCode } }))),
  }),
  z.strictObject({ kind: z.literal('auxiliary-item'), ...ledger,
    categoryId: text.transform(value => value as Branded<'FinanceReferenceId'>), categoryCode: text, categoryName: text }),
])
/** Exact Host-resolved names and identifiers retained for confirmation and readback. */
export type MasterDataSelection = z.infer<typeof selectionSchema>
const outcomeSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('accepted') }),
  z.strictObject({ state: z.literal('rejected'), code: z.number().int().min(200).max(299) }),
  z.strictObject({ state: z.literal('outcome-unknown') }),
  z.strictObject({ state: z.literal('not-sent'), reason: z.enum(['preflight-failed', 'cancelled']) }),
])
/** The qualified endpoints return no ID on acceptance; verification is deliberately separate. */
export type MasterDataSubmissionOutcome = z.infer<typeof outcomeSchema>
const schema = z.strictObject({ schemaVersion: z.literal(1), id: z.uuid(), ownerDigest: digest,
  configurationDigest: digest, version: z.number().int().positive(), proposal: z.unknown(),
  phase: z.enum(['prepared', 'accepted', 'rejected', 'outcome-unknown', 'not-sent']),
  reservation: z.strictObject({ selection: selectionSchema, payload: z.unknown() }).optional(),
  outcome: outcomeSchema.optional(),
}).refine(value => value.phase === 'prepared' ? value.reservation === undefined && value.outcome === undefined
  : value.reservation !== undefined && (value.outcome === undefined ? value.phase === 'outcome-unknown' : value.phase === value.outcome.state))

/**
 * Rebuild one supported master-data payload without accepting arbitrary request fields.
 * @param value - Validated proposal from the exact persisted version.
 * @param selection - Host-resolved selection of the same business kind.
 * @returns Business-specific request without credentials or write authority.
 */
export function buildMasterDataSubmission(value: MasterDataProposal, selection: MasterDataSelection): object {
  if (value.kind === 'subject' && selection.kind === 'subject') return buildSubjectSubmission(value.input, selection)
  if (value.kind === 'auxiliary-item' && selection.kind === 'auxiliary-item') return buildAuxiliarySubmission(value.input, selection)
  throw new Error('基础资料类型与已确认资料不一致。')
}

/** Original proposal and immutable reserved request; accepted never means independently verified. */
export interface PreparedMasterDataRecord {
  schemaVersion: 1
  id: PreparedMasterDataId
  ownerDigest: string
  configurationDigest: string
  version: number
  proposal: MasterDataProposal
  phase: 'prepared' | MasterDataSubmissionOutcome['state']
  reservation?: { selection: MasterDataSelection; payload: object }
  outcome?: MasterDataSubmissionOutcome
}

/** Owner-scoped versioning for two master-data kinds, without a generic workflow or retry mechanism. */
export class MasterDataRecords {
  private readonly ownerDigest: string
  private readonly directory: string

  /**
   * @param root - Private Host-owned storage root.
   * @param owner - Host-derived client/session identity, not model input.
   * @param maxBytes - Limit for complete persisted records, including reserved results.
   */
  constructor(private readonly root: string, owner: string, private readonly maxBytes: number) {
    this.ownerDigest = createHash('sha256').update(owner).digest('hex')
    this.directory = join(root, this.ownerDigest)
  }

  private file(id: PreparedMasterDataId): string { return join(this.directory, `${z.uuid().parse(id)}.json`) }

  private checkCapacity(record: PreparedMasterDataRecord): string {
    const serialized = JSON.stringify(record) + '\n'
    if (Buffer.byteLength(serialized) > this.maxBytes) throw new Error('基础资料记录没有足够空间保存内容或接口结果。')
    return serialized
  }

  private async save(record: PreparedMasterDataRecord): Promise<void> {
    await writeFileAtomic(this.file(record.id), this.checkCapacity(record), { mode: 0o600, dirMode: 0o700 })
  }

  private assertPrepared(record: PreparedMasterDataRecord, version: number, configuration: string): void {
    if (record.phase !== 'prepared') throw new Error('基础资料已有发送记录或结果未知，不能修改或重复提交，请先回查。')
    if (record.version !== version || record.configurationDigest !== configuration) throw new Error('基础资料版本或账套配置已变化，请重新预览确认。')
  }

  private target(record: PreparedMasterDataRecord): string {
    if (record.reservation === undefined) throw new Error('基础资料目标必须来自已核实的提交内容。')
    const value = record.proposal
    return createHash('sha256').update(JSON.stringify([record.reservation.selection.accountId, value.kind,
      ...value.kind === 'subject' ? [value.input.subjectCode] : [value.input.categoryCode, value.input.itemCode],
    ])).digest('hex')
  }

  private async reserveTarget(record: PreparedMasterDataRecord): Promise<void> {
    const target = this.target(record)
    const directory = join(this.root, 'targets')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, `${target}.json`)
    await withFileLock(file + '.lock', async () => {
      let bytes: Buffer | undefined
      try { bytes = await readFile(file) } catch (error) {
        // Only an absent reservation permits a first claim; inaccessible or corrupt records must block.
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      if (bytes !== undefined) {
        if (bytes.length > this.maxBytes) throw new Error('基础资料目标记录超过大小限制。')
        const prior = targetClaim.parse(JSON.parse(bytes.toString('utf8')))
        const previous = await this.readOwned(prior.id as PreparedMasterDataId, prior.ownerDigest)
        if (previous.reservation === undefined || this.target(previous) !== target
          || (previous.phase !== 'rejected' && previous.phase !== 'not-sent')) {
          throw new Error('相同账套及编码已有已接收或未知发送记录，不能另建预览绕过；请核查原记录。')
        }
      }
      // A crash between the claim and record save deliberately keeps the target unavailable for automatic retry.
      await writeFileAtomic(file, JSON.stringify({ ownerDigest: record.ownerDigest, id: record.id }) + '\n', { mode: 0o600, dirMode: 0o700 })
      await this.save(record)
    })
  }

  private async readOwned(id: PreparedMasterDataId, ownerDigest: string): Promise<PreparedMasterDataRecord> {
    const bytes = await readFile(join(this.root, ownerDigest, `${id}.json`))
    if (bytes.length > this.maxBytes) throw new Error('基础资料记录超过大小限制。')
    const parsed = schema.parse(JSON.parse(bytes.toString('utf8')))
    if (parsed.id !== id || parsed.ownerDigest !== ownerDigest) throw new Error('基础资料记录归属不一致。')
    const { reservation, outcome, ...fields } = parsed
    const value = proposal(parsed.proposal, this.maxBytes)
    const record = { ...fields, id, proposal: value, ...outcome === undefined ? {} : { outcome } }
    if (reservation === undefined) return record
    const payload = buildMasterDataSubmission(value, reservation.selection)
    if (JSON.stringify(payload) !== JSON.stringify(reservation.payload)) throw new Error('基础资料持久提交内容不一致。')
    return { ...record, reservation: { selection: reservation.selection, payload } }
  }

  /**
   * Restore and validate the original record without deriving a new request or retry permission.
   * @param id - Previously returned local operation identity.
   * @returns Owner-matched proposal; corrupt or inconsistent reservations reject.
   */
  async read(id: PreparedMasterDataId): Promise<PreparedMasterDataRecord> {
    z.uuid().parse(id)
    return this.readOwned(id, this.ownerDigest)
  }

  /**
   * Persist an unsent proposal; no external record is created.
   * @param input - Explicit kind and business input from an untrusted caller.
   * @param configuration - Current Host-computed ledger/configuration fingerprint.
   * @returns Owner-scoped first version.
   */
  async create(input: unknown, configuration: string): Promise<PreparedMasterDataRecord> {
    const record: PreparedMasterDataRecord = { schemaVersion: 1, id: randomUUID() as PreparedMasterDataId,
      ownerDigest: this.ownerDigest, configurationDigest: digest.parse(configuration), version: 1,
      proposal: proposal(input, this.maxBytes), phase: 'prepared' }
    await this.save(record)
    return record
  }

  /**
   * Replace an unchanged unsent proposal, retaining its kind and invalidating older confirmations.
   * @param id - Local proposal identity.
   * @param version - Previously previewed version.
   * @param configuration - Current Host-computed fingerprint.
   * @param input - Complete replacement proposal, not a patch.
   * @returns Incremented version; reserved, stale or different-kind proposals reject.
   */
  async revise(id: PreparedMasterDataId, version: number, configuration: string, input: unknown): Promise<PreparedMasterDataRecord> {
    const value = proposal(input, this.maxBytes)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertPrepared(current, version, configuration)
      if (current.proposal.kind !== value.kind) throw new Error('不能将已准备的基础资料改成另一种业务。')
      const next = { ...current, version: current.version + 1, proposal: value }
      await this.save(next)
      return next
    })
  }

  /**
   * Confirm outside the lock, then exclusively reserve the unchanged version before any send.
   * @param id - Exact local operation identity.
   * @param version - Exact preview version.
   * @param configuration - Host-captured configuration fingerprint.
   * @param authorize - Mandatory confirmation plus fresh configuration/reference checks; must not perform a business write.
   * @returns Durable unknown outcome; only the successful reservation caller may send once.
   */
  async reserve(id: PreparedMasterDataId, version: number, configuration: string,
    authorize: (record: PreparedMasterDataRecord) => Promise<MasterDataSelection>): Promise<PreparedMasterDataRecord> {
    const preview = await this.read(id)
    this.assertPrepared(preview, version, configuration)
    const selection = selectionSchema.parse(await authorize(preview))
    const payload = buildMasterDataSubmission(preview.proposal, selection)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertPrepared(current, version, configuration)
      const next: PreparedMasterDataRecord = { ...current, phase: 'outcome-unknown', reservation: { selection, payload } }
      for (const outcome of [{ state: 'accepted' }, { state: 'rejected', code: 299 }, { state: 'outcome-unknown' },
        { state: 'not-sent', reason: 'preflight-failed' }] satisfies MasterDataSubmissionOutcome[]) {
        this.checkCapacity({ ...next, phase: outcome.state, outcome })
      }
      await this.reserveTarget(next)
      return next
    })
  }

  /**
   * Retain a transport observation without erasing the reservation or claiming verified creation.
   * @param id - Reserved local operation.
   * @param version - Sent version.
   * @param result - Sanitized single-send observation; accepted carries no invented vendor ID.
   * @returns Durable observation; final outcomes cannot be overwritten.
   */
  async recordOutcome(id: PreparedMasterDataId, version: number, result: MasterDataSubmissionOutcome): Promise<PreparedMasterDataRecord> {
    const outcome = outcomeSchema.parse(result)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      if (current.phase !== 'outcome-unknown' || current.version !== version || current.reservation === undefined) {
        throw new Error('基础资料结果必须对应尚未确认的准确发送版本。')
      }
      const next = { ...current, phase: outcome.state, outcome }
      await this.save(next)
      return next
    })
  }
}
