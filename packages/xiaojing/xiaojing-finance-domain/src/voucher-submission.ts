/** Ordinary Youcheng voucher request mapping; neither preparation nor payload construction grants write authority. */
import { z } from 'zod'
import { validateVoucherPreparation, type VoucherPreparationInput } from './voucher-preparation.ts'
import type { VoucherDetail } from './vouchers.ts'

/**
 * Compare the basic accounting fields of a readback with the reserved proposal, preserving duplicate entries.
 * @param detail - Identity-checked detail from the finance read adapter.
 * @param input - Exact reserved content, not a newly regenerated model proposal.
 * @param account - Reserved destination; a renamed or changed ledger is a mismatch.
 * @param voucherId - Identifier returned for this submission.
 * @returns Whether basic accounting fields match; never verifies auxiliary, foreign-currency or attachment data.
 */
export function matchesVoucherAccounting(detail: VoucherDetail, input: VoucherPreparationInput,
  account: { id: string; name: string }, voucherId: string): boolean {
  if (input.certificateCode === undefined || detail.accountId !== account.id || detail.accountName !== account.name
    || detail.voucherId !== voucherId || detail.date !== input.date || detail.period !== input.date.slice(0, 7)
    || detail.documentMaker !== input.documentMaker || detail.audited || detail.settled
    || detail.number.slice(detail.number.lastIndexOf('-') + 1) !== String(input.certificateCode)) return false
  const expected = input.entries.map(row => JSON.stringify([row.summary, row.subjectCode,
    row.side === 'debit' ? row.amount : '0.00', row.side === 'credit' ? row.amount : '0.00'])).sort()
  const observed = detail.rows.map(row => JSON.stringify([row.summary, row.subjectCode, row.debit, row.credit])).sort()
  return expected.length === observed.length && expected.every((row, index) => row === observed[index])
}

/**
 * Compare entry-bound auxiliary codes without trusting the vendor's misleading Id suffixes.
 * @param data - Bounded raw detail response corresponding to detail.
 * @param detail - Identity-checked accounting projection in original response order.
 * @param input - Exact reserved content.
 * @returns Matched, mismatched or unavailable auxiliary evidence; absent arrays never mean no auxiliary items.
 */
export function compareVoucherAuxiliary(data: unknown, detail: VoucherDetail,
  input: VoucherPreparationInput): 'matched' | 'mismatch' | 'unavailable' {
  const code = z.string().min(1)
  const parsed = z.object({ certificateLists: z.array(z.object({ auxiliaryList: z.array(z.object({
    auxiliaryCategoryTypeId: code, auxiliaryCategoryId: code,
  })).nullish() })) }).safeParse(data)
  if (!parsed.success || parsed.data.certificateLists.some(row => row.auxiliaryList == null)) return 'unavailable'
  if (parsed.data.certificateLists.length !== detail.rows.length) return 'unavailable'
  const expected = input.entries.map(row => JSON.stringify([row.summary, row.subjectCode,
    row.side === 'debit' ? row.amount : '0.00', row.side === 'credit' ? row.amount : '0.00',
    row.auxiliary.map(item => JSON.stringify([item.categoryCode, item.itemCode])).sort()])).sort()
  const observed = detail.rows.map((row, index) => JSON.stringify([row.summary, row.subjectCode, row.debit, row.credit,
    parsed.data.certificateLists[index]?.auxiliaryList?.map(item =>
      JSON.stringify([item.auxiliaryCategoryTypeId, item.auxiliaryCategoryId])).sort()])).sort()
  return expected.length === observed.length && expected.every((value, index) => value === observed[index]) ? 'matched' : 'mismatch'
}

