/** Local full-settlement checks and observed balance comparison; no dispatch or payment authority. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { openItemQuerySchema, type OpenItemResult, type OpenItemRow } from './open-items.ts'
import type { ReferenceResult, ReferenceRow } from './references.ts'

const positiveId = z.string().regex(/^[1-9]\d*$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
const amount = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/).refine((value) => {
  const cents = BigInt(value.replace('.', ''))
  const [whole, fraction = ''] = String(Number(value)).split('.')
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) && `${whole}.${fraction.padEnd(2, '0')}` === value
}, '核销金额必须为可无损传递的正数，保留两位小数。')
const schema = z.strictObject({
  direction: z.enum(['receivable', 'payable']),
  openItemId: positiveId.transform(value => value as Branded<'FinanceOpenItemId'>),
  cashAccountId: positiveId.transform(value => value as Branded<'FinanceReferenceId'>),
  amount, currencyCode: z.string().trim().min(1), date: z.iso.date(), keeperName: z.string().trim().min(1),
  sourceQuery: openItemQuerySchema,
}).refine(value => value.direction === value.sourceQuery.direction, '核销方向必须与目标查询方向一致。')

const rawPage = z.object({ list: z.array(z.looseObject({
  id: z.union([z.string(), z.number().int().refine(Number.isSafeInteger)]).transform(String),
})) })
const identifier = z.union([z.string(), z.number().int().refine(Number.isSafeInteger)]).transform(String).pipe(positiveId)
const linkId = z.union([z.string(), z.number().int().refine(Number.isSafeInteger)]).nullish()
const rawIdentity = z.object({ id: identifier, setOfBooksId: identifier, subjectId: identifier })
const rawState = z.object({
  id: identifier, setOfBooksId: identifier, subjectId: identifier,
  accountStatus: z.literal(0), initialBalance: z.literal(false), isFinish: z.literal(false),
  certificateWordAndCode: z.literal(''), orderCode: z.literal(''),
  certificateId: linkId, tempCertificateId: linkId,
})

/** IDs distinguish an open item from its cash account; neither is resolved from a name. */
export type OpenItemWriteOffInput = z.infer<typeof schema>

/** Vendor response identifier; not a qualified journal ID or independently queryable write-off ID. */
export type OpenItemWriteOffReceiptId = Branded<'OpenItemWriteOffReceiptId'>
/** Last pre-dispatch check reached; never includes vendor messages, credentials or retry permission. */
export const writeOffPreflightStageSchema = z.enum(['input', 'cash-account', 'authentication', 'source-read',
  'cash-read', 'evidence-comparison', 'ledger-read', 'ledger-identity', 'final-confirmation', 'request-integrity'])
/** A single transport observation does not establish settlement, journal linkage or bank movement. */
export type OpenItemWriteOffOutcome = { state: 'accepted'; receiptId: OpenItemWriteOffReceiptId }
  | { state: 'rejected'; code: number } | { state: 'outcome-unknown' }
  | { state: 'not-sent'; reason: 'preflight-failed' | 'cancelled'; preflightStage?: z.infer<typeof writeOffPreflightStageSchema> }

/**
 * Retain the observed string response identifier without treating it as a journal link.
 * @param value - Untrusted, already bounded response JSON.
 * @param httpOk - Whether HTTP itself succeeded.
 * @returns Accepted receipt, explicit rejection or uncertainty; none permits automatic resend.
 */
export function classifyOpenItemWriteOff(value: unknown, httpOk: boolean): OpenItemWriteOffOutcome {
  const parsed = z.object({ result: z.number().int(), data: z.unknown().optional() }).safeParse(value)
  if (!httpOk || !parsed.success) return { state: 'outcome-unknown' }
  const { result, data } = parsed.data
  if (result >= 200 && result < 300) return { state: 'rejected', code: result }
  if (result >= 100 && result < 200 && typeof data === 'string' && /^[1-9]\d{0,199}$/.test(data)) {
    return { state: 'accepted', receiptId: data as OpenItemWriteOffReceiptId }
  }
  return { state: 'outcome-unknown' }
}

/**
 * Validate untrusted local intent, not vendor parameters or user approval.
 * @param input - Model or durable JSON; journal links, endpoint and consent overrides are rejected.
 * @param maxBytes - Limit for the complete normalized input.
 * @returns Exact positive money and an explicit direction-bound source query; does not authorize sending.
 */
