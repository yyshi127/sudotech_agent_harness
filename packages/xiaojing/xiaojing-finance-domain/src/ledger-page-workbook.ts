/** Explicit column mappings for bounded journal and receivable/payable source exports. */
import writeExcelFile from 'write-excel-file/node'
import type { JournalResult } from './journals.ts'
import type { OpenItemResult } from './open-items.ts'
import { workbookRow as row } from './workbook-row.ts'

function table<T>(items: T[], columns: readonly (readonly [keyof T, string])[]) {
  return [row(...columns.map(([, label]) => label)), ...items.map(item => row(
    ...columns.map(([key]) => item[key] === null ? '未提供' : String(item[key]))))]
}

const journalFields = [
  ['summary', '摘要'], ['accountCode', '账户编码'], ['accountName', '账户名称'],
  ['currencyCode', '原币'], ['baseCurrencyCode', '本位币'], ['income', '收入'], ['expense', '支出'], ['balance', '余额'],
  ['baseIncome', '本位币收入'], ['baseExpense', '本位币支出'], ['baseBalance', '本位币余额'],
  ['categoryName', '收支类别'], ['keeperName', '经手人'],
] as const

/**
 * Export all projected fields of one journal page, keeping balance markers out of business rows.
 * @param report - Host-validated page with concrete dates and account selection.
 * @returns Exact-text XLSX bytes containing journal business rows and totals.
 */
export async function journalWorkbook(report: JournalResult): Promise<Buffer> {
  return writeExcelFile([
    { sheet: '日记账明细', data: table(report.rows, [['date', '日期'], ...journalFields]) },
    { sheet: '合计', data: table(report.summaries, [['kind', '合计类型'], ...journalFields]) },
  ]).toBuffer()
}

const amountFields = [
  ['amount', '金额'], ['balance', '余额'], ['baseAmount', '本位币金额'], ['baseBalance', '本位币余额'],
  ['settledAmount', '已收已付金额'], ['badDebtAmount', '坏账或转已付金额'],
  ['offsetAmount', '对冲金额'], ['returnAmount', '退货金额'],
] as const
const currencies = [['currencyCode', '原币'], ['baseCurrencyCode', '本位币']] as const

/**
 * Export one receivable/payable page without treating settlement fields as bank payment evidence.
 * @param report - Host-validated business records, summaries and declared count.
 * @returns Exact-text workbook retaining nullable flags and original/base currencies.
 */
export async function openItemPageWorkbook(report: OpenItemResult): Promise<Buffer> {
  return writeExcelFile([
    { sheet: report.selection.direction === 'receivable' ? '应收明细' : '应付明细', data: table(report.rows, [
      ['date', '日期'], ['summary', '摘要'], ['subjectCode', '科目编码'], ['subjectName', '科目名称'],
      ['auxiliaryItemName', '往来对象'], ...currencies, ...amountFields,
      ['initialBalance', '期初记录'], ['finished', '已结清'], ['categoryName', '类别'], ['remark', '备注'],
    ]) },
    { sheet: '合计', data: table(report.summaries, [['kind', '合计类型'], ...currencies, ...amountFields]) },
  ]).toBuffer()
}
