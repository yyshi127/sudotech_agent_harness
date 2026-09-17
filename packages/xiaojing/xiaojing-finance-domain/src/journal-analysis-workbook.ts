/** Exact-text export of reconciled journal totals and their nullable source rows. */
import writeExcelFile from 'write-excel-file/node'
import type { JournalAnalysisResult } from './journal-analysis.ts'
import { workbookColumns as widths, workbookRow as row } from './workbook-row.ts'

/**
 * Preserve comparison conditions, source rows, missing amounts and exact arithmetic.
 * @param report - Host-produced reconciled report, not caller-authored data.
 * @returns XLSX bytes; money remains text and no cell is interpreted as a formula.
 */
export async function journalAnalysisWorkbook(report: JournalAnalysisResult): Promise<Buffer> {
  const aggregates = [row('期间类型', '期间', '开始日期', '结束日期', '原币', '收入', '支出')]
  const sources = [row('期间类型', '日期', '摘要', '账户编码', '账户名称', '原币', '本位币', '收入', '支出', '余额', '本位币收入', '本位币支出', '本位币余额', '收支类别', '经手人')]
  for (const [label, group] of [['当前', report.current], ['基准', report.baseline]] as const) {
    if (!group) continue
    aggregates.push(row(label, group.month, group.dateStart, group.dateEnd,
      group.currencyCode ?? '未提供', group.income, group.expense))
    for (const source of group.rows) sources.push(row(label, source.date, source.summary, source.accountCode, source.accountName,
      source.currencyCode, source.baseCurrencyCode, ...[source.income, source.expense, source.balance, source.baseIncome, source.baseExpense, source.baseBalance].map(value => value ?? '未提供'), source.categoryName, source.keeperName))
  }
  return writeExcelFile([{ sheet: '收支汇总', data: aggregates, columns: widths(12, 12, 12, 12, 10, 16, 16), stickyRowsCount: 1 },
    ...report.differences ? [{ sheet: '期间差额', data: [row('原币', '收入差额', '支出差额'),
      row(report.differences.currencyCode ?? '未提供', report.differences.income, report.differences.expense)],
    columns: widths(10, 16, 16), stickyRowsCount: 1 }] : [],
    { sheet: '流水明细', data: sources,
      columns: widths(12, 12, 26, 14, 18, 10, 10, ...Array.from({ length: 6 }, () => 16), 18, 14), stickyRowsCount: 1 },
  ]).toBuffer()
}
