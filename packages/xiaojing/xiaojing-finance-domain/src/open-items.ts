/** Receivable/payable projection separates vendor totals from dated business records. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
/** Read-only selection; ledger and credentials come from the bound Finance session. */
export const openItemQuerySchema = z.strictObject({
  direction: z.enum(['receivable', 'payable']),
  periodStart: period, periodEnd: period,
  page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  pageSize: z.number().int().min(1).max(100),
}).refine(q => q.periodStart <= q.periodEnd, '结束期间不得早于开始期间。')
/** Explicit direction, accounting-period range, and bounded page. */
export type OpenItemQuery = z.infer<typeof openItemQuerySchema>

const money = z.union([z.string(), z.number()]).nullish().transform((value, context): string | null => {
  if (value === undefined || value === null || value === '') return null
  const text = String(value)
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    context.addIssue({ code: 'custom', message: 'Invalid open-item amount' }); return z.NEVER
  }
  const [whole = '', fraction = ''] = text.split('.')
  const normalized = `${whole}.${fraction.padEnd(2, '0')}`
  const cents = BigInt(normalized.replace('.', ''))
  if (typeof value === 'number' && (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER))) {
    context.addIssue({ code: 'custom', message: 'Unsafe numeric open-item amount' }); return z.NEVER
  }
  return normalized
})
const identifier = z.union([z.string().regex(/^-?[1-9]\d*$/), z.number().int().refine(Number.isSafeInteger)])
const rowSchema = z.object({
  id: identifier, date: z.string(), abstractStr: z.string(),
  setOfBooksId: identifier.optional(),
  subjectCode: z.string(), subjectName: z.string(),
  auxiliaryItemIds: z.string(), auxiliaryItemName: z.string(),
  currencyCode: z.string(), baseCurrencyCode: z.string(),
  money, balance: money, baseMoney: money, baseBalance: money,
  thisMoney: money, badMoney: money, hedgeMoney: money, returnMoney: money,
  initialBalance: z.boolean().optional(), isFinish: z.boolean().optional(),
  categoryName: z.string(), remark: z.string(),
})
/** Vendor identifier for a real receivable or payable, never a generated total ID. */
export type OpenItemId = Branded<'FinanceOpenItemId'>
/** Amounts retain currency and vendor signs; null means not provided. */
export interface OpenItemAmounts {
  amount: string | null
  balance: string | null
  baseAmount: string | null
  baseBalance: string | null
  settledAmount: string | null
  badDebtAmount: string | null
  offsetAmount: string | null
  returnAmount: string | null
}
/** Dated vendor record; settlement does not prove an actual bank payment. */
export interface OpenItemRow extends OpenItemAmounts {
  id: OpenItemId
  date: string
  summary: string
  subjectCode: string
  subjectName: string
  auxiliaryItemIds: string
  auxiliaryItemName: string
  currencyCode: string
  baseCurrencyCode: string
  initialBalance: boolean | null
  finished: boolean | null
  categoryName: string
  remark: string
}
/** Vendor aggregate, excluded from business counts and local aggregation. */
export interface OpenItemSummary extends OpenItemAmounts {
  kind: 'total' | 'previous-page'
  currencyCode: string
  baseCurrencyCode: string
}
/** One requested page with vendor count, not independently verified completeness. */
export interface OpenItemResult {
  accountId: string
  accountName: string
  selection: OpenItemQuery
  totalCount: number
  rows: OpenItemRow[]
  summaries: OpenItemSummary[]
  /** Number of count-reconciled pages read for an export; absent for an ordinary page query. */
  pagesRead?: number
  coverage: 'unverified' | 'vendor-count-reconciled'
  notice: string
}

/**
 * Collect every page declared by the vendor for one receivable or payable selection.
 * @param query - Direction and period filters; its page values are ignored.
 * @param read - Authenticated reader for one validated vendor page.
 * @param signal - Cancellation checked around every page read.
 * @param limits - Export page size and aggregate row and byte caps.
 * @returns Every unique business row after its count matches the stable vendor total.
 */
