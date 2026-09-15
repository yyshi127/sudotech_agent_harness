/** Single-account journal totals reconciled against exhausted pages, not a ledger-wide report. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { resolveJournalQuery, type JournalEntryId, type JournalQuery, type JournalResult, type JournalRow } from './journals.ts'

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const range = z.strictObject({ month: period, dateStart: z.iso.date().optional(), dateEnd: z.iso.date().optional() })
/** The Host resolves dates and reads one explicit account; callers cannot supply records or currencies. */
export const journalAnalysisSchema = z.strictObject({
  cashAccountId: z.string().regex(/^[1-9]\d*$/), current: range, baseline: range.optional(),
})
/** Current and optional baseline each lie inside one accounting month. */
export type JournalAnalysisQuery = z.infer<typeof journalAnalysisSchema>
/** One exhausted query, with original nullable rows retained and provided-value sums matching vendor totals. */
export interface JournalAggregate {
  month: string
  dateStart: string
  dateEnd: string
  pagesRead: number
  rows: JournalRow[]
  currencyCode: string | null
  income: string
  expense: string
  incomeMissingValueCount: number
  expenseMissingValueCount: number
}
/** No balance arithmetic, inferred currency or atomic snapshot guarantee. */
export interface JournalAnalysisResult {
  accountId: string
  accountName: string
  selection: JournalAnalysisQuery
  current: JournalAggregate
  baseline?: JournalAggregate
  differences?: { currencyCode: string | null; income: string; expense: string }
  verificationOwner: 'xiaojing'
  coverage: 'empty-page-and-totals-reconciled'
  notice: string
}
/** Fixed local diagnostic; never forwards a vendor's error body. */
export class JournalAnalysisError extends Error {
  constructor(reason: string) { super(`日记账汇总未通过核验：${reason}；可查询原始分页，不返回不完整合计。`) }
}
function cents(value: string): bigint { return BigInt(value.replace('.', '')) }
function money(value: bigint): string {
  const absolute = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

/**
 * Collect through an empty page and reconcile provided income/expense values with explicit vendor totals.
 * @param input - One verified account and one or two month-bounded ranges.
 * @param read - Host-authorized projected page reader.
 * @param signal - Whole-operation cancellation and deadline.
 * @param limits - Deployment row, accumulated-byte and page-size limits.
 * @returns Source rows, reconciled totals and same-currency differences; rejects unknown or inconsistent sources.
 */
export async function analyzeJournals(input: JournalAnalysisQuery,
  read: (query: JournalQuery) => Promise<JournalResult>, signal: AbortSignal,
  limits: { maxRows: number; maxBytes: number; pageSize: number }): Promise<JournalAnalysisResult> {
  const parsed = journalAnalysisSchema.parse(input)
  const resolve = (value: z.infer<typeof range>) => {
    const { month, dateStart, dateEnd } = resolveJournalQuery({
      ...value, cashAccountId: parsed.cashAccountId, page: 1, pageSize: limits.pageSize,
    })
    return { month, dateStart, dateEnd }
  }
  const selection = { cashAccountId: parsed.cashAccountId, current: resolve(parsed.current),
    ...parsed.baseline === undefined ? {} : { baseline: resolve(parsed.baseline) } }
  let identity: { id: string; name: string } | undefined
  let bytes = 0
  const collect = async (dates: ReturnType<typeof resolve>): Promise<JournalAggregate> => {
    const rows: JournalRow[] = []
    const ids = new Set<JournalEntryId>()
    let currency: string | null = null
    let total: { income: string; expense: string; currencyCode: string } | undefined
    let page = 1
    for (;;) {
      signal.throwIfAborted()
      const query = { ...dates, cashAccountId: selection.cashAccountId, page, pageSize: limits.pageSize }
      const result = await read(query)
      signal.throwIfAborted()
      if (Object.entries(query).some(([key, value]) => result.selection[key as keyof JournalQuery] !== value)) {
        throw new JournalAnalysisError('来源查询条件不一致')
      }
      identity ??= { id: result.accountId, name: result.accountName }
      if (identity.id !== result.accountId || identity.name !== result.accountName) throw new JournalAnalysisError('账套身份变化')
      bytes += Buffer.byteLength(JSON.stringify(result), 'utf8')
      if (bytes > limits.maxBytes || rows.length + result.rows.length > limits.maxRows) throw new JournalAnalysisError('完整读取超过上限，请缩小日期范围')
      const totals = result.summaries.filter(row => row.kind === 'total')
      if (totals.length > 1) throw new JournalAnalysisError('存在多条无法区分的接口合计')
      const next = totals[0]
      if (next !== undefined) {
        if (next.income === null || next.expense === null) throw new JournalAnalysisError('接口合计缺少收支金额')
        if (total && (total.income !== next.income || total.expense !== next.expense || total.currencyCode !== next.currencyCode)) throw new JournalAnalysisError('分页间接口合计变化')
        total = { income: next.income, expense: next.expense, currencyCode: next.currencyCode }
      }
      for (const row of result.rows) {
        if (ids.has(row.id)) throw new JournalAnalysisError('分页出现重复流水')
        if (!row.currencyCode.trim() || currency !== null && row.currencyCode !== currency) throw new JournalAnalysisError('业务行缺少币种或存在不同币种')
        currency = row.currencyCode
        ids.add(row.id)
        rows.push(row)
      }
      if (result.rows.length === 0) {
        if (!next || !total) throw new JournalAnalysisError('空末页未返回可核对的接口合计')
        break
      }
      page += 1
    }
    assert(total)
    if (total.currencyCode && currency && total.currencyCode !== currency) throw new JournalAnalysisError('业务币种与接口合计币种不一致')
    for (const key of ['income', 'expense'] as const) {
      const providedSum = rows.reduce((sum, row) => row[key] === null ? sum : sum + cents(row[key]), 0n)
      if (providedSum !== cents(total[key])) throw new JournalAnalysisError('已提供业务金额与接口合计不一致')
    }
    return { ...dates, pagesRead: page, rows, currencyCode: currency, income: total.income, expense: total.expense,
      incomeMissingValueCount: rows.filter(row => row.income === null).length,
      expenseMissingValueCount: rows.filter(row => row.expense === null).length }
  }
  const current = await collect(selection.current)
  const baseline = selection.baseline === undefined ? undefined : await collect(selection.baseline)
  if (baseline?.currencyCode && current.currencyCode && baseline.currencyCode !== current.currencyCode) {
    throw new JournalAnalysisError('两个期间的业务币种不一致')
  }
  assert(identity)
  const result: JournalAnalysisResult = { accountId: identity.id, accountName: identity.name, selection, current,
    ...baseline === undefined ? {} : { baseline, differences: { currencyCode: current.currencyCode ?? baseline.currencyCode,
      income: money(cents(current.income) - cents(baseline.income)), expense: money(cents(current.expense) - cents(baseline.expense)) } },
    verificationOwner: 'xiaojing', coverage: 'empty-page-and-totals-reconciled',
    notice: '仅为指定出纳账户和日期的收支核对。verificationOwner=xiaojing：coverage 是小兢会计的本地核验标签，不是有成接口声明的完整性或原子快照保证。小兢会计逐页读取到空业务页，排除重复 ID，按业务行实际返回的同一原币核对已提供金额与接口收支合计。incomeMissingValueCount/expenseMissingValueCount 分别统计已返回流水中收入/支出金额未提供的单元格数，不是缺少流水记录，也不是漏查笔数；这些流水仍在 rows 中。空值仍为未提供，合计相符不证明每个空值为零；没有总数或原子快照保证，不称全账套完整数据。币种来自业务行，不补写汇总行币种；两组均为空时币种未知。差额为当前减基准的核对后收支金额，不计算期初期末余额，不与总账直接对账，不推断划转、审核或过账。' }
  signal.throwIfAborted()
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > limits.maxBytes) throw new JournalAnalysisError('结果超过完整输出上限')
  return result
}
