/** Receipt-linked monthly journal observations; never sends, releases an intent or proves bank movement. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { resolveJournalQuery, type JournalQuery, type JournalResult, type JournalEntryId } from './journals.ts'
import { selectOpenItemWriteOffTarget, type OpenItemWriteOffInput, type OpenItemWriteOffReceiptId } from './open-item-write-off.ts'
import type { OpenItemResult } from './open-items.ts'

/** One authenticated projected journal page and its same-response raw rows/count. */
export interface WriteOffJournalPage { result: JournalResult; raw: unknown; totalCount: unknown }
/** A matched relation is distinct from source settlement and from the original transport outcome. */
export type WriteOffJournalLink = { state: 'matched'; receiptId: OpenItemWriteOffReceiptId; journalId: JournalEntryId }
  | { state: 'mismatch' | 'unavailable' }

const identifier = z.union([z.string().regex(/^[1-9]\d{0,199}$/),
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String)
const rawRow = z.looseObject({ id: identifier.optional() })
const relation = z.object({ id: identifier, relationId: identifier, channel: z.string(), subjectId: identifier,
  auxiliaryItemIds: z.string() })

/**
 * Match an accepted receipt against two complete consistent monthly inventories, including the empty final page.
 * @param input - Original validated full-settlement intent.
 * @param source - Original source page, not a substituted already-settled record.
 * @param receiptId - Original accepted receipt, not a model-supplied journal identifier.
 * @param read - Same-ledger authenticated page reader; never a writer.
 * @param signal - Cancellation of the entire readback.
 * @param limits - Accumulated raw bytes and business rows per pass, and complete result bytes.
 * @returns Unique receipt-linked journal or unavailable/mismatch; invalid, partial or changing inventories throw.
 */
export async function collectWriteOffJournalLink(input: OpenItemWriteOffInput, source: OpenItemResult,
  receiptId: OpenItemWriteOffReceiptId, read: (query: JournalQuery) => Promise<WriteOffJournalPage>, signal: AbortSignal,
  limits: { maxRows: number; maxBytes: number }): Promise<WriteOffJournalLink> {
  identifier.parse(receiptId)
  const target = selectOpenItemWriteOffTarget(input, source, { id: source.accountId, name: source.accountName })
  const selection = resolveJournalQuery({ month: input.date.slice(0, 7), page: 1, pageSize: Math.min(100, input.sourceQuery.pageSize) })
  let previous: string | undefined
  let link: WriteOffJournalLink = { state: 'unavailable' }
  for (let pass = 0; pass < 2; pass++) {
    const fingerprints = new Map<string, string>()
    const matches: Array<{ raw: unknown; row: JournalResult['rows'][number] }> = []
    let count: number | undefined
    let bytes = 0
    let ended = false
    for (let page = 1; page <= Math.ceil(limits.maxRows / selection.pageSize) + 1; page++) {
      signal.throwIfAborted()
      const response = await read({ ...selection, page })
      bytes += Buffer.byteLength(JSON.stringify(response))
      if (bytes > limits.maxBytes) throw new Error('核销关联回查累计数据超过大小限制。')
      const { result } = response
      const actualCount = z.number().int().nonnegative().max(limits.maxRows).parse(response.totalCount)
      if (count !== undefined && count !== actualCount) throw new Error('核销关联回查分页总数变化。')
      count = actualCount
      if (result.accountId !== source.accountId || result.accountName !== source.accountName
        || result.selection.month !== selection.month || result.selection.page !== page || result.selection.pageSize !== selection.pageSize
        || result.selection.cashAccountId !== undefined || result.selection.dateStart !== selection.dateStart
        || result.selection.dateEnd !== selection.dateEnd) {
        throw new Error('核销关联回查账套或查询范围不一致。')
      }
      const raw = z.array(rawRow).parse(response.raw)
      if (result.rows.length > selection.pageSize) throw new Error('核销关联回查返回页超限。')
      for (const row of result.rows) {
        const originals = raw.filter(value => value.id === row.id)
        const original = originals[0]
        if (original === undefined || originals.length !== 1 || fingerprints.has(row.id)) throw new Error('核销关联回查业务行缺失或重复。')
        fingerprints.set(row.id, createHash('sha256').update(JSON.stringify({ original, row })).digest('hex'))
        if (String(original.relationId) === receiptId) matches.push({ raw: original, row })
      }
      if (fingerprints.size > actualCount) throw new Error('核销关联回查数量与总数不一致。')
      if (result.rows.length === 0) { ended = true; break }
    }
    if (!ended || count === undefined || fingerprints.size !== count) throw new Error('核销关联回查月份清单不完整。')
    const fingerprint = JSON.stringify([...fingerprints])
    if (previous !== undefined && previous !== fingerprint) throw new Error('核销关联回查两次结果不一致。')
    previous = fingerprint
    const match = matches[0]
    if (matches.length !== 1 || match === undefined) link = { state: 'unavailable' }
    else {
      const parsed = relation.safeParse(match.raw)
      if (!parsed.success) link = { state: 'unavailable' }
      else {
        const row = match.row
        const income = input.direction === 'receivable'
        const opposite = income ? row.expense : row.income
        const matched = parsed.data.relationId === receiptId && parsed.data.channel === 'WRITE_OFF'
          && parsed.data.subjectId === input.cashAccountId && parsed.data.auxiliaryItemIds === target.auxiliaryItemIds
          && row.date === input.date && row.currencyCode === input.currencyCode && row.baseCurrencyCode === target.baseCurrencyCode
          && (income ? row.income : row.expense) === input.amount && (opposite === null || opposite === '0.00')
        link = matched ? { state: 'matched', receiptId, journalId: row.id } : { state: 'mismatch' }
      }
    }
  }
  signal.throwIfAborted()
  if (Buffer.byteLength(JSON.stringify(link)) > limits.maxBytes) throw new Error('核销关联回查结果超过大小限制。')
  return link
}
