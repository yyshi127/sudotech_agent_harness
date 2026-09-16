/** Bounded journal projection; vendor balance markers are not business transactions. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
/** Journal selection excludes connection overrides and requires dates inside one accounting month. */
export const journalQuerySchema = z.strictObject({
  month: period, dateStart: z.iso.date().optional(), dateEnd: z.iso.date().optional(),
  page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), pageSize: z.number().int().min(1).max(100),
  cashAccountId: z.string().regex(/^[1-9]\d*$/).optional(),
}).refine(q => (q.dateStart === undefined) === (q.dateEnd === undefined), '起止日期须同时提供。')
  .refine(q => q.dateStart === undefined || q.dateEnd === undefined ||
    (q.dateStart <= q.dateEnd && q.dateStart.startsWith(q.month + '-') && q.dateEnd.startsWith(q.month + '-')),
  '日期必须位于所选月份，且结束不早于开始。')
/** Single-month journal selection with an explicitly bounded page. */
export type JournalQuery = z.infer<typeof journalQuerySchema>
/** Validated selection with concrete calendar dates. */
export type JournalSelection = JournalQuery & { dateStart: string; dateEnd: string }

/**
 * Resolve optional dates before requesting the vendor.
 * @param query - Caller selection.
 * @returns Explicit month-bounded dates.
 */
export function resolveJournalQuery(query: JournalQuery): JournalSelection {
  const parsed = journalQuerySchema.parse(query)
  const year = Number(parsed.month.slice(0, 4))
  const month = Number(parsed.month.slice(5))
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = month === 2 ? leap ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31
  return { ...parsed, dateStart: parsed.dateStart ?? `${parsed.month}-01`, dateEnd: parsed.dateEnd ?? `${parsed.month}-${days}` }
}

const money = z.union([z.string(), z.number()]).nullish().transform((value, context): string | null => {
  if (value === undefined || value === null || value === '') return null
  const text = String(value)
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    context.addIssue({ code: 'custom', message: 'Invalid journal amount' }); return z.NEVER
  }
  const [whole = '', fraction = ''] = text.split('.')
  const normalized = `${whole}.${fraction.padEnd(2, '0')}`
  if (typeof value === 'number' && (BigInt(normalized.replace('.', '')) > BigInt(Number.MAX_SAFE_INTEGER) ||
    BigInt(normalized.replace('.', '')) < -BigInt(Number.MAX_SAFE_INTEGER))) {
    context.addIssue({ code: 'custom', message: 'Unsafe numeric journal amount' }); return z.NEVER
  }
  return normalized
})
const identifier = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)])
const rowSchema = z.object({
  id: identifier.optional(), date: z.string(), abstractStr: z.string(),
  subjectId: identifier.optional(), subjectName: z.string().optional(), subjectCode: z.string().optional(),
  accountCode: z.string(), accountName: z.string(), currencyCode: z.string(), baseCurrencyCode: z.string(),
  borrow: money, loan: money, balance: money, baseBorrow: money, baseLoan: money, baseBalance: money,
  categoryName: z.string(), keeperName: z.string(),
})
/** Opaque vendor journal identifier. */
export type JournalEntryId = Branded<'FinanceJournalEntryId'>
/** A dated business transaction, never an opening balance or total marker. */
export interface JournalRow {
  id: JournalEntryId
  date: string
  summary: string
  accountCode: string
  accountName: string
  currencyCode: string
  baseCurrencyCode: string
  income: string | null
  expense: string | null
  balance: string | null
  baseIncome: string | null
  baseExpense: string | null
  baseBalance: string | null
  categoryName: string
  keeperName: string
}
/** Vendor balance marker with no transaction ID or date. */
export type JournalSummary = Omit<JournalRow, 'id' | 'date'> & { kind: 'opening' | 'total' }
/** One bounded page; no count or verified final-page indicator is available. */
export interface JournalResult {
  accountId: string
  accountName: string
  selection: JournalSelection
  rows: JournalRow[]
  summaries: JournalSummary[]
  /** Number of pages read through the first empty page; absent for an ordinary page query. */
  pagesRead?: number
  coverage: 'unverified'
  notice: string
}

/**
 * Collect one journal selection through its first empty page without inventing a vendor total.
 * @param query - Journal filters; its page values are ignored.
 * @param read - Authenticated reader for one validated vendor page.
 * @param signal - Cancellation checked around every page read.
 * @param limits - Export page size and aggregate row and byte caps.
 * @returns Unique business rows and the terminal page summaries with unverified coverage.
 */
