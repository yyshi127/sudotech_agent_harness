import { expect, it } from 'vitest'
import { readSheet } from 'read-excel-file/node'
import { voucherWorkbook } from '../src/voucher-workbook.ts'
import type { VoucherPage } from '../src/vouchers.ts'

it('exports only business voucher columns and preserves exact entry values', async () => {
  const report: VoucherPage = {
    accountId: '35601', accountName: '=1+1', month: '2026-08', monthEnd: '2026-09', summary: '销售',
    page: 2, pageSize: 1, total: 3, hasMore: true, voucherCount: 1, notice: '仅为当前页，币种未提供。',
    rows: [
      { voucherId: '000123', date: '2026-09-07', number: '记-2', summary: '+SUM(1,2)', subjectCode: '001001', subjectName: '现金', debit: '9007199254740993.01', credit: '0.00' },
      { voucherId: '000123', date: '2026-09-07', number: '记-2', summary: '+SUM(1,2)', subjectCode: '001002', subjectName: '银行', debit: '0.00', credit: '9007199254740993.01' },
    ],
  }
  const bytes = await voucherWorkbook(report)
  expect((await readSheet(bytes))[0]).toEqual(['日期', '凭证号', '摘要', '科目编码', '科目名称', '借方金额', '贷方金额'])
  expect(await readSheet(bytes, '凭证分录')).toEqual([
    ['日期', '凭证号', '摘要', '科目编码', '科目名称', '借方金额', '贷方金额'],
    ...report.rows.map(item => [item.date, item.number, item.summary,
      item.subjectCode, item.subjectName, item.debit, item.credit]),
  ])
  report.rows = []
  report.voucherCount = 0
  expect(await readSheet(await voucherWorkbook(report), '凭证分录')).toHaveLength(1)
  report.rows = [{ voucherId: '1', date: '2026-09-07', number: '记-1', summary: '测试', subjectCode: '1001',
    subjectName: 'x'.repeat(32_768), debit: '1.00', credit: '0.00' }]
  await expect(voucherWorkbook(report)).rejects.toThrow('单元格容量')
})

it('keeps a collected voucher export focused on the returned business entries', async () => {
  const report: VoucherPage = {
    accountId: '35616', accountName: '施的演示账套', month: '2026-08', monthEnd: '2026-09',
    page: 1, pageSize: 100, total: 1, hasMore: false, voucherCount: 1, pagesRead: 2,
    notice: '已按接口总张数完成核对。', rows: [
      { voucherId: '1', date: '2026-09-01', number: '记-1', summary: '测试', subjectCode: '1001', subjectName: '库存现金', debit: '1.00', credit: '0.00' },
    ],
  }

  expect(await readSheet(await voucherWorkbook(report))).toEqual([
    ['日期', '凭证号', '摘要', '科目编码', '科目名称', '借方金额', '贷方金额'],
    ['2026-09-01', '记-1', '测试', '1001', '库存现金', '1.00', '0.00'],
  ])
})
