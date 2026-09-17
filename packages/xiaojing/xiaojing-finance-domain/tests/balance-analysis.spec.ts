import { readSheet } from 'read-excel-file/node'
import { expect, it } from 'vitest'
import { analyzeBalances, balanceAnalysisSchema, withBalanceReconciliation } from '../src/balance-analysis.ts'
import { balanceAnalysisWorkbook } from '../src/balance-analysis-workbook.ts'
import { projectBalances, type BalanceQuery } from '../src/balances.ts'

const source = { subjectInfoId: 1, parentSubjectId: 0, subjectCode: '001001', subjectName: '=SUM(1,2)',
  subjectLevel: 1, hasChild: true, periodInitialBorrow: '9007199254740993.01', periodInitialLoan: '', periodInitialBalance: '',
  periodThisBorrow: '-0.01', periodThisLoan: '0', periodThisBalance: '',
  periodYearBorrow: '-0.01', periodYearLoan: '0', periodYearBalance: '',
  periodFinalBorrow: '-0.01', periodFinalLoan: '', periodFinalBalance: '' }
const selection = { month: '2026-09', compareMonth: '2026-08', subjectLevel: 1 }
const limits = { maxRows: 100, maxBytes: 65536 }

it('enriches only explicit single-month root queries and enforces the enriched byte limit', async () => {
  const source = await read({ month: '2026-09', subjectLevel: 1 })
  const enriched = withBalanceReconciliation(source, 65536)
  expect(enriched.reconciliation?.counts['total-unavailable']).toBe(8)
  expect(enriched.reconciliation?.verificationOwner).toBe('xiaojing')
  expect(enriched.rows).toBe(source.rows)
  expect(source).not.toHaveProperty('reconciliation')
  expect(withBalanceReconciliation({ ...source, subjectLevel: 2 }, 65536)).not.toHaveProperty('reconciliation')
  expect(withBalanceReconciliation({ ...source, monthEnd: '2026-10' }, 65536)).not.toHaveProperty('reconciliation')
  expect(() => withBalanceReconciliation(source, Buffer.byteLength(JSON.stringify(source)))).toThrow('完整输出上限')
})
function read(query: BalanceQuery) {
  return Promise.resolve(projectBalances({ success: true, count: 0, list: [
    { ...source, ...query.month === '2026-08' ? { periodInitialBorrow: '9007199254740993.00', periodThisBorrow: '0.01' } : {} },
    ...query.month === '2026-09' ? [{ ...source, subjectInfoId: 2, subjectCode: '1002' }] : [],
    { ...source, subjectCode: '', subjectName: '合计', periodInitialBorrow: '999999999999999999999.00' },
  ] }, query, { id: '35601', name: '测试' }, limits.maxRows, limits.maxBytes))
}
it('compares exact cents, retains unknowns and excludes vendor summaries from single-level sums', async () => {
  const report = await analyzeBalances(selection, read, new AbortController().signal, limits)
  expect(report.differences?.[0]).toMatchObject({ presence: 'both', amounts: {
    periodInitialBorrow: '0.01', periodInitialLoan: null, periodThisBorrow: '-0.02', periodThisLoan: '0.00',
  } })
  expect(report.differences?.[1]).toMatchObject({ presence: 'current-only', amounts: { periodInitialBorrow: null } })
  expect(report.returnedRowSums.current.periodInitialBorrow).toBe('18014398509481986.02')
  expect(report.returnedRowSums.current.periodInitialLoan).toBeNull()
  expect(report.coverage).toBe('unverified')
  expect(report.current.summaries).toHaveLength(1)
  const bytes = await balanceAnalysisWorkbook(report)
  expect(await readSheet(bytes, '期间差额')).toContainEqual(['001001', '=SUM(1,2)', '两个期间',
    '0.01', '不可计算', '-0.02', '0.00', '0.00', '0.00', '0.00', '不可计算'])
  expect(await readSheet(bytes)).toEqual(await readSheet(bytes, '期间差额'))
  expect(await readSheet(bytes, '来源行')).toHaveLength(6)
})
it('reports debit and credit reductions as separate same-baseline differences', async () => {
  const report = await analyzeBalances(selection, async (query) => {
    const value = await read(query)
    value.rows = [{ ...value.rows[0]!,
      periodThisBorrow: query.month === selection.month ? '12.33' : '12.34',
      periodThisLoan: query.month === selection.month ? '56.77' : '56.78' }]
    value.summaries = []
    return value
  }, new AbortController().signal, limits)
  expect(report.differences?.[0]?.amounts).toMatchObject({
    periodThisBorrow: '-0.01',
    periodThisLoan: '-0.01',
  })
})
it('preserves baseline-only rows and does not invent zeros for an empty current result', async () => {
  const report = await analyzeBalances(selection, async (query) => {
    const value = await read(query)
    return query.month === selection.month ? { ...value, rows: [], summaries: [] } : value
  }, new AbortController().signal, limits)
  expect(report.differences?.[0]?.presence).toBe('baseline-only')
  expect(report.returnedRowSums.current.periodThisLoan).toBeNull()
})
it('supports a single month without fabricating comparison results', async () => {
  const report = await analyzeBalances({ month: selection.month, subjectLevel: 1 }, read, new AbortController().signal, limits)
  expect(report).not.toHaveProperty('differences')
  expect(report).not.toHaveProperty('baseline')
})
it.each(['ledger', 'period', 'level', 'identity', 'row-limit', 'byte-limit', 'cancel'])(
  'rejects %s without emitting an analysis', async (mode) => {
    const controller = new AbortController()
    await expect(analyzeBalances(selection, async (query) => {
      const value = await read(query)
      if (mode === 'period') value.month = '2020-01'
      if (mode === 'level') value.subjectLevelEnd = 2
      if (mode === 'ledger' && query.month === selection.compareMonth) value.accountId = 'other'
      if (mode === 'identity' && query.month === selection.compareMonth) value.rows[0]!.subjectCode = 'other'
      if (mode === 'cancel') controller.abort()
      return value
    }, controller.signal, { maxRows: mode === 'row-limit' ? 1 : 100, maxBytes: mode === 'byte-limit' ? 1 : 65536 })).rejects.toThrow()
  })
