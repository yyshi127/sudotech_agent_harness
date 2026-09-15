/** Owner-scoped journal proposals and irreversible pre-send reservations; no network calls. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { buildJournalSubmission, validateJournalPreparation, type JournalPreparationInput,
  type JournalReferenceSelection } from './journal-preparation.ts'

/** Local durable operation identity, distinct from the vendor's journal ID. */
export type PreparedJournalId = Branded<'PreparedJournalId'>
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const referenceId = z.string().regex(/^[1-9]\d*$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
  .transform(value => value as Branded<'FinanceReferenceId'>)
const selection = z.strictObject({ accountId: z.string().min(1), accountName: z.string().min(1),
  cashAccountId: referenceId, cashAccountName: z.string().min(1), cashAccountCode: z.string(),
  cashAccountCurrencyId: z.string().min(1).optional(), cashAccountType: z.number().int().optional(),
  cashAccountDirectionRaw: z.enum(['0', '1']).optional(),
  categoryName: z.string().min(1).max(64).optional() }).transform(({ categoryName,
  cashAccountCurrencyId, cashAccountType, cashAccountDirectionRaw, ...fields }) => ({
  ...fields, ...categoryName === undefined ? {} : { categoryName },
  ...cashAccountCurrencyId === undefined ? {} : { cashAccountCurrencyId },
  ...cashAccountType === undefined ? {} : { cashAccountType },
  ...cashAccountDirectionRaw === undefined ? {} : { cashAccountDirectionRaw },
}))
const outcome = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('accepted'), journalId: z.string().regex(/^[1-9]\d{0,199}$/) }),
  z.strictObject({ state: z.literal('rejected'), code: z.number().int().min(200).max(299) }),
  z.strictObject({ state: z.literal('outcome-unknown') }),
  z.strictObject({ state: z.literal('not-sent'), reason: z.enum(['preflight-failed', 'cancelled']) }),
])
/** A transport observation, never a declaration that independent business readback passed. */
export type JournalSubmissionOutcome = z.infer<typeof outcome>
const reservation = z.strictObject({ selection, previousId: z.string(), payload: z.unknown() })
const schema = z.strictObject({ schemaVersion: z.literal(1), id: z.uuid(), ownerDigest: digest,
  configurationDigest: digest, version: z.number().int().positive(), input: z.unknown(),
  phase: z.enum(['prepared', 'outcome-unknown', 'accepted', 'rejected', 'not-sent']),
  reservation: reservation.optional(), outcome: outcome.optional(),
}).refine(value => value.phase === 'prepared' ? value.reservation === undefined && value.outcome === undefined
  : value.reservation !== undefined && (value.outcome === undefined ? value.phase === 'outcome-unknown' : value.phase === value.outcome.state))

/** Persisted proposal and, once reserved, its exact immutable request. */
export interface PreparedJournalRecord {
  schemaVersion: 1
  id: PreparedJournalId
  ownerDigest: string
  configurationDigest: string
  version: number
  input: JournalPreparationInput
  phase: 'prepared' | JournalSubmissionOutcome['state']
  reservation?: { selection: JournalReferenceSelection; previousId: string; payload: object }
  outcome?: JournalSubmissionOutcome
}

/** Journal-specific records using the same atomic-file primitive as voucher records. */
export class JournalRecords {
  private readonly directory: string
  private readonly ownerDigest: string

  /**
   * @param root - Private Host data root dedicated to journal operations.
   * @param owner - Host-derived client/session identity; never a model-selected directory.
   * @param maxBytes - Complete durable-record and proposal byte limit.
   */
  constructor(root: string, owner: string, private readonly maxBytes: number) {
    this.ownerDigest = createHash('sha256').update(owner).digest('hex')
    this.directory = join(root, this.ownerDigest)
  }

  private file(id: PreparedJournalId): string { return join(this.directory, `${z.uuid().parse(id)}.json`) }

  private async save(record: PreparedJournalRecord): Promise<void> {
    const content = JSON.stringify(record) + '\n'
    if (Buffer.byteLength(content, 'utf8') > this.maxBytes) throw new Error('日记账记录超过大小限制。')
    await writeFileAtomic(this.file(record.id), content, { mode: 0o600, dirMode: 0o700 })
  }

  private assertCurrent(record: PreparedJournalRecord, version: number, configurationDigest: string): void {
    if (record.phase !== 'prepared') throw new Error('日记账已有发送记录或结果未知，不能修改或重复提交，请先回查。')
    if (record.version !== version || record.configurationDigest !== configurationDigest) {
      throw new Error('日记账版本或账套配置已变化，请重新预览确认。')
    }
  }

