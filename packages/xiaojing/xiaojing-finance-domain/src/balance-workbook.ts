/** XLSX preserves the queried balance columns and keeps vendor summaries separate. */
import { createHash } from 'node:crypto'
import writeExcelFile from 'write-excel-file/node'
import type { BalanceResult, BalanceRow } from './balances.ts'
import { workbookRow as row } from './workbook-row.ts'

const columns = [
  ['periodInitialBorrow', '期初借方'], ['periodInitialLoan', '期初贷方'], ['periodInitialBalance', '期初余额'],
  ['periodThisBorrow', '本期借方'], ['periodThisLoan', '本期贷方'], ['periodThisBalance', '本期余额'],
  ['periodYearBorrow', '本年累计借方'], ['periodYearLoan', '本年累计贷方'], ['periodYearBalance', '本年累计余额'],
  ['periodFinalBorrow', '期末借方'], ['periodFinalLoan', '期末贷方'], ['periodFinalBalance', '期末余额'],
] as const

function data(rows: BalanceRow[]) {
  return [row('科目编码', '科目名称', '科目层级', '存在下级', ...columns.map(([, label]) => label)),
    ...rows.map(item => row(item.subjectCode, item.subjectName, String(item.subjectLevel), String(item.hasChild),
      ...columns.map(([key]) => item[key] ?? '未提供')))]
}

/**
 * Serialize the bounded balance result without totals, inferred currencies or zero-filled blanks.
 * @param report - Host-projected subject rows, separate summaries and completeness notice.
 * @returns Workbook bytes; nullable amounts are explicitly marked 未提供 and numeric text is preserved.
 */
export async function balanceWorkbook(report: BalanceResult): Promise<Buffer> {
  const metadata = [row('项目', '值'), row('账套 ID', report.accountId), row('账套名称', report.accountName),
    row('开始期间', report.month), row('结束期间', report.monthEnd), row('完整性', report.coverage),
    row('查询科目层级', report.subjectLevelEnd !== undefined ? `${report.subjectLevel}—${report.subjectLevelEnd}；本位币、不分页、含禁用科目` : report.subjectLevel === undefined ? '接口默认；不代表全部层级' : String(report.subjectLevel)),
    row('科目行数', String(report.rows.length)), row('接口汇总行数', String(report.summaries.length)),
    row('来源', '/finance/subject/getList.rjson'), row('限制', report.notice),
    ...report.reconciliation === undefined ? [] : [row('合计核对', JSON.stringify(report.reconciliation))],
    row('输出口径', '账套本位币；接口不返回币种代码。仅保留本次接口返回值，完整性未验证，不自行合计父子科目。'),
    row('金额格式', '精确文本；未提供表示接口 null，不是零；负金额仍保留在原借贷列。'),
    row('结果 SHA256', createHash('sha256').update(JSON.stringify(report)).digest('hex'))]
  return writeExcelFile([{ sheet: '查询说明', data: metadata }, { sheet: '科目行', data: data(report.rows) },
    { sheet: '接口汇总', data: data(report.summaries) }]).toBuffer()
}
