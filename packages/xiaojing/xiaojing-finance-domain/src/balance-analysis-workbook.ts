/** Source-backed single-level balance comparisons with literal monetary cells. */
import writeExcelFile from 'write-excel-file/node'
import { balanceAnalysisFields, type BalanceAnalysisResult } from './balance-analysis.ts'
import { workbookRow as row } from './workbook-row.ts'

/**
 * Export exact source columns and derived differences without implying complete-ledger totals.
 * @param report - Host-produced analysis and both original reports.
 * @returns Workbook bytes with missing amounts marked and only business-facing sheets.
 */
export async function balanceAnalysisWorkbook(report: BalanceAnalysisResult): Promise<Buffer> {
  const labels = ['期初借方', '期初贷方', '本期借方', '本期贷方', '本年累计借方', '本年累计贷方', '期末借方', '期末贷方']
  const sources = [row('期间', '行类型', '科目编码', '科目名称', '层级', ...labels,
    '期初余额', '本期余额', '本年累计余额', '期末余额')]
  const sums = [row('期间', '合计范围', ...labels)]
  const checks = [row('期间', '金额列', '科目合计', '未提供项数', '账套合计', '核对状态')]
  for (const [key, label] of [['current', '当前'], ['baseline', '基准']] as const) {
    const source = report[key]
    const aggregate = report.returnedRowSums[key]
    if (source === undefined || aggregate === undefined) continue
    const reconciliation = report.reconciliation[key]
    if (reconciliation !== undefined) balanceAnalysisFields.forEach((field, index) => {
      const check = reconciliation[field]
      checks.push(row(label, labels[index] ?? field, check.providedSum ?? '未提供', String(check.missingCells),
        check.vendorTotal ?? '未提供', check.status === 'matched' ? '一致' : check.status === 'mismatch' ? '不一致' : '无法核对'))
    })
    sums.push(row(label, '当前科目层级', ...balanceAnalysisFields.map(field => aggregate[field] ?? '未提供')))
    for (const [kind, entries] of [['科目', source.rows], ['账套合计', source.summaries]] as const) {
      for (const item of entries) sources.push(row(label, kind, item.subjectCode,
        item.subjectName, String(item.subjectLevel), ...balanceAnalysisFields.map(field => item[field] ?? '未提供'),
        ...[item.periodInitialBalance, item.periodThisBalance, item.periodYearBalance, item.periodFinalBalance].map(value => value ?? '未提供')))
    }
  }
  const differences = report.differences === undefined ? [] : [{ sheet: '期间差额', data: [row('科目编码', '科目名称', '出现期间', ...labels),
    ...report.differences.map(item => row(item.subjectCode, item.subjectName,
      item.presence === 'both' ? '两个期间' : item.presence === 'current-only' ? '仅当前期间' : '仅基准期间',
      ...balanceAnalysisFields.map(field => item.amounts[field] ?? '不可计算')))] }]
  return writeExcelFile([
    ...differences,
    { sheet: '来源行', data: sources }, { sheet: '科目行加总', data: sums },
    { sheet: '合计核对', data: checks },
  ]).toBuffer()
}