export function validateOpenItemWriteOff(input: unknown, maxBytes: number): OpenItemWriteOffInput {
  const value = schema.parse(input)
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new Error('核销准备内容超过大小限制。')
  return value
}

/**
 * Reject observed raw restrictions discarded by the ordinary business-row projection.
 * @param data - Bounded raw JSON from the same authenticated response as page.
 * @param page - Validated projected response; period and currency eligibility are separate caller obligations.
 * @param input - Exact validated intent, not a name-based target.
 * @returns Observed business-account ID; throws for missing state, disabled accounts, wrong ledger or known links.
 */
export function readOpenItemWriteOffBusinessAccount(data: unknown, page: OpenItemResult,
  input: OpenItemWriteOffInput): Branded<'FinanceReferenceId'> {
  const rows = rawPage.parse(data).list.filter(row => row.id === input.openItemId)
  if (rows.length !== 1) throw new Error('核销原始目标不存在或不唯一。')
  const detail = rawState.parse(rows[0])
  if (detail.setOfBooksId !== page.accountId) throw new Error('核销原始目标账套不符。')
  if ([detail.certificateId, detail.tempCertificateId].some(value => value != null && value !== '' && value !== 0 && value !== '0')) {
    throw new Error('往来关联凭证的核销影响尚未核实。')
  }
  return detail.subjectId as Branded<'FinanceReferenceId'>
}

/**
 * Read identity independently of whether a target is still open or eligible for another write.
 * @param data - Bounded raw JSON from the same authenticated response as page.
 * @param page - Validated projected result, whose content remains useful when identity is missing.
 * @param openItemId - Original exact target ID.
 * @returns Same-ledger business-account ID, or undefined for absent, ambiguous or invalid identity metadata.
 */
export function readOpenItemWriteOffIdentity(data: unknown, page: OpenItemResult,
  openItemId: string): Branded<'FinanceReferenceId'> | undefined {
  const rows = rawPage.parse(data).list.filter(row => row.id === openItemId)
  if (rows.length !== 1) return undefined
  const detail = rawIdentity.safeParse(rows[0])
  if (!detail.success || detail.data.setOfBooksId !== page.accountId) return undefined
  return detail.data.subjectId as Branded<'FinanceReferenceId'>
}

/**
 * Select a whole remaining balance from a fresh page in the already authenticated ledger.
 * @param input - Validated immutable intent.
 * @param page - Fresh projected source page; raw status and cash-account eligibility require separate checks.
 * @param ledger - Host-verified destination, never a model-supplied override.
 * @returns The exact observed target; rejects partial amounts, unknown settlement components and currency changes.
 */
export function selectOpenItemWriteOffTarget(input: OpenItemWriteOffInput, page: OpenItemResult,
  ledger: { id: string; name: string }): OpenItemRow {
  if (page.accountId !== ledger.id || page.accountName !== ledger.name
    || Object.entries(input.sourceQuery).some(([key, value]) => page.selection[key as keyof typeof page.selection] !== value)) {
    throw new Error('核销目标查询的账套、方向或范围不一致。')
  }
  const rows = page.rows.filter(row => row.id === input.openItemId)
  const row = rows[0]
  if (rows.length !== 1 || row === undefined) throw new Error('核销目标不存在或不唯一，不能按名称替代。')
  if (row.date.slice(0, 7) < input.sourceQuery.periodStart || row.date.slice(0, 7) > input.sourceQuery.periodEnd
    || input.date < row.date) throw new Error('核销目标期间不符或核销日期早于业务日期。')
  if (row.currencyCode !== input.currencyCode) throw new Error('核销币种与目标记录不一致，不自动换算。')
  if (row.initialBalance !== false || row.finished !== false) throw new Error('期初或已结清往来不在当前核销范围，缺失状态不能当作未结清。')
  if (row.amount === null || BigInt(row.amount.replace('.', '')) <= 0n || row.balance !== input.amount) {
    throw new Error('核销金额必须等于最新正数未结余额，当前不支持部分核销。')
  }
  if ([row.settledAmount, row.badDebtAmount, row.offsetAmount, row.returnAmount].some(value => value === null)) {
    throw new Error('核销目标缺少收付或核销组成金额，不能按零处理。')
  }
  return row
}

/**
 * Resolve a base-currency cash account through its currently enabled, non-foreign-currency leaf subject.
 * @param input - Exact full-settlement intent.
 * @param source - Same-ledger target carrying its original and base currency codes.
 * @param accounts - Current cash-account references; numeric currency IDs are not decoded or hardcoded.
 * @param subjects - Current exact-code subject references with explicit currency configuration.
 * @returns Cash and subject evidence for confirmation; foreign, missing or ambiguous configuration rejects.
 */