export async function collectOpenItemPages(query: OpenItemQuery,
  read: (query: OpenItemQuery) => Promise<OpenItemResult>, signal: AbortSignal,
  limits: { pageSize: number; maxRows: number; maxBytes: number }): Promise<OpenItemResult> {
  const base = openItemQuerySchema.parse({ ...query, page: 1, pageSize: limits.pageSize })
  const rows: OpenItemRow[] = []
  const ids = new Set<OpenItemId>()
  let identity: { id: string; name: string } | undefined
  let total: number | undefined
  let summaries: OpenItemSummary[] = []
  let bytes = 0
  let page = 1
  do {
    signal.throwIfAborted()
    const selected: OpenItemQuery = { ...base, page }
    const result = await read(selected)
    signal.throwIfAborted()
    if (Object.entries(selected).some(([key, value]) => result.selection[key as keyof OpenItemQuery] !== value)) {
      throw new Error('应收应付导出来源与查询条件不一致。')
    }
    identity ??= { id: result.accountId, name: result.accountName }
    if (identity.id !== result.accountId || identity.name !== result.accountName) throw new Error('应收应付导出期间账套身份变化。')
    total ??= result.totalCount
    if (total !== result.totalCount || total > limits.maxRows) throw new Error('应收应付导出总数变化或超过上限，请缩小期间后重试。')
    bytes += Buffer.byteLength(JSON.stringify(result), 'utf8')
    if (bytes > limits.maxBytes) throw new Error('应收应付完整导出超过上限，请缩小期间后重试。')
    const expected = Math.min(limits.pageSize, total - rows.length)
    if (result.rows.length !== expected) throw new Error('应收应付导出分页记录数与接口总数不一致。')
    for (const item of result.rows) {
      if (ids.has(item.id)) throw new Error('应收应付导出分页包含重复记录。')
      ids.add(item.id)
      rows.push(item)
    }
    const totals = result.summaries.filter(item => item.kind === 'total')
    if (totals.length > 0) summaries = totals
    page += 1
  } while (rows.length < total)
  if (rows.length !== total) {
    throw new Error('应收应付导出记录数与接口总数不一致，未生成不完整文件。')
  }
  const result: OpenItemResult = {
    accountId: identity.id, accountName: identity.name, selection: { ...base, page: 1 }, totalCount: total,
    rows, summaries, pagesRead: page - 1, coverage: 'vendor-count-reconciled',
    notice: '已从第一页开始逐页读取，并核对业务记录数与接口声明总数；文件包含本次方向和期间条件返回的全部应收或应付记录。接口不提供原子快照，导出期间发生的数据变化仍可能导致失败或无法识别。结清及已收已付金额不证明真实银行收付款。',
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > limits.maxBytes) {
    throw new Error('应收应付完整导出超过上限，请缩小期间后重试。')
  }
  return result
}

/**
 * Validate and project a single receivable/payable response without assuming empty amounts are zero.
 * @param data - Untrusted vendor page.
 * @param query - Explicit requested direction and periods.
 * @param account - Authorized ledger identity.
 * @param maxRows - Whole-page cap including total and previous-page records.
 * @param maxBytes - Complete serialized result cap.
 * @returns Business records and separately identified summaries, or throws on inconsistent data.
 */
export function projectOpenItems(data: unknown, query: OpenItemQuery,
  account: { id: string; name: string }, maxRows: number, maxBytes: number): OpenItemResult {
  const selection = openItemQuerySchema.parse(query)
  const parsed = z.object({ count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    list: z.array(rowSchema), pageUpRecord: rowSchema.nullish() }).parse(data)
  if (parsed.list.length + (parsed.pageUpRecord ? 1 : 0) > maxRows) throw new Error('应收应付结果超过行数限制。')
  const rows: OpenItemRow[] = []
  const summaries: OpenItemSummary[] = []
  const append = (row: z.infer<typeof rowSchema>, previous: boolean): void => {
    const amounts: OpenItemAmounts = { amount: row.money, balance: row.balance,
      baseAmount: row.baseMoney, baseBalance: row.baseBalance, settledAmount: row.thisMoney,
      badDebtAmount: row.badMoney, offsetAmount: row.hedgeMoney, returnAmount: row.returnMoney }
    if (BigInt(row.id) < 0n && row.date === '' && row.subjectCode === '' && row.subjectName === '' &&
      row.auxiliaryItemIds === '' && row.auxiliaryItemName === '' &&
      row.abstractStr === (previous ? '上一页的总计' : '合计')) {
      summaries.push({ ...amounts, kind: previous ? 'previous-page' : 'total',
        currencyCode: row.currencyCode, baseCurrencyCode: row.baseCurrencyCode })
      return
    }
    if (previous || BigInt(row.id) <= 0n || !z.iso.date().safeParse(row.date).success) {
      throw new Error('无法识别应收应付业务行或汇总行。')
    }
    if (row.setOfBooksId === undefined || String(row.setOfBooksId) !== account.id) throw new Error('应收应付记录账套不符。')
    if (row.money === null || row.balance === null || row.currencyCode === '') throw new Error('应收应付记录缺少金额或币种。')
    rows.push({ ...amounts, id: String(row.id) as OpenItemId, date: row.date, summary: row.abstractStr,
      subjectCode: row.subjectCode, subjectName: row.subjectName,
      auxiliaryItemIds: row.auxiliaryItemIds, auxiliaryItemName: row.auxiliaryItemName,
      currencyCode: row.currencyCode, baseCurrencyCode: row.baseCurrencyCode,
      initialBalance: row.initialBalance ?? null, finished: row.isFinish ?? null,
      categoryName: row.categoryName, remark: row.remark })
  }
  for (const row of parsed.list) append(row, false)
  if (parsed.pageUpRecord) append(parsed.pageUpRecord, true)
  if (rows.length > selection.pageSize || new Set(rows.map(row => row.id)).size !== rows.length ||
    BigInt(selection.page - 1) * BigInt(selection.pageSize) + BigInt(rows.length) > BigInt(parsed.count) && rows.length > 0) {
    throw new Error('应收应付分页记录重复、超限或与总数不符。')
  }
  const result: OpenItemResult = { accountId: account.id, accountName: account.name, selection,
    totalCount: parsed.count, rows, summaries, coverage: 'unverified',
    notice: '仅返回指定方向、期间和页码的应收应付；totalCount 为接口声明的记录数，完整性尚未独立核验。合计与上一页总计不是往来记录，不重复相加。null 表示未提供，不当作零；保留币种与正负号，不跨币种加总。辅助项目名称不等同于已核实的客户或供应商身份；结清及已收已付金额不证明真实银行收付款。未执行新增、删除或核销。' }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('应收应付结果过大，无法完整返回。')
  return result
}
