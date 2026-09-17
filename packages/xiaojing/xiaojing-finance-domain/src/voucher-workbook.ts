/** Exact-text XLSX for a voucher-list result. */
import writeExcelFile from 'write-excel-file/node'
import type { VoucherPage } from './vouchers.ts'

import { workbookColumns as widths, workbookRow as row } from './workbook-row.ts'

/**
 * Serialize validated voucher rows without inventing totals, currencies or missing rows.
 * @param report - Validated query page or complete export.
 * @returns Workbook bytes containing business voucher entries; amounts remain exact text and no cells are formulas.
 */
export async function voucherWorkbook(report: VoucherPage): Promise<Buffer> {
  const entries = [row('日期', '凭证号', '摘要', '科目编码', '科目名称', '借方金额', '贷方金额'),
    ...report.rows.map(item => row(item.date, item.number, item.summary,
      item.subjectCode, item.subjectName, item.debit, item.credit))]
  return writeExcelFile([{ sheet: '凭证分录', data: entries,
    columns: widths(12, 12, 28, 14, 20, 16, 16), stickyRowsCount: 1 }]).toBuffer()
}
