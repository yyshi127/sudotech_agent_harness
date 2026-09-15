/** Exact same-ledger comparisons; returned-row sums never assert ledger-wide completeness. */
import { z } from 'zod'
import type { BalanceQuery, BalanceResult, BalanceRow } from './balances.ts'

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
/** Analysis reads one explicit level in base currency; no caller-authored source rows. */
export const balanceAnalysisSchema = z.strictObject({
  month: period, compareMonth: period.optional(), subjectLevel: z.number().int().positive().max(2147483647),
})
/** Each month is queried independently at the same subject level. */
export type BalanceAnalysisQuery = z.infer<typeof balanceAnalysisSchema>
/** Debit and credit columns can be summed independently; unsigned balance columns are excluded. */
export const balanceAnalysisFields = [
  'periodInitialBorrow', 'periodInitialLoan', 'periodThisBorrow', 'periodThisLoan',
  'periodYearBorrow', 'periodYearLoan', 'periodFinalBorrow', 'periodFinalLoan',
] as const
type Field = typeof balanceAnalysisFields[number]
type Amounts = Record<Field, string | null>
type Reconciliation = Record<Field, {
  providedSum: string | null
  missingCells: number
  vendorTotal: string | null
  status: 'matched' | 'mismatch' | 'total-unavailable' | 'unsupported-level'
}>
type ReconciliationCounts = Record<Reconciliation[Field]['status'], number>
/** Sources, exact differences and explicitly incomplete returned-row sums. */
export interface BalanceAnalysisResult {
  accountId: string
  accountName: string
  selection: BalanceAnalysisQuery
  currencyBasis: 'ledger-base'
  coverage: 'unverified'
  current: BalanceResult
  baseline?: BalanceResult
  returnedRowSums: { current: Amounts; baseline?: Amounts }
  reconciliation: { current: Reconciliation; baseline?: Reconciliation }
  reconciliationCounts: { current: ReconciliationCounts; baseline?: ReconciliationCounts }
  reconciliationNotice: string
  differences?: {
    subjectInfoId: number
    subjectCode: string
    subjectName: string
    presence: 'both' | 'current-only' | 'baseline-only'
    amounts: Amounts
  }[]
  notice: string
}
function money(value: bigint): string {
  const absolute = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}
function amounts(calculate: (field: Field) => string | null): Amounts {
  return Object.fromEntries(balanceAnalysisFields.map(field => [field, calculate(field)])) as Amounts
}
function sum(rows: BalanceRow[]): Amounts {
  return amounts(field => rows.length === 0 || rows.some(row => row[field] === null) ? null
    : money(rows.reduce((total, row) => total + BigInt((row[field] ?? '').replace('.', '')), 0n)))
}

function reconcile(source: BalanceResult): Reconciliation {
  const totals = source.summaries.filter(row => row.subjectName === '本期合计')
  const rootLevel = source.subjectLevel === 1 && source.rows.every(row => row.subjectLevel === 1 && row.parentSubjectId === 0)
  return Object.fromEntries(balanceAnalysisFields.map((field) => {
    const values = source.rows.flatMap(row => row[field] === null ? [] : [row[field]])
    const providedSum = values.length === 0 ? null : money(values.reduce((total, value) => total + BigInt(value.replace('.', '')), 0n))
    const vendorTotal = totals.length === 1 ? totals[0]?.[field] ?? null : null
    return [field, { providedSum, missingCells: source.rows.length - values.length, vendorTotal,
      status: !rootLevel ? 'unsupported-level' : vendorTotal === null || providedSum === null ? 'total-unavailable'
        : providedSum === vendorTotal ? 'matched' : 'mismatch' }]
  })) as Reconciliation
}

/**
 * Attach root-column checks to an ordinary report without additional reads or zero filling.
 * @param source - Authorized source report; only explicit single-month level-one selections qualify.
 * @param maxBytes - Limit for the complete enriched result.
 * @returns Source report with program counts when eligible; retains unverified coverage.
 */
export function withBalanceReconciliation(source: BalanceResult, maxBytes: number): BalanceResult {
  if (source.subjectLevel !== 1 || (source.subjectLevelEnd !== undefined && source.subjectLevelEnd !== 1)
    || source.month !== source.monthEnd) return source
  const columns = reconcile(source)
  const counts: ReconciliationCounts = { matched: 0, mismatch: 0, 'total-unavailable': 0, 'unsupported-level': 0 }
  for (const column of Object.values(columns)) counts[column.status]++
  const result: BalanceResult = { ...source, reconciliation: { columns, counts, verificationOwner: 'xiaojing',
    notice: '有成提供原始金额，小兢会计本地计算核对状态和计数，不是有成官方核验结论。本次核对仅包含八个借贷列，不含四个 Balance 来源字段。总结直接使用 counts，纠正冲突的历史计数；一致不证明空值为零或科目完整。不得把未参与核对的来源字段加入无法核对列数。' } }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('余额核对结果超过完整输出上限。')
  return result
}

/** Program reconciliation attached to an eligible source query. */
export interface BalanceQueryReconciliation {
  verificationOwner: 'xiaojing'
  columns: Reconciliation
  counts: ReconciliationCounts
  notice: string
}