export function selectBaseCurrencyWriteOffCash(input: OpenItemWriteOffInput, source: OpenItemResult,
  accounts: ReferenceResult, subjects: ReferenceResult): { cashAccount: ReferenceRow; subject: ReferenceRow; currencyCode: string } {
  const target = selectOpenItemWriteOffTarget(input, source, { id: source.accountId, name: source.accountName })
  if (accounts.kind !== 'cash-accounts' || subjects.kind !== 'subjects'
    || [accounts, subjects].some(value => value.accountId !== source.accountId || value.accountName !== source.accountName)) {
    throw new Error('核销资金账户或科目不属于当前账套。')
  }
  const matches = accounts.rows.filter(row => row.id === input.cashAccountId)
  const cashAccount = matches[0]
  if (matches.length !== 1 || cashAccount?.status !== 'enabled' || !cashAccount.code || !cashAccount.currencyId) {
    throw new Error('核销资金账户缺少可用状态、科目或币种标识。')
  }
  const matchedSubjects = subjects.rows.filter(row => row.code === cashAccount.code)
  const subject = matchedSubjects[0]
  if (matchedSubjects.length !== 1 || subject?.status !== 'enabled' || subject.hasChildren !== false
    || subject.currencyCodes === undefined || subject.currencyCodes.length !== 0
    || target.baseCurrencyCode === '' || input.currencyCode !== target.baseCurrencyCode) {
    throw new Error('当前核销执行要求本位币往来和未启用外币核算的末级资金科目；不猜币种映射或换算。')
  }
  return { cashAccount, subject, currencyCode: target.baseCurrencyCode }
}

/** Independent observations cannot attribute a balance change to this operation or prove a bank movement. */
export interface OpenItemWriteOffReadback {
  content: 'matched' | 'mismatch' | 'unavailable'
  settlement: 'matched' | 'mismatch' | 'unavailable'
  operation: 'unverified'
}

/**
 * Compare one full-settlement expectation with a separately queried same-ledger, same-direction record.
 * @param input - Original validated intent; never rewritten from the readback.
 * @param before - Original source page matching that intent and containing its target.
 * @param after - Independently queried page, or undefined on a failed query.
 * @returns Content and exact settlement observations; no complete/success result without operation-link evidence.
 */
export function compareOpenItemWriteOff(input: OpenItemWriteOffInput, before: OpenItemResult,
  after: OpenItemResult | undefined): OpenItemWriteOffReadback {
  const unavailable: OpenItemWriteOffReadback = { content: 'unavailable', settlement: 'unavailable', operation: 'unverified' }
  const original = selectOpenItemWriteOffTarget(input, before, { id: before.accountId, name: before.accountName })
  if (after === undefined) return unavailable
  if (after.accountId !== before.accountId || after.accountName !== before.accountName
    || after.selection.direction !== input.direction || after.selection.periodStart !== input.sourceQuery.periodStart
    || after.selection.periodEnd !== input.sourceQuery.periodEnd) return { ...unavailable, content: 'mismatch' }
  const rows = after.rows.filter(row => row.id === input.openItemId)
  const row = rows[0]
  if (rows.length !== 1 || row === undefined) return unavailable
  const contentFields = ['id', 'date', 'summary', 'subjectCode', 'subjectName', 'auxiliaryItemIds', 'auxiliaryItemName',
    'currencyCode', 'baseCurrencyCode', 'amount', 'baseAmount', 'categoryName', 'remark', 'initialBalance'] as const
  const content = contentFields.every(field => row[field] === original[field]) ? 'matched' : 'mismatch'
  const settledBefore = original.settledAmount
  const settledAfter = row.settledAmount
  if (settledBefore === null || settledAfter === null || row.balance === null || row.finished === null
    || [row.badDebtAmount, row.offsetAmount, row.returnAmount].some(value => value === null)) return { ...unavailable, content }
  const unchanged = (['badDebtAmount', 'offsetAmount', 'returnAmount'] as const).every(field => row[field] === original[field])
  const delta = BigInt(settledAfter.replace('.', '')) - BigInt(settledBefore.replace('.', ''))
  const matched = row.balance === '0.00' && row.finished && unchanged && delta === BigInt(input.amount.replace('.', ''))
  return { content, settlement: matched ? 'matched' : 'mismatch', operation: 'unverified' }
}
