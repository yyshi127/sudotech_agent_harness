/** XLSX preserves the queried balance columns and keeps vendor summaries separate. */
import writeExcelFile from 'write-excel-file/node'
import type { BalanceResult, BalanceRow } from './balances.ts'
import { workbookColumns as widths, workbookRow as row } from './workbook-row.ts'

const columns = [
  ['periodInitialBorrow', '期初借方'], ['periodInitialLoan', '期初贷方'], ['periodInitialBalance', '期初余额'],
  ['periodThisBorrow', '本期借方'], ['periodThisLoan', '本期贷方'], ['periodThisBalance', '本期余额'],
  ['periodYearBorrow', '本年累计借方'], ['periodYearLoan', '本年累计贷方'], ['periodYearBalance', '本年累计余额'],
  ['periodFinalBorrow', '期末借方'], ['periodFinalLoan', '期末贷方'], ['periodFinalBalance', '期末余额'],
] as const

function data(rows: BalanceRow[]) {
  return [row('科目编码', '科目名称', '科目层级', '存在下级', ...columns.map(([, label]) => label)),
    ...rows.map(item => row(item.subjectCode, item.subjectName, String(item.subjectLevel), item.hasChild ? '是' : '否',
      ...columns.map(([key]) => item[key] ?? '未提供')))]
}

/**
 * Serialize the bounded balance result without totals, inferred currencies or zero-filled blanks.
 * @param report - Host-projected subject rows and separate summaries.
 * @returns Workbook bytes; nullable amounts are explicitly marked 未提供 and numeric text is preserved.
 */
export async function balanceWorkbook(report: BalanceResult): Promise<Buffer> {
  const sheetColumns = widths(14, 22, 10, 10, ...Array.from({ length: 12 }, () => 16))
  return writeExcelFile([{ sheet: '科目余额', data: data(report.rows), columns: sheetColumns, stickyRowsCount: 1 },
    { sheet: '合计', data: data(report.summaries), columns: sheetColumns, stickyRowsCount: 1 }]).toBuffer()
}
