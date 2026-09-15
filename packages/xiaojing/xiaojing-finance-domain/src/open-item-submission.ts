/** Open-item transport classification and independent business readback; no request dispatch or retry. */
import { z } from 'zod'
import type { OpenItemPreparationInput, OpenItemCounterparty } from './open-item-preparation.ts'
import type { OpenItemResult } from './open-items.ts'

/** Sanitized send observation; accepted IDs never imply complete business verification. */
export const openItemOutcomeSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('accepted'), openItemId: z.string().regex(/^[1-9]\d{0,199}$/) }),
  z.strictObject({ state: z.literal('rejected'), code: z.number().int().min(200).max(299) }),
  z.strictObject({ state: z.literal('outcome-unknown') }),
  z.strictObject({ state: z.literal('not-sent'), reason: z.enum(['preflight-failed', 'cancelled']) }),
])

/** Persistent transport state, separate from current readback observations. */
export type OpenItemSubmissionOutcome = z.infer<typeof openItemOutcomeSchema>

/** Original approval-time values, not rewritten from the subsequently returned record. */
export interface OpenItemReadbackSelection {
  ledgerId: string
  ledgerName: string
  accountName: string
  currencyCode: string
  counterparty: OpenItemCounterparty
}

/** Independent dimensions; unknown settlement amounts do not become zero. */
export interface OpenItemReadback {
  content: 'matched' | 'mismatch' | 'unavailable'
  associations: 'matched' | 'mismatch' | 'unavailable'
  balance: 'matched' | 'mismatch' | 'unavailable'
  complete: boolean
}

/**
 * Interpret a bounded public creation response without returning vendor text or granting retry permission.
 * @param value - Parsed vendor JSON.
 * @param httpOk - Whether HTTP itself succeeded.
 * @returns A qualified string ID, explicit parameter rejection or uncertainty.
 */
export function classifyOpenItemSubmission(value: unknown, httpOk: boolean): OpenItemSubmissionOutcome {
  const parsed = z.object({ result: z.number().int(), data: z.unknown().optional() }).safeParse(value)
  if (!httpOk || !parsed.success) return { state: 'outcome-unknown' }
  const { result, data } = parsed.data
  if (result >= 200 && result < 300) return { state: 'rejected', code: result }
  if (result >= 100 && result < 200 && typeof data === 'string' && /^[1-9]\d{0,199}$/.test(data)) {
    return { state: 'accepted', openItemId: data }
  }
  return { state: 'outcome-unknown' }
}

/**
 * Compare the original accepted ID with a separately queried page and its bounded raw rows.
 * @param page - Validated page for the reserved ledger and direction.
 * @param raw - That page's original vendor data, used for account/category IDs and maker/linkage fields.
 * @param openItemId - ID returned by the original submission; never a summary-based match.
 * @param input - Immutable submitted business values.
 * @param selection - Original confirmed ledger, currency, account and counterparty names.
 * @returns Per-record verification only; no assertion of actual bank receipts/payments or full-ledger coverage.
 */
export function compareOpenItemReadback(page: OpenItemResult, raw: unknown, openItemId: string,
  input: OpenItemPreparationInput, selection: OpenItemReadbackSelection): OpenItemReadback {
  const unavailable: OpenItemReadback = { content: 'unavailable', associations: 'unavailable', balance: 'unavailable', complete: false }
  if (page.accountId !== selection.ledgerId || page.accountName !== selection.ledgerName
    || page.selection.direction !== input.direction) return { ...unavailable, content: 'mismatch' }
  const matches = page.rows.filter(row => row.id === openItemId)
  const row = matches[0]
  if (matches.length !== 1 || row === undefined) return unavailable
  const content = row.date === input.date && row.summary === input.summary && row.amount === input.amount
    && row.currencyCode === selection.currencyCode ? 'matched' : 'mismatch'
  const amounts = [row.settledAmount, row.badDebtAmount, row.offsetAmount, row.returnAmount]
  const balance = row.balance !== input.amount || amounts.some(value => value !== null && value !== '0.00')
    || row.initialBalance === true || row.finished === true ? 'mismatch'
    : amounts.some(value => value === null) || row.initialBalance === null || row.finished === null ? 'unavailable' : 'matched'
  const identity = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive()]).transform(String)
  const parsed = z.object({ list: z.array(z.looseObject({
    id: z.union([z.string(), z.number().int()]).transform(String),
  })) }).safeParse(raw)
  const details = parsed.success ? parsed.data.list.filter(item => item.id === openItemId) : []
  const linked = z.object({ subjectId: identity, categoryId: identity, keeperName: z.string(),
    attachList: z.array(z.unknown()), certificateWordAndCode: z.string(), orderCode: z.string(),
  }).safeParse(details.length === 1 ? details[0] : undefined)
  const counterpartyMatches = row.auxiliaryItemIds === input.auxiliaryItemId
    && row.auxiliaryItemIds === selection.counterparty.itemId && row.auxiliaryItemName === selection.counterparty.itemName
    && row.subjectName === selection.accountName
  const associations = !counterpartyMatches ? 'mismatch' : !linked.success ? 'unavailable'
    : linked.data.subjectId === input.accountId && linked.data.categoryId === input.categoryId
      && linked.data.keeperName === input.keeperName && linked.data.attachList.length === 0
      && linked.data.certificateWordAndCode === '' && linked.data.orderCode === '' ? 'matched' : 'mismatch'
  return { content, associations, balance, complete: content === 'matched' && associations === 'matched' && balance === 'matched' }
}
