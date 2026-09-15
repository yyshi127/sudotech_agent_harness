/** Exact-text XLSX for one explicitly bounded voucher-list result. */
import { createHash } from 'node:crypto'
import writeExcelFile from 'write-excel-file/node'
import type { VoucherPage } from './vouchers.ts'

import { workbookRow as row } from './workbook-row.ts'

/**
 * Serialize one Host-queried page without inventing totals, currencies or missing rows.
 * @param report - Validated page, including selection and completeness notice.
 * @returns Workbook bytes; amounts and IDs are exact text and no cells are formulas.
 */
export async function voucherWorkbook(report: VoucherPage): Promise<Buffer> {
  const metadata = [row('项目', '值'), row('账套 ID', report.accountId), row('账套名称', report.accountName),
    row('开始期间', report.month), row('结束期间', report.monthEnd ?? report.month),
    row('摘要筛选', report.summary ?? '未设置'), row('页码', String(report.page)), row('每页张数', String(report.pageSize)),
    row('接口总张数', String(report.total)), row('本页凭证张数', String(report.voucherCount)),
    row('分录行数', String(report.rows.length)), row('有下一页', String(report.hasMore)),
    row('范围', '仅为本次查询页；不代表全账套，不计算全账套合计。'), row('限制', report.notice),
    row('金额格式', '精确文本，不是 Excel 数值；未推断币种，不附加合计。'),
    row('来源', '/finance/certificate/list.rjson'),
    row('结果 SHA256', createHash('sha256').update(JSON.stringify(report)).digest('hex'))]
  const entries = [row('凭证 ID', '日期', '凭证号', '摘要', '科目编码', '科目名称', '借方（文本）', '贷方（文本）'),
    ...report.rows.map(item => row(item.voucherId, item.date, item.number, item.summary,
      item.subjectCode, item.subjectName, item.debit, item.credit))]
  return writeExcelFile([{ sheet: '查询说明', data: metadata }, { sheet: '凭证分录', data: entries }]).toBuffer()
}