  /**
   * Validate a persisted record and rebuild its reserved request without issuing a retry.
   * @param id - Operation ID obtained from preparation.
   * @returns Owner-matched record; missing, corrupt or inconsistent files reject.
   */
  async read(id: PreparedJournalId): Promise<PreparedJournalRecord> {
    const bytes = await readFile(this.file(id))
    if (bytes.length > this.maxBytes) throw new Error('日记账记录超过大小限制。')
    const parsed = schema.parse(JSON.parse(bytes.toString('utf8')))
    if (parsed.id !== id || parsed.ownerDigest !== this.ownerDigest) throw new Error('日记账记录归属不一致。')
    const input = validateJournalPreparation(parsed.input, this.maxBytes)
    const { reservation: reserved, outcome: observed, ...fields } = parsed
    const record = { ...fields, id, input, ...observed === undefined ? {} : { outcome: observed } }
    if (reserved === undefined) return record
    const payload = buildJournalSubmission(input, reserved.selection, reserved.previousId)
    if (JSON.stringify(payload) !== JSON.stringify(reserved.payload)) throw new Error('日记账持久提交内容不一致。')
    return { ...record, reservation: { ...reserved, payload } }
  }

  /**
   * Save an unsent local proposal, without approval or external creation.
   * @param input - Untrusted proposed values.
   * @param configurationDigest - Host-computed ledger/configuration fingerprint, not credentials.
   * @returns Initial version of an owner-scoped record.
   */
  async create(input: unknown, configurationDigest: string): Promise<PreparedJournalRecord> {
    const record: PreparedJournalRecord = { schemaVersion: 1, id: randomUUID() as PreparedJournalId,
      ownerDigest: this.ownerDigest, configurationDigest: digest.parse(configurationDigest), version: 1,
      input: validateJournalPreparation(input, this.maxBytes), phase: 'prepared' }
    await this.save(record)
    return record
  }

  /**
   * Replace only an unchanged unsent proposal; previous confirmations become stale.
   * @param id - Local operation ID.
   * @param version - Version inspected by the caller.
   * @param configurationDigest - Current Host configuration fingerprint.
   * @param input - Complete replacement proposal.
   * @returns Incremented durable version.
   */
  async revise(id: PreparedJournalId, version: number, configurationDigest: string, input: unknown): Promise<PreparedJournalRecord> {
    const prepared = validateJournalPreparation(input, this.maxBytes)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertCurrent(current, version, configurationDigest)
      const next = { ...current, version: current.version + 1, input: prepared }
      await this.save(next)
      return next
    })
  }

  /**
   * Obtain exact-version authorization outside the lock, then durably reserve one send.
   * @param id - Local operation ID.
   * @param version - Previewed version.
   * @param configurationDigest - Captured Host configuration fingerprint.
   * @param authorize - Mandatory approval and fresh reference/configuration checks; no business write inside this callback.
   * @returns Reserved unknown outcome; only this successful caller may dispatch the request once.
   */
  async reserve(id: PreparedJournalId, version: number, configurationDigest: string,
    authorize: (record: PreparedJournalRecord) => Promise<{ selection: JournalReferenceSelection; previousId: string }>,
  ): Promise<PreparedJournalRecord> {
    const preview = await this.read(id)
    this.assertCurrent(preview, version, configurationDigest)
    const authorized = reservation.omit({ payload: true }).parse(await authorize(preview))
    const payload = buildJournalSubmission(preview.input, authorized.selection, authorized.previousId)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertCurrent(current, version, configurationDigest)
      const next: PreparedJournalRecord = { ...current, phase: 'outcome-unknown', reservation: { ...authorized, payload } }
      const largest = { ...next, phase: 'accepted', outcome: { state: 'accepted', journalId: '9'.repeat(200) } }
      if (Buffer.byteLength(JSON.stringify(largest) + '\n', 'utf8') > this.maxBytes) {
        throw new Error('日记账记录没有足够空间保存接口结果，不能发送。')
      }
      await this.save(next)
      return next
    })
  }

  /**
   * Persist a sanitized observation without changing the request or re-enabling submission.
   * @param id - Reserved operation ID.
   * @param version - Sent version.
   * @param result - Bounded sender classification, not a raw response.
   * @returns Durable transport state; acceptance still requires independent readback.
   */
  async recordOutcome(id: PreparedJournalId, version: number, result: JournalSubmissionOutcome): Promise<PreparedJournalRecord> {
    const observed = outcome.parse(result)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      if (current.phase !== 'outcome-unknown' || current.version !== version || current.reservation === undefined) {
        throw new Error('日记账结果必须对应尚未确认的准确发送版本。')
      }
      const next = { ...current, phase: observed.state, outcome: observed }
      await this.save(next)
      return next
    })
  }
}