function currencyDecimal(value: string | number | null | undefined): string | undefined {
  if (value == null) return undefined
  let text = String(value)
  if (typeof value === 'number' && /^\d(\.\d+)?e-\d+$/.test(text)) {
    const [base = '', exponent = ''] = text.split('e-')
    text = `0.${'0'.repeat(Number(exponent) - 1)}${base.replace('.', '')}`
  }
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) return undefined
  const [whole = '', fraction = ''] = text.split('.')
  const significant = fraction.replace(/0+$/, '')
  if (typeof value === 'number' && BigInt(whole + significant) > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
  return significant === '' ? whole : `${whole}.${significant}`
}

/**
 * Verify direct currency fields on their accounting and auxiliary entry, not foreignCurrencySimpleList.
 * @param data - Bounded raw response from the accepted voucher's detail endpoint.
 * @param detail - Identity-checked projection in the same entry order.
 * @param input - Exact reserved proposal, including original amounts and chosen rates.
 * @returns Missing/unsafe values are unavailable; reordered complete entries may match, swapped dimensions may not.
 */
export function compareVoucherCurrency(data: unknown, detail: VoucherDetail,
  input: VoucherPreparationInput): 'matched' | 'mismatch' | 'unavailable' {
  const decimal = z.union([z.string(), z.number()]).nullish()
  const parsed = z.object({ certificateLists: z.array(z.object({ currencyCode: z.string().nullish(),
    originalCurrencyAmount: decimal, exchangeRate: decimal,
    auxiliaryList: z.array(z.object({ auxiliaryCategoryTypeId: z.string().min(1), auxiliaryCategoryId: z.string().min(1) })).nullish(),
  })) }).safeParse(data)
  if (!parsed.success || parsed.data.certificateLists.length !== detail.rows.length) return 'unavailable'
  const currencies: (string[] | null)[] = []
  for (const row of parsed.data.certificateLists) {
    if (row.currencyCode == null || row.auxiliaryList == null) return 'unavailable'
    if (row.currencyCode === '') {
      if (row.originalCurrencyAmount != null || row.exchangeRate != null) return 'mismatch'
      currencies.push(null)
    } else {
      const amount = currencyDecimal(row.originalCurrencyAmount)
      const rate = currencyDecimal(row.exchangeRate)
      if (amount === undefined || rate === undefined) return 'unavailable'
      currencies.push([row.currencyCode, amount, rate])
    }
  }
  const expected = input.entries.map(row => JSON.stringify([row.summary, row.subjectCode,
    row.side === 'debit' ? row.amount : '0.00', row.side === 'credit' ? row.amount : '0.00',
    row.auxiliary.map(item => JSON.stringify([item.categoryCode, item.itemCode])).sort(),
    row.foreignCurrency === undefined ? null : [row.foreignCurrency.code,
      currencyDecimal(row.foreignCurrency.amount), currencyDecimal(row.foreignCurrency.exchangeRate)]])).sort()
  const observed = detail.rows.map((row, index) => JSON.stringify([row.summary, row.subjectCode, row.debit, row.credit,
    parsed.data.certificateLists[index]?.auxiliaryList?.map(item =>
      JSON.stringify([item.auxiliaryCategoryTypeId, item.auxiliaryCategoryId])).sort(), currencies[index]])).sort()
  return expected.length === observed.length && expected.every((value, index) => value === observed[index]) ? 'matched' : 'mismatch'
}

/** Host-owned destination and stable operation identity, with uploaded attachment URLs kept out of model results. */
export interface VoucherSubmissionIdentity {
  accountName: string
  appId: string
  flowId: string
  attachmentUrls: string[]
}

function numberWithoutDecimalLoss(value: string): number {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error('凭证金额或汇率不能无损转换为接口数值。')
  // Compare the actual JSON numeric spelling, not a rounded display value.
  const [base = '', exponent = '0'] = JSON.stringify(number).split('e')
  const [whole = '', fraction = ''] = base.split('.')
  const expected = BigInt(value.replace('.', ''))
  const encoded = BigInt(whole + fraction)
  const shift = (value.split('.')[1]?.length ?? 0) - fraction.length + Number(exponent)
  const equal = shift >= 0 ? expected === encoded * 10n ** BigInt(shift) : expected * 10n ** BigInt(-shift) === encoded
  if (!equal) throw new Error('凭证金额或汇率不能无损转换为接口数值。')
  return number
}

