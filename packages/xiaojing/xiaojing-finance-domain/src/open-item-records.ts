/** Owner-scoped open-item versions and durable single-send reservations, using the existing atomic-file primitives. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { buildOpenItemSubmission, validateOpenItemPreparation, type OpenItemPreparationInput } from './open-item-preparation.ts'
import { openItemOutcomeSchema, type OpenItemSubmissionOutcome } from './open-item-submission.ts'

/** Local operation identity, distinct from the accepted vendor record ID. */
export type PreparedOpenItemId = Branded<'PreparedOpenItemId'>
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const referenceId = z.string().regex(/^[1-9]\d*$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
  .transform(value => value as Branded<'FinanceReferenceId'>)
const counterpartySchema = z.strictObject({ categoryId: referenceId, categoryCode: z.string().min(1),
  categoryName: z.string().min(1), itemId: referenceId, itemCode: z.string().min(1), itemName: z.string().min(1),
  itemStatus: z.enum(['enabled', 'unknown']), wireName: z.string().min(1) })
const selectionSchema = z.strictObject({ ledgerId: z.string().min(1), ledgerName: z.string().min(1),
  accountId: referenceId, accountName: z.string().min(1), currencyCode: z.string().min(1),
  categoryId: referenceId, categoryName: z.string().min(1), counterparty: counterpartySchema })

/** Exact Host-verified values shown for approval and retained for independent readback. */
export type OpenItemReservedSelection = z.infer<typeof selectionSchema>
const reservationSchema = z.strictObject({ selection: selectionSchema, payload: z.unknown() })
const recordSchema = z.strictObject({ schemaVersion: z.literal(1), id: z.uuid(), ownerDigest: digest,
  configurationDigest: digest, version: z.number().int().positive(), input: z.unknown(),
  phase: z.enum(['prepared', 'outcome-unknown', 'accepted', 'rejected', 'not-sent']),
  reservation: reservationSchema.optional(), outcome: openItemOutcomeSchema.optional(),
}).refine(record => record.phase === 'prepared' ? record.reservation === undefined && record.outcome === undefined
  : record.reservation !== undefined && (record.outcome === undefined ? record.phase === 'outcome-unknown' : record.phase === record.outcome.state))

/** A reserved version cannot be revised or automatically sent again, including after restart. */
export interface PreparedOpenItemRecord {
  schemaVersion: 1
  id: PreparedOpenItemId
  ownerDigest: string
  configurationDigest: string
  version: number
  input: OpenItemPreparationInput
  phase: 'prepared' | OpenItemSubmissionOutcome['state']
  reservation?: { selection: OpenItemReservedSelection; payload: object }
  outcome?: OpenItemSubmissionOutcome
}

function buildPayload(input: OpenItemPreparationInput, selection: OpenItemReservedSelection): object {
  if (input.accountId !== selection.accountId || input.categoryId !== selection.categoryId) {
    throw new Error('往来预览的账户或收支类别与已核验资料不一致。')
  }
  return buildOpenItemSubmission(input, selection.ledgerName, selection.categoryName, selection.counterparty)
}

/** Per-operation reservations; no cross-device or semantically identical new-operation deduplication claim. */
export class OpenItemRecords {
  private readonly ownerDigest: string
  private readonly directory: string

  /**
   * @param root - Private Host directory dedicated to open-item operations.
   * @param owner - Host-derived client/session identity, never model-selected.
   * @param maxBytes - Complete proposal and durable-record limit, including outcome capacity.
   */
  constructor(root: string, owner: string, private readonly maxBytes: number) {
    this.ownerDigest = createHash('sha256').update(owner).digest('hex')
    this.directory = join(root, this.ownerDigest)
  }

  private file(id: PreparedOpenItemId): string { return join(this.directory, `${z.uuid().parse(id)}.json`) }

  private async save(record: PreparedOpenItemRecord): Promise<void> {
    const text = JSON.stringify(record) + '\n'
    if (Buffer.byteLength(text, 'utf8') > this.maxBytes) throw new Error('往来记录超过大小限制。')
    await writeFileAtomic(this.file(record.id), text, { mode: 0o600, dirMode: 0o700 })
  }

  private assertCurrent(record: PreparedOpenItemRecord, version: number, configurationDigest: string): void {
    if (record.phase !== 'prepared') throw new Error('往来已有发送记录或结果未知，不能修改或重复提交，请先回查。')
    if (record.version !== version || record.configurationDigest !== configurationDigest) {
      throw new Error('往来版本或账套配置已变化，请重新预览确认。')
    }
  }

  /**
   * Validate stored ownership and reconstruct the exact reserved request without sending it.
   * @param id - Local operation identity returned by preparation.
   * @returns Stored state; missing, oversized, corrupt or inconsistent records reject.
   */
  async read(id: PreparedOpenItemId): Promise<PreparedOpenItemRecord> {
    const bytes = await readFile(this.file(id))
    if (bytes.length > this.maxBytes) throw new Error('往来记录超过大小限制。')
    const parsed = recordSchema.parse(JSON.parse(bytes.toString('utf8')))
    if (parsed.id !== id || parsed.ownerDigest !== this.ownerDigest) throw new Error('往来记录归属不一致。')
    const input = validateOpenItemPreparation(parsed.input, this.maxBytes)
    const { reservation, outcome, ...fields } = parsed
    const record = { ...fields, id, input, ...outcome === undefined ? {} : { outcome } }
    if (reservation === undefined) return record
    const payload = buildPayload(input, reservation.selection)
    if (JSON.stringify(payload) !== JSON.stringify(reservation.payload)) throw new Error('往来持久提交内容不一致。')
    return { ...record, reservation: { selection: reservation.selection, payload } }
  }

  /**
   * Persist an unsent proposal, not an approval or vendor creation.
   * @param input - Untrusted business values.
   * @param configurationDigest - Host-generated configuration/credential revision fingerprint, never a secret.
   * @returns Initial owner-scoped version.
   */
  async create(input: unknown, configurationDigest: string): Promise<PreparedOpenItemRecord> {
    const record: PreparedOpenItemRecord = { schemaVersion: 1, id: randomUUID() as PreparedOpenItemId,
      ownerDigest: this.ownerDigest, configurationDigest: digest.parse(configurationDigest), version: 1,
      input: validateOpenItemPreparation(input, this.maxBytes), phase: 'prepared' }
    await this.save(record)
    return record
  }

  /**
   * Replace only the exact unsent version; any earlier confirmation becomes stale.
   * @param id - Local operation ID.
   * @param version - Previously inspected version.
   * @param configurationDigest - Current Host configuration fingerprint.
   * @param input - Complete replacement business values.
   * @returns Incremented persisted version.
   */
  async revise(id: PreparedOpenItemId, version: number, configurationDigest: string, input: unknown): Promise<PreparedOpenItemRecord> {
    const validated = validateOpenItemPreparation(input, this.maxBytes)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertCurrent(current, version, configurationDigest)
      const next = { ...current, version: current.version + 1, input: validated }
      await this.save(next)
      return next
    })
  }

  /**
   * Obtain mandatory exact-version approval outside the lock, then atomically reserve one send.
   * @param id - Local operation ID.
   * @param version - Previewed version.
   * @param configurationDigest - Captured Host configuration fingerprint.
   * @param authorize - Host approval and fresh reference/configuration checks; must perform no business write.
   * @returns Durable uncertainty; only the successful reserving caller may dispatch once.
   */
  async reserve(id: PreparedOpenItemId, version: number, configurationDigest: string,
    authorize: (record: PreparedOpenItemRecord) => Promise<OpenItemReservedSelection>): Promise<PreparedOpenItemRecord> {
    const preview = await this.read(id)
    this.assertCurrent(preview, version, configurationDigest)
    const selection = selectionSchema.parse(await authorize(preview))
    const payload = buildPayload(preview.input, selection)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      this.assertCurrent(current, version, configurationDigest)
      const next: PreparedOpenItemRecord = { ...current, phase: 'outcome-unknown', reservation: { selection, payload } }
      const largest = { ...next, phase: 'accepted', outcome: { state: 'accepted', openItemId: '9'.repeat(200) } }
      if (Buffer.byteLength(JSON.stringify(largest) + '\n', 'utf8') > this.maxBytes) {
        throw new Error('往来记录没有足够空间保存接口结果，不能发送。')
      }
      await this.save(next)
      return next
    })
  }

  /**
   * Save one bounded transport observation without modifying its request or allowing a retry.
   * @param id - Reserved operation identity.
   * @param version - Originally sent version.
   * @param result - Sanitized sender outcome, not vendor response JSON or readback completion.
   * @returns Durable outcome; accepted records still require independent business verification.
   */
  async recordOutcome(id: PreparedOpenItemId, version: number, result: OpenItemSubmissionOutcome): Promise<PreparedOpenItemRecord> {
    const observed = openItemOutcomeSchema.parse(result)
    return withFileLock(this.file(id) + '.lock', async () => {
      const current = await this.read(id)
      if (current.phase !== 'outcome-unknown' || current.version !== version || current.reservation === undefined
        || current.outcome !== undefined) throw new Error('往来结果必须对应尚未记录结果的准确发送版本。')
      const next = { ...current, phase: observed.state, outcome: observed }
      await this.save(next)
      return next
    })
  }
}