/**
 * Read matching single-level reports and compare stable subject IDs without filling missing rows or cells.
 * @param input - Current month, optional baseline and explicit subject level.
 * @param read - Host-authorized base-currency report reader.
 * @param signal - Cancellation for the entire comparison.
 * @param limits - Combined source-row and emitted-byte limits.
 * @returns Sources and exact same-field arithmetic; returned-row sums are not complete-ledger totals.
 */
export async function analyzeBalances(input: BalanceAnalysisQuery,
  read: (query: BalanceQuery) => Promise<BalanceResult>, signal: AbortSignal,
  limits: { maxRows: number; maxBytes: number }): Promise<BalanceAnalysisResult> {
  const selection = balanceAnalysisSchema.parse(input)
  const collect = async (month: string) => {
    signal.throwIfAborted()
    const source = await read({ month, subjectLevel: selection.subjectLevel, subjectLevelEnd: selection.subjectLevel })
    signal.throwIfAborted()
    if (source.month !== month || source.monthEnd !== month || source.subjectLevel !== selection.subjectLevel
      || source.subjectLevelEnd !== selection.subjectLevel) throw new Error('余额分析来源查询条件不一致。')
    return source
  }
  const current = await collect(selection.month)
  const baseline = selection.compareMonth === undefined ? undefined : await collect(selection.compareMonth)
  if (baseline && (current.accountId !== baseline.accountId || current.accountName !== baseline.accountName)) {
    throw new Error('余额比较期间账套身份变化。')
  }
  if (current.rows.length + current.summaries.length + (baseline?.rows.length ?? 0) + (baseline?.summaries.length ?? 0)
    > limits.maxRows) throw new Error('余额分析超过总行数限制。')
  const index = (source: BalanceResult) => new Map(source.rows.map((row) => {
    if (row.subjectInfoId === undefined) throw new Error('余额分析缺少科目标识。')
    return [row.subjectInfoId, row] as const
  }))
  const now = index(current)
  const before = baseline === undefined ? undefined : index(baseline)
  const differences = before === undefined ? undefined : [...new Set([...now.keys(), ...before.keys()])].map((id) => {
    const left = now.get(id)
    const right = before.get(id)
    const source = left ?? right
    if (source === undefined) throw new Error('余额比较缺少来源。')
    if (left && right && (left.subjectCode !== right.subjectCode || left.subjectName !== right.subjectName
      || left.parentSubjectId !== right.parentSubjectId)) throw new Error('余额比较期间科目资料变化，请先核对科目。')
    return { subjectInfoId: id, subjectCode: source.subjectCode, subjectName: source.subjectName,
      presence: left === undefined ? 'baseline-only' as const : right === undefined ? 'current-only' as const : 'both' as const,
      amounts: amounts((field) => {
        const a = left?.[field]
        const b = right?.[field]
        return a == null || b == null ? null : money(BigInt(a.replace('.', '')) - BigInt(b.replace('.', '')))
      }) }
  })
  const currentReconciliation = reconcile(current)
  const baselineReconciliation = baseline === undefined ? undefined : reconcile(baseline)
  const count = (checks: Reconciliation): ReconciliationCounts => {
    const counts: ReconciliationCounts = { matched: 0, mismatch: 0, 'total-unavailable': 0, 'unsupported-level': 0 }
    for (const check of Object.values(checks)) counts[check.status]++
    return counts
  }
  const result: BalanceAnalysisResult = {
    accountId: current.accountId, accountName: current.accountName, selection, currencyBasis: 'ledger-base', coverage: 'unverified',
    current, ...baseline === undefined ? {} : { baseline },
    returnedRowSums: { current: sum(current.rows), ...baseline === undefined ? {} : { baseline: sum(baseline.rows) } },
    reconciliation: { current: currentReconciliation, ...baselineReconciliation === undefined ? {} : { baseline: baselineReconciliation } },
    reconciliationCounts: { current: count(currentReconciliation),
      ...baselineReconciliation === undefined ? {} : { baseline: count(baselineReconciliation) } },
    reconciliationNotice: '小兢会计仅核对一级科目已提供金额之和与唯一的本期合计。matched 表示该列金额一致，不证明空值为零、科目无遗漏或全账套完整；其他状态不视为通过。保留空值数，不合计父子级或小计行。总结列数直接使用本次 reconciliationCounts，每个期间共八个借贷列，四个 Balance 来源字段不参与核对。不要沿用历史回答中的计数；若历史回答与本次计数冲突，明确纠正。正文、括号说明及结论都必须与本次计数一致，不再重新数列。',
    ...differences === undefined ? {} : { differences },
    notice: '小兢会计按同一账套本位币、同一单层级计算。差额方向为当前月减基准月，逐列比较，不表示现金收支或正常异常；本年累计列仍为各月接口的年累计值。仅一边出现的科目或缺失金额均不可计算，不补零。returnedRowSums 仅为返回科目行的同列加总，任一金额未提供则该列合计未知；不包含接口汇总，不跨父子层级重复累计。全范围完整性尚未核验，不是全账套合计或试算平衡结论。两次读取不保证原子快照。',
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > limits.maxBytes) throw new Error('余额分析结果超过完整输出上限。')
  return result
}
