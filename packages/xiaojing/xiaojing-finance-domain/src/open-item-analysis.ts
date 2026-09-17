/** Exact original-currency aggregation over count-reconciled open-item pages. */
import { z } from 'zod'
import assert from 'node:assert/strict'
import type { OpenItemId, OpenItemQuery, OpenItemResult, OpenItemRow } from './open-items.ts'

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const range = z.strictObject({ periodStart: period, periodEnd: period })
  .refine(value => value.periodStart <= value.periodEnd, '结束期间不得早于开始期间。')
/** Analytics accepts query criteria, never model-supplied accounting rows or currency overrides. */
export const openItemAnalysisSchema = z.strictObject({
  direction: z.enum(['receivable', 'payable']),
  groupBy: z.enum(['currency', 'subject', 'auxiliary']),
  current: range,
  baseline: range.optional(),
})
/** Optional baseline compares two queried record sets, not historical closing balances. */
export type OpenItemAnalysisQuery = z.infer<typeof openItemAnalysisSchema>
/** Local grouping prerequisite failure with fixed text, never vendor-provided diagnostics. */
export class OpenItemGroupingError extends Error {
  constructor() {
    super('往来记录缺少所选维度的分组标识，不能按名称推断；可改为按币种汇总。')
  }
}
/** Same-currency group with exact amounts and traceable record IDs. */
export interface OpenItemGroup {
  currencyCode: string
  dimensionId: string
  dimensionName: string
  recordIds: OpenItemId[]
  amount: string
  balance: string
}
/** Collected rows match each page's declared count; no atomic vendor snapshot is promised. */
export interface OpenItemAggregate {
  periodStart: string
  periodEnd: string
  recordCount: number
  pagesRead: number
  groups: OpenItemGroup[]
}
/** Current minus baseline within a single currency and grouping key. */
export interface OpenItemDifference {
  currencyCode: string
  dimensionId: string
  presence: 'both' | 'current-only' | 'baseline-only'
  amount: string
  balance: string
}
/** Deterministic local report, not an official financial statement or payment result. */
export interface OpenItemAnalysisResult {
  accountId: string
  accountName: string
  selection: OpenItemAnalysisQuery
  current: OpenItemAggregate
  baseline?: OpenItemAggregate
  differences?: OpenItemDifference[]
  coverage: 'vendor-count-reconciled'
  notice: string
}

function cents(value: string | null): bigint {
  if (value === null) throw new Error('汇总金额缺失，不能当作零。')
  return BigInt(value.replace('.', ''))
}
function money(value: bigint): string {
  const absolute = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}
function groupKey(row: Pick<OpenItemGroup, 'currencyCode' | 'dimensionId'>): string {
  return JSON.stringify([row.currencyCode, row.dimensionId])
}
function aggregate(rows: OpenItemRow[], groupBy: OpenItemAnalysisQuery['groupBy']): OpenItemGroup[] {
  const groups = new Map<string, OpenItemGroup>()
  for (const row of rows) {
    const dimensionId = groupBy === 'subject' ? row.subjectCode : groupBy === 'auxiliary' ? row.auxiliaryItemIds : ''
    if (groupBy !== 'currency' && dimensionId.trim() === '') {
      throw new OpenItemGroupingError()
    }
    const dimensionName = groupBy === 'subject' ? row.subjectName : groupBy === 'auxiliary' ? row.auxiliaryItemName : ''
    const key = groupKey({ currencyCode: row.currencyCode, dimensionId })
    const existing = groups.get(key)
    if (existing && existing.dimensionName !== dimensionName) throw new Error('同一分组标识返回不同名称，请核对基础资料。')
    const target = existing ?? { currencyCode: row.currencyCode, dimensionId, dimensionName, recordIds: [], amount: '0.00', balance: '0.00' }
    target.amount = money(cents(target.amount) + cents(row.amount))
    target.balance = money(cents(target.balance) + cents(row.balance))
    target.recordIds.push(row.id)
    groups.set(key, target)
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value)
}

/**
 * Read all pages declared by the vendor, then aggregate or compare without cross-currency arithmetic.
 * @param input - Validated periods, direction and grouping.
 * @param read - Host-authorized page reader; no caller-provided accounting rows.
 * @param signal - Whole-operation cancellation/deadline.
 * @param limits - Deployment row, accumulated response byte and page-size limits.
 * @returns Exact grouped sums and optional differences; rejects incomplete or inconsistent pagination.
 */