export async function collectJournalPages(query: JournalQuery,
  read: (query: JournalQuery) => Promise<JournalResult>, signal: AbortSignal,
  limits: { pageSize: number; maxRows: number; maxBytes: number }): Promise<JournalResult> {
  const base = resolveJournalQuery({ ...query, page: 1, pageSize: limits.pageSize })
  const rows: JournalRow[] = []
  const ids = new Set<JournalEntryId>()
  let identity: { id: string; name: string } | undefined
  let summaries: JournalSummary[] = []
  let bytes = 0
  let page = 1
  for (;;) {
    signal.throwIfAborted()
    const selected: JournalQuery = { ...base, page, pageSize: limits.pageSize }
    const result = await read(selected)
    signal.throwIfAborted()
    if (Object.entries(selected).some(([key, value]) => result.selection[key as keyof JournalQuery] !== value)) {
      throw new Error('日记账导出来源与查询条件不一致。')
    }
    identity ??= { id: result.accountId, name: result.accountName }
    if (identity.id !== result.accountId || identity.name !== result.accountName) throw new Error('日记账导出期间账套身份变化。')
    bytes += Buffer.byteLength(JSON.stringify(result), 'utf8')
    if (bytes > limits.maxBytes || rows.length + result.rows.length > limits.maxRows) {
      throw new Error('日记账完整导出超过上限，请缩小日期范围后重试。')
    }
    for (const item of result.rows) {
      if (ids.has(item.id)) throw new Error('日记账导出分页包含重复流水。')
      ids.add(item.id)
      rows.push(item)
    }
    summaries = result.summaries
    if (result.rows.length === 0) break
    page += 1
  }
  const result: JournalResult = {
    accountId: identity.id, accountName: identity.name, selection: { ...base, page: 1, pageSize: limits.pageSize },
    rows, summaries, pagesRead: page, coverage: 'unverified',
    notice: '已从第一页开始逐页读取到首个空业务页，文件包含本次日期和账户条件返回的全部日记账业务行。接口不返回可独立核对的总记录数，也不提供原子快照，因此不宣称全账套完整。这不是收支核对或跨期比较结果，不能直接相减原始页或接口合计来替代核对。汇总标记与业务流水分表保存，金额空值不当作零；币种字段为空表示币种未提供。按接口原名报告余额，不证明日初日末余额已核验。',
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > limits.maxBytes) {
    throw new Error('日记账完整导出超过上限，请缩小日期范围后重试。')
  }
  return result
}

/**
 * Separate validated journal transactions from vendor balance markers.
 * @param data - Untrusted vendor array.
 * @param query - Requested period and page.
 * @param account - Authorized saved ledger.
 * @param maxRows - Whole-array limit, including summary rows.
 * @param maxBytes - Complete result limit.
 * @returns A bounded page without inferred zeros or completeness.
 */
export function projectJournals(
  data: unknown, query: JournalQuery, account: { id: string; name: string }, maxRows: number, maxBytes: number,
): JournalResult {
  const selection = resolveJournalQuery(query)
  const list = z.array(rowSchema).parse(data)
  if (list.length > maxRows) throw new Error('日记账结果超过行数限制。')
  const rows: JournalRow[] = []
  const summaries: JournalSummary[] = []
  for (const row of list) {
    const fields = {
      summary: row.abstractStr, accountCode: row.accountCode || row.subjectCode || '', accountName: row.accountName || row.subjectName || '',
      currencyCode: row.currencyCode, baseCurrencyCode: row.baseCurrencyCode,
      income: row.borrow, expense: row.loan, balance: row.balance,
      baseIncome: row.baseBorrow, baseExpense: row.baseLoan, baseBalance: row.baseBalance,
      categoryName: row.categoryName, keeperName: row.keeperName,
    }
    if (row.id !== undefined) {
      if (selection.cashAccountId !== undefined && String(row.subjectId) !== selection.cashAccountId) {
        throw new Error('日记账业务行账户与所选账户不符或缺少账户标识。')
      }
      if (!z.iso.date().safeParse(row.date).success || row.date < selection.dateStart || row.date > selection.dateEnd) {
        throw new Error('日记账业务日期与查询范围不符。')
      }
      if (row.borrow === null && row.loan === null) throw new Error('日记账业务行缺少收支金额。')
      rows.push({ ...fields, id: String(row.id) as JournalEntryId, date: row.date })
    } else if (row.date === '' && (row.abstractStr === '初始余额' || row.abstractStr === '合计')) {
      summaries.push({ ...fields, kind: row.abstractStr === '初始余额' ? 'opening' : 'total' })
    } else throw new Error('无法识别日记账业务行或汇总行。')
  }
  if (rows.length > selection.pageSize || new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('日记账分页结果超限或包含重复流水。')
  }
  const result: JournalResult = {
    accountId: account.id, accountName: account.name, selection, rows, summaries, coverage: 'unverified',
    notice: '本结果是原始查询页，不是收支核对或跨期比较结果。用户要求汇总或比较时，先查 finance_references 的 cash-accounts 确定账户，再用 finance_journals 的 analyze:true、cashAccountId、month 和可选 baselineMonth 取得核对结果；不能直接相减原始页或接口合计来替代核对。未限定账户的汇总不能命名为某个账户的合计。'
      + '仅为指定日期和页码返回的日记账，完整性未验证。rows 为空只能说“本次查询页未返回业务流水”，不能说当天没有收支或本月只有这些流水；免责声明不能抵消正文中的全量断言。初始余额与合计不是业务流水，不重复加总；按接口原名报告余额，相邻日期金额相同仅为对照一致，不证明日初日末余额已核验。income 为收入，expense 为支出；null 表示未提供，不当作零。币种字段为空须写“币种未提供”，不能根据账户名称、币种 ID 或上下文补人民币、RMB、CNY、元或¥，不跨币种合计。未执行任何业务写操作。',
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('日记账结果过大，无法完整返回。')
  return result
}
