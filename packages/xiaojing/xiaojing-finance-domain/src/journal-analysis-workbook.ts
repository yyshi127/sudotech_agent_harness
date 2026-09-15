/** Exact-text export of reconciled journal totals and their nullable source rows. */
import { createHash } from 'node:crypto'
import writeExcelFile from 'write-excel-file/node'
import type { JournalAnalysisResult } from './journal-analysis.ts'
import { workbookRow as row } from './workbook-row.ts'

/**
 * Preserve comparison conditions, source IDs, missing amounts and exact arithmetic.
 * @param report - Host-produced reconciled report, not caller-authored data.
 * @returns XLSX bytes; money remains text and no cell is interpreted as a formula.
 */
export async function journalAnalysisWorkbook(report: JournalAnalysisResult): Promise<Buffer> {
  const metadata = [row('项目', '值'), row('账套 ID', report.accountId), row('账套名称', report.accountName),
    row('查询条件', JSON.stringify(report.selection)), row('核验执行方', report.verificationOwner), row('核验范围', report.coverage), row('限制', report.notice),
    row('来源', '/finance/cashjournal/getListPage.rjson；已提供业务金额与接口合计核对'),
    row('金额格式', '精确文本；未提供不当作零。'), row('结果 SHA256', createHash('sha256').update(JSON.stringify(report)).digest('hex'))]
  const aggregates = [row('查询组', '期间', '开始日期', '结束日期', '读取页数', '业务行数', '原币', '收入', '支出', '收入金额未提供的单元格数', '支出金额未提供的单元格数')]
  const sources = [row('查询组', '流水 ID', '日期', '摘要', '账户编码', '账户名称', '原币', '本位币', '收入', '支出', '余额', '本位币收入', '本位币支出', '本位币余额', '收支类别', '经手人')]
  for (const [label, group] of [['当前', report.current], ['基准', report.baseline]] as const) {
    if (!group) continue
    aggregates.push(row(label, group.month, group.dateStart, group.dateEnd, String(group.pagesRead), String(group.rows.length),
      group.currencyCode ?? '未提供', group.income, group.expense, String(group.incomeMissingValueCount), String(group.expenseMissingValueCount)))
    for (const source of group.rows) sources.push(row(label, source.id, source.date, source.summary, source.accountCode, source.accountName,
      source.currencyCode, source.baseCurrencyCode, ...[source.income, source.expense, source.balance, source.baseIncome, source.baseExpense, source.baseBalance].map(value => value ?? '未提供'), source.categoryName, source.keeperName))
  }
  return writeExcelFile([{ sheet: '查询说明', data: metadata }, { sheet: '核对结果', data: aggregates }, { sheet: '来源流水', data: sources },
    ...report.differences ? [{ sheet: '期间差额', data: [row('原币', '收入差额', '支出差额'),
      row(report.differences.currencyCode ?? '未提供', report.differences.income, report.differences.expense)] }] : [],
  ]).toBuffer()
}
