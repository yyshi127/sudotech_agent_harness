/** Sanitized journal response classification; acceptance does not establish readback success. */
import { z } from 'zod'
import type { JournalSubmissionOutcome } from './journal-records.ts'
import type { JournalPreparationInput, JournalReferenceSelection } from './journal-preparation.ts'
import type { JournalResult } from './journals.ts'

/** Independent comparison of the returned record; an unavailable read never proves absence. */
export interface JournalReadback {
  content: 'matched' | 'mismatch' | 'unavailable'
  associations: 'matched' | 'mismatch' | 'unavailable'
  complete: boolean
}

/**
 * Compare one identity-checked page with the exact reserved journal.
 * @param page - Validated query page for the reserved ledger and cash account.
 * @param raw - The same page's bounded vendor data, used only for linkage and audit checks.
 * @param journalId - ID returned by the original submission, never a name-based guess.
 * @param input - Exact reserved business values.
 * @param selection - Exact approved ledger and cash account/category labels.
 * @param previousId - Reserved insertion predecessor.
 * @returns Field/linkage comparisons; no inference about full ledger coverage or actual money movement.
 */
export function compareJournalReadback(page: JournalResult, raw: unknown, journalId: string,
  input: JournalPreparationInput, selection: JournalReferenceSelection, previousId: string): JournalReadback {
  if (page.accountId !== selection.accountId || page.accountName !== selection.accountName
    || page.selection.cashAccountId !== input.cashAccountId) return { content: 'mismatch', associations: 'unavailable', complete: false }
  const matches = page.rows.filter(row => row.id === journalId)
  const row = matches[0]
  if (matches.length !== 1 || row === undefined) return { content: 'unavailable', associations: 'unavailable', complete: false }
  const parsed = z.array(z.looseObject({ id: z.union([z.string(), z.number().int()]).optional() })).safeParse(raw)
  const detail = parsed.success ? parsed.data.filter(item => String(item.id) === journalId) : []
  const categoryId = detail.length === 1 ? detail[0]?.categoryId : undefined
  const category = input.categoryId === undefined
    ? row.categoryName === '' && (categoryId == null || categoryId === '') ? 'matched' : 'mismatch'
    : categoryId == null ? 'unavailable'
      : (typeof categoryId === 'string' || typeof categoryId === 'number') && String(categoryId) === input.categoryId ? 'matched' : 'mismatch'
  const active = input.direction === 'income' ? row.income : row.expense
  const inactive = input.direction === 'income' ? row.expense : row.income
  const content = active === null || category === 'unavailable' ? 'unavailable'
    : row.date === input.date && row.summary === input.summary && row.keeperName === input.keeperName
      && category === 'matched' && active === input.amount && (inactive === null || inactive === '0.00') ? 'matched' : 'mismatch'
  const linked = z.object({ preId: z.union([z.string(), z.number().int()]).transform(String),
    reviewStatus: z.number().int(), reviewUser: z.string(), reviewUserId: z.string(),
    certificateWordAndCode: z.string(), cashManagementId: z.string(), auxiliaryItemIds: z.string(),
    orderCode: z.string(), relationOrderCodeList: z.array(z.unknown()), attachList: z.array(z.unknown()),
    certificateId: z.union([z.string(), z.number()]).nullish(), tempCertificateId: z.union([z.string(), z.number()]).nullish(),
  }).safeParse(detail.length === 1 ? detail[0] : undefined)
  if (!linked.success) return { content, associations: 'unavailable', complete: false }
  const record = linked.data
  const associations = record.preId === previousId && record.reviewStatus === 0 && record.reviewUser === ''
    && record.reviewUserId === '' && record.certificateWordAndCode === '' && record.cashManagementId === ''
    && record.auxiliaryItemIds === '' && record.orderCode === '' && record.relationOrderCodeList.length === 0
    && record.attachList.length === 0 && (record.certificateId == null || record.certificateId === '')
    && (record.tempCertificateId == null || record.tempCertificateId === '') ? 'matched' : 'mismatch'
  return { content, associations, complete: content === 'matched' && associations === 'matched' }
}

/**
 * Classify a bounded response from the financial journal add endpoint.
 * @param value - Parsed vendor JSON; messages and arbitrary data are never forwarded.
 * @param httpOk - Whether the response has a successful HTTP status.
 * @returns Returned journal identity, documented parameter rejection or uncertainty without retry permission.
 */
export function classifyJournalSubmission(value: unknown, httpOk: boolean): JournalSubmissionOutcome {
  const parsed = z.object({ result: z.number().int(), data: z.unknown().optional() }).safeParse(value)
  if (!httpOk || !parsed.success) return { state: 'outcome-unknown' }
  const { result, data } = parsed.data
  if (result >= 200 && result < 300) return { state: 'rejected', code: result }
  if (result >= 100 && result < 200 && typeof data === 'string' && /^[1-9]\d{0,199}$/.test(data)) {
    return { state: 'accepted', journalId: data }
  }
  return { state: 'outcome-unknown' }
}
