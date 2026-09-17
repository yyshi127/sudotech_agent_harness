/** Local voucher input validation; successful parsing is neither reference validation nor write consent. */
import { z } from 'zod'

const text = z.string().trim().min(1)
const decimal = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/)
const positiveAmount = decimal.refine(value => /[1-9]/.test(value), '金额必须大于零。')
const positiveRate = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/)
  .refine(value => /[1-9]/.test(value), '汇率必须大于零。')
/** User-facing format rejection shared by command and business-input validation. */
export const VOUCHER_ATTACHMENT_FORMAT_ERROR = '来源文件仅支持 PDF、PNG、JPG 或 JPEG。'
const sourcePath = text.refine(value => /\.(pdf|png|jpe?g)$/iu.test(value),
  VOUCHER_ATTACHMENT_FORMAT_ERROR)
const auxiliary = z.strictObject({ categoryCode: text, itemCode: text })
const entry = z.strictObject({
  summary: text, subjectCode: text, side: z.enum(['debit', 'credit']), amount: positiveAmount,
  auxiliary: z.array(auxiliary),
  foreignCurrency: z.strictObject({ code: text, amount: positiveAmount, exchangeRate: positiveRate }).optional(),
}).refine(value => new Set(value.auxiliary.map(item => item.categoryCode)).size === value.auxiliary.length,
  '一条分录的同一辅助类别只能选择一个项目。')
const inputSchema = z.strictObject({
  date: z.iso.date(), documentMaker: text, certificateCode: z.number().int().min(1).max(2147483647).optional(),
  entries: z.array(entry).min(2),
  sourcePaths: z.array(sourcePath),
}).refine(value => new Set(value.sourcePaths).size === value.sourcePaths.length, '来源文件不能重复。')

/** Preparation-only commands; an existing version is mandatory for changes, and no submit command is admitted. */
export const voucherPreparationRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('prepare'), input: inputSchema }),
  z.strictObject({ action: z.literal('revise'), id: z.uuid(), version: z.number().int().positive(), input: inputSchema }),
  z.strictObject({ action: z.literal('inspect'), id: z.uuid() }),
])

/** Creation accepts only an existing local version; content, destination and approval remain Host-owned. */
export const voucherCreateRequestSchema = z.strictObject({ id: z.uuid(), version: z.number().int().positive() })

/** User-proposed values; amount is ledger-base currency, optional foreignCurrency retains original amounts. */
export type VoucherPreparationInput = z.infer<typeof inputSchema>

/** Balanced proposed entries, still awaiting ledger/reference/period/file validation and human approval. */
export interface VoucherPreparation {
  input: VoucherPreparationInput
  totalDebit: string
  totalCredit: string
}

/**
 * Parse untrusted proposed entries and compute exact cent totals without network or file operations.
 * @param input - Tool or persisted JSON; does not accept ledger, credential, URL or approval overrides.
 * @param limits - Deployment maximum entry count and full input byte size.
 * @returns Balanced proposed values with per-entry decimal half-up currency conversion checked;
 *   does not certify the chosen rate, subjects, periods or source ownership.
 */
export function validateVoucherPreparation(input: unknown, limits: { maxEntries: number; maxBytes: number }): VoucherPreparation {
  if (input === undefined) throw new Error('凭证输入不是有效 JSON。')
  const serialized = JSON.stringify(input)
  if (Buffer.byteLength(serialized, 'utf8') > limits.maxBytes) {
    throw new Error('凭证输入超过大小限制或不是有效 JSON。')
  }
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(`凭证输入无效，请检查日期、制单人、分录、两位小数正金额、辅助项目；${VOUCHER_ATTACHMENT_FORMAT_ERROR}`)
  }
  const value = parsed.data
  if (value.entries.length > limits.maxEntries) throw new Error('凭证分录超过数量限制。')
  let debit = 0n
  let credit = 0n
  for (const row of value.entries) {
    const cents = BigInt(row.amount.replace('.', ''))
    if (row.foreignCurrency !== undefined) {
      const foreign = row.foreignCurrency
      const scale = foreign.exchangeRate.split('.')[1]?.length ?? 0
      const divisor = 10n ** BigInt(scale)
      const product = BigInt(foreign.amount.replace('.', '')) * BigInt(foreign.exchangeRate.replace('.', ''))
      if ((product + divisor / 2n) / divisor !== cents) {
        throw new Error(`科目 ${row.subjectCode} 的本位币金额不等于原币金额乘汇率逐条四舍五入到分；请核对，不自动改金额。`)
      }
    }
    if (row.side === 'debit') debit += cents
    else credit += cents
  }
  if (debit !== credit) throw new Error('凭证借贷不平衡，请核对金额后再准备。')
  const total = `${debit / 100n}.${String(debit % 100n).padStart(2, '0')}`
  return { input: value, totalDebit: total, totalCredit: total }
}