/**
 * Construct a bounded request using validated proposed fields and separately verified Host identities.
 * @param input - Prepared content; a previewed voucher number is mandatory for submission.
 * @param identity - Captured account name, appId/flowId and uploaded originals; never caller-selected credentials.
 * @param limits - Deployment entry and complete payload bounds.
 * @returns Ordinary-endpoint JSON payload; references, periods, consent and durable reservation remain caller obligations.
 */
export function buildVoucherSubmission(input: VoucherPreparationInput, identity: VoucherSubmissionIdentity,
  limits: { maxEntries: number; maxBytes: number }): object {
  const prepared = validateVoucherPreparation(input, limits).input
  if (prepared.certificateCode === undefined) throw new Error('请先确定凭证号并重新预览确认。')
  const text = z.string().trim().min(1)
  const target = z.strictObject({ accountName: text, appId: text, flowId: text,
    attachmentUrls: z.array(z.url().refine((value) => {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash
    })),
  }).parse(identity)
  if (target.attachmentUrls.length !== prepared.sourcePaths.length
    || new Set(target.attachmentUrls).size !== target.attachmentUrls.length) {
    throw new Error('凭证原件和上传链接未一一对应，不得省略失败附件。')
  }
  const payload = { accountName: target.accountName, appId: target.appId, flowId: target.flowId,
    certificateCode: prepared.certificateCode, certificateDate: prepared.date, documentMaker: prepared.documentMaker,
    attachmentUrlList: target.attachmentUrls,
    entryList: prepared.entries.map(row => ({ abstractName: row.summary, subjectCode: row.subjectCode,
      direction: row.side === 'debit' ? 0 : 1,
      ...row.side === 'debit' ? { borrorMoney: numberWithoutDecimalLoss(row.amount) } : { loanMoney: numberWithoutDecimalLoss(row.amount) },
      auxiliaryList: row.auxiliary,
      ...row.foreignCurrency === undefined ? {} : { currencyCode: row.foreignCurrency.code,
        originalCurrencyAmount: numberWithoutDecimalLoss(row.foreignCurrency.amount),
        exchangeRate: numberWithoutDecimalLoss(row.foreignCurrency.exchangeRate) },
    })),
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > limits.maxBytes) throw new Error('凭证提交内容超过大小限制。')
  return payload
}

/** Accepted means an ID was returned, not that entries or transferred originals were verified. */
export type VoucherSubmissionOutcome = { state: 'accepted'; voucherId: string }
  | { state: 'rejected'; code: number } | { state: 'outcome-unknown' }
  | { state: 'not-sent'; reason: 'preflight-failed' | 'cancelled' }

/**
 * Classify a response without forwarding provider prose, tokens or attachment URLs.
 * @param value - Parsed, byte-bounded response from the ordinary create endpoint.
 * @param httpOk - Whether the HTTP response was successful.
 * @returns Accepted identifier, documented parameter rejection, or uncertainty requiring readback without blind resubmission.
 */
export function classifyVoucherSubmission(value: unknown, httpOk: boolean): VoucherSubmissionOutcome {
  const parsed = z.object({ result: z.number().int(), data: z.unknown().optional() }).safeParse(value)
  if (!httpOk || !parsed.success) return { state: 'outcome-unknown' }
  const { result, data } = parsed.data
  if (result >= 200 && result < 300) return { state: 'rejected', code: result }
  if (result >= 100 && result < 200 && typeof data === 'string' && /^\d{1,200}$/.test(data)) {
    return { state: 'accepted', voucherId: data }
  }
  return { state: 'outcome-unknown' }
}
