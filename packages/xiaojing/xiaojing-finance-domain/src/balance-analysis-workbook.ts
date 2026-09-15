/** Source-backed single-level balance comparisons with literal monetary cells. */
import { createHash } from 'node:crypto'
import writeExcelFile from 'write-excel-file/node'
import { balanceAnalysisFields, type BalanceAnalysisResult } from './balance-analysis.ts'
import { workbookRow as row } from './workbook-row.ts'

/**
 * Export exact source columns and derived differences without implying complete-ledger totals.
 * @param report - Host-produced analysis and both original reports.
 * @returns Workbook bytes, with missing amounts marked and source hash retained.
 */
export async function balanceAnalysisWorkbook(report: BalanceAnalysisResult): Promise<Buffer> {
  const labels = ['期初借方', '期初贷方', '本期借方', '本期贷方', '本年累计借方', '本年累计贷方', '期末借方', '期末贷方']
  const metadata = [row('项目', '值'), row('账套 ID', report.accountId), row('账套名称', report.accountName),
    row('查询条件', JSON.stringify(report.selection)), row('币种口径', report.currencyBasis), row('完整性', report.coverage),
    row('差额方向', '当前月减基准月'), row('限制', report.notice),
    row('合计核对口径', report.reconciliationNotice),
    row('结果 SHA256', createHash('sha256').update(JSON.stringify(report)).digest('hex'))]
  const sources = [row('查询组', '行类型', '科目 ID', '科目编码', '科目名称', '层级', ...labels,
    '期初接口余额', '本期接口余额', '本年累计接口余额', '期末接口余额')]
  const sums = [row('查询组', '合计口径', ...labels)]
  const checks = [row('查询组', '金额列', '已提供金额加总', '空值数', '接口合计', '核对状态')]
  for (const [key, label] of [['current', '当前'], ['baseline', '基准']] as const) {
    const source = report[key]
    const aggregate = report.returnedRowSums[key]
    if (source === undefined || aggregate === undefined) continue
    const reconciliation = report.reconciliation[key]
    if (reconciliation !== undefined) balanceAnalysisFields.forEach((field, index) => {
      const check = reconciliation[field]
      checks.push(row(label, labels[index] ?? field, check.providedSum ?? '未提供', String(check.missingCells),
        check.vendorTotal ?? '未提供', check.status))
    })
    sums.push(row(label, '仅返回单层级行；完整性未核验', ...balanceAnalysisFields.map(field => aggregate[field] ?? '未提供')))
    for (const [kind, entries] of [['科目', source.rows], ['接口汇总', source.summaries]] as const) {
      for (const item of entries) sources.push(row(label, kind, item.subjectInfoId?.toString() ?? '', item.subjectCode,
        item.subjectName, String(item.subjectLevel), ...balanceAnalysisFields.map(field => item[field] ?? '未提供'),
        ...[item.periodInitialBalance, item.periodThisBalance, item.periodYearBalance, item.periodFinalBalance].map(value => value ?? '未提供')))
    }
  }
  return writeExcelFile([{ sheet: '查询说明', data: metadata }, { sheet: '来源行', data: sources }, { sheet: '返回行加总', data: sums },
    { sheet: '接口合计核对', data: checks },
    ...report.differences === undefined ? [] : [{ sheet: '期间差额', data: [row('科目 ID', '科目编码', '科目名称', '出现范围', ...labels),
      ...report.differences.map(item => row(String(item.subjectInfoId), item.subjectCode, item.subjectName, item.presence,
        ...balanceAnalysisFields.map(field => item.amounts[field] ?? '不可计算')))] }],
  ]).toBuffer()
}