it('requires an explicit single level and rejects unknown parameters', () => {
  expect(balanceAnalysisSchema.safeParse({ month: selection.month }).success).toBe(false)
  expect(balanceAnalysisSchema.safeParse({ ...selection, subjectLevelEnd: 4 }).success).toBe(false)
})

it.each(['matched', 'mismatch', 'duplicate', 'blank', 'child'])(
  'qualifies root total reconciliation without zero filling: %s', async (mode) => {
    const report = await analyzeBalances({ month: selection.month, subjectLevel: mode === 'child' ? 2 : 1 }, async (query) => {
      const value = await read({ ...query, subjectLevel: 1, subjectLevelEnd: 1 })
      value.subjectLevel = query.subjectLevel ?? 1
      value.subjectLevelEnd = query.subjectLevelEnd ?? 1
      value.rows = value.rows.map(row => ({ ...row, subjectLevel: query.subjectLevel ?? 1 }))
      const total = { ...value.summaries[0]!, subjectName: '本期合计', periodThisBorrow: mode === 'blank' ? null : mode === 'mismatch' ? '0.01' : '-0.02' }
      value.summaries = mode === 'duplicate' ? [total, total] : [total]
      return value
    }, new AbortController().signal, limits)
    expect(report.reconciliation.current.periodThisBorrow.status).toBe(mode === 'child' ? 'unsupported-level'
      : mode === 'duplicate' || mode === 'blank' ? 'total-unavailable' : mode)
    expect(report.reconciliation.current.periodInitialLoan.providedSum).toBeNull()
    expect(report.reconciliation.current.periodInitialLoan.missingCells).toBe(2)
    expect(report.coverage).toBe('unverified')
    const counts = report.reconciliationCounts.current
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(8)
    for (const [status, count] of Object.entries(counts)) {
      expect(count).toBe(Object.values(report.reconciliation.current).filter(check => check.status === status).length)
    }
    expect(await readSheet(await balanceAnalysisWorkbook(report), '合计核对')).toHaveLength(9)
  })