export async function analyzeOpenItems(input: OpenItemAnalysisQuery,
  read: (query: OpenItemQuery) => Promise<OpenItemResult>, signal: AbortSignal,
  limits: { maxRows: number; maxBytes: number; pageSize: number }): Promise<OpenItemAnalysisResult> {
  const selection = openItemAnalysisSchema.parse(input)
  let identity: { id: string; name: string } | undefined
  let bytes = 0
  const collect = async (periods: z.infer<typeof range>): Promise<OpenItemAggregate> => {
    const rows: OpenItemRow[] = []
    const ids = new Set<OpenItemId>()
    let total: number | undefined
    let page = 1
    do {
      signal.throwIfAborted()
      const query: OpenItemQuery = { ...periods, direction: selection.direction, page, pageSize: limits.pageSize }
      const result = await read(query)
      signal.throwIfAborted()
      if (result.selection.direction !== query.direction || result.selection.periodStart !== query.periodStart ||
        result.selection.periodEnd !== query.periodEnd || result.selection.page !== page || result.selection.pageSize !== query.pageSize) {
        throw new Error('汇总来源与查询条件不符。')
      }
      identity ??= { id: result.accountId, name: result.accountName }
      if (result.accountId !== identity.id || result.accountName !== identity.name) throw new Error('汇总期间账套身份变化。')
      total ??= result.totalCount
      if (total !== result.totalCount || total > limits.maxRows) throw new Error('汇总记录总数变化或超过上限。')
      bytes += Buffer.byteLength(JSON.stringify(result), 'utf8')
      if (bytes > limits.maxBytes) throw new Error('汇总来源超过完整读取上限，请缩小期间。')
      const expected = Math.min(limits.pageSize, total - rows.length)
      if (result.rows.length !== expected) throw new Error('分页记录数与接口总数不一致，未返回不完整汇总。')
      for (const row of result.rows) {
        if (ids.has(row.id)) throw new Error('分页包含重复往来，未返回汇总。')
        ids.add(row.id)
        rows.push(row)
      }
      page += 1
    } while (rows.length < total)
    return { ...periods, recordCount: rows.length, pagesRead: page - 1, groups: aggregate(rows, selection.groupBy) }
  }
  const current = await collect(selection.current)
  const baseline = selection.baseline === undefined ? undefined : await collect(selection.baseline)
  const differences: OpenItemDifference[] = []
  if (baseline) {
    const before = new Map(baseline.groups.map(row => [groupKey(row), row]))
    const after = new Map(current.groups.map(row => [groupKey(row), row]))
    const labels = new Map([...before, ...after])
    for (const [key, label] of [...labels].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const previous = before.get(key)
      const next = after.get(key)
      differences.push({ currencyCode: label.currencyCode, dimensionId: label.dimensionId,
        presence: previous === undefined ? 'current-only' : next === undefined ? 'baseline-only' : 'both',
        amount: money(cents(next?.amount ?? '0.00') - cents(previous?.amount ?? '0.00')),
        balance: money(cents(next?.balance ?? '0.00') - cents(previous?.balance ?? '0.00')) })
    }
  }
  assert(identity, 'Collection must read its first page before publishing a report')
  const result: OpenItemAnalysisResult = { accountId: identity.id, accountName: identity.name,
    selection, current, ...baseline === undefined ? {} : { baseline, differences }, coverage: 'vendor-count-reconciled',
    notice: '小兢会计根据有成接口返回的业务行在本地计算分组与差额，不是有成接口直接返回的汇总报表。已逐页核对接口声明的记录数并排除重复 ID，只计业务行，不计汇总行。金额和余额按原币分组，差额为当前查询组减基准查询组；完整读取的某组缺席按零组总额参与比较。辅助项目按完整 ID 组合分组，不推断客户身份。余额为接口返回的往来余额，不是历史期末余额；两组期间比较不是正式财务报表或资金流分析。接口没有原子快照保证，同笔数据期间内变动可能无法识别。不执行写入或核销。' }
  signal.throwIfAborted()
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > limits.maxBytes) throw new Error('汇总结果超过输出上限。')
  return result
}
