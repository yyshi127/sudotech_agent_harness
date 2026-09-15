import { expect, it } from 'vitest'
import { readSheet } from 'read-excel-file/node'
import { voucherWorkbook } from '../src/voucher-workbook.ts'
import type { VoucherPage } from '../src/vouchers.ts'

it('exports each entry unchanged and distinguishes page voucher count from entry rows and vendor total', async () => {
  const report: VoucherPage = {
    accountId: '35601', accountName: '=1+1', month: '2026-08', monthEnd: '2026-09', summary: '销售',
    page: 2, pageSize: 1, total: 3, hasMore: true, voucherCount: 1, notice: '仅为当前页，币种未提供。',
    rows: [
      { voucherId: '000123', date: '2026-09-07', number: '记-2', summary: '+SUM(1,2)', subjectCode: '001001', subjectName: '现金', debit: '9007199254740993.01', credit: '0.00' },
      { voucherId: '000123', date: '2026-09-07', number: '记-2', summary: '+SUM(1,2)', subjectCode: '001002', subjectName: '银行', debit: '0.00', credit: '9007199254740993.01' },
    ],
  }
  const bytes = await voucherWorkbook(report)
  const metadata = await readSheet(bytes, '查询说明')
  for (const pair of [['页码', '2'], ['接口总张数', '3'], ['本页凭证张数', '1'], ['分录行数', '2'], ['有下一页', 'true'], ['摘要筛选', '销售'], ['账套名称', '=1+1']]) expect(metadata).toContainEqual(pair)
  expect(await readSheet(bytes, '凭证分录')).toEqual([
    ['凭证 ID', '日期', '凭证号', '摘要', '科目编码', '科目名称', '借方（文本）', '贷方（文本）'],
    ...report.rows.map(item => [item.voucherId, item.date, item.number, item.summary,
      item.subjectCode, item.subjectName, item.debit, item.credit]),
  ])
  report.rows = []
  report.voucherCount = 0
  expect(await readSheet(await voucherWorkbook(report), '凭证分录')).toHaveLength(1)
  report.accountName = 'x'.repeat(32_768)
  await expect(voucherWorkbook(report)).rejects.toThrow('单元格容量')
})
