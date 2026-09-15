/** Explicit column mappings for bounded journal and receivable/payable source exports. */
import { createHash } from 'node:crypto'
import writeExcelFile from 'write-excel-file/node'
import type { JournalResult } from './journals.ts'
import type { OpenItemResult } from './open-items.ts'
import { workbookRow as row } from './workbook-row.ts'

function table<T>(items: T[], columns: readonly (readonly [keyof T, string])[]) {
  return [row(...columns.map(([, label]) => label)), ...items.map(item => row(
    ...columns.map(([key]) => item[key] === null ? '未提供' : String(item[key]))))]
}

function metadata(report: JournalResult | OpenItemResult, source: string) {
  return [row('项目', '值'), row('账套 ID', report.accountId), row('账套名称', report.accountName),
    row('查询条件', JSON.stringify(report.selection)), row('业务行数', String(report.rows.length)),
    row('汇总行数', String(report.summaries.length)), row('完整性', report.coverage), row('限制', report.notice),
    row('来源', source), row('输出口径', '仅本次查询页；金额精确文本，未提供表示 null，不合计或推断币种。'),
    row('结果 SHA256', createHash('sha256').update(JSON.stringify(report)).digest('hex'))]
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
 * @returns Exact-text XLSX bytes with explicit incomplete-coverage notice.
 */
export async function journalWorkbook(report: JournalResult): Promise<Buffer> {
  return writeExcelFile([
    { sheet: '查询说明', data: metadata(report, '/finance/cashjournal/getListPage.rjson') },
    { sheet: '日记账业务', data: table(report.rows, [['id', '流水 ID'], ['date', '日期'], ...journalFields]) },
    { sheet: '接口汇总', data: table(report.summaries, [['kind', '标记类型'], ...journalFields]) },
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
 * @returns Exact-text workbook retaining nullable flags, source IDs and original/base currencies.
 */
export async function openItemPageWorkbook(report: OpenItemResult): Promise<Buffer> {
  return writeExcelFile([
    { sheet: '查询说明', data: [...metadata(report, '/finance/cashjournal/getCashierList'), row('接口声明总数', String(report.totalCount))] },
    { sheet: '往来业务', data: table(report.rows, [
      ['id', '往来 ID'], ['date', '日期'], ['summary', '摘要'], ['subjectCode', '科目编码'], ['subjectName', '科目名称'],
      ['auxiliaryItemIds', '辅助项目 ID'], ['auxiliaryItemName', '辅助项目名称'], ...currencies, ...amountFields,
      ['initialBalance', '期初记录'], ['finished', '已结清'], ['categoryName', '类别'], ['remark', '备注'],
    ]) },
    { sheet: '接口汇总', data: table(report.summaries, [['kind', '标记类型'], ...currencies, ...amountFields]) },
  ]).toBuffer()
}
