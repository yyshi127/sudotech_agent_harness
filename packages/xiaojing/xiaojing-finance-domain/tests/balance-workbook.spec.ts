import { expect, it } from 'vitest'
import { readSheet } from 'read-excel-file/node'
import { balanceWorkbook } from '../src/balance-workbook.ts'
import { projectBalances } from '../src/balances.ts'

it('preserves all twelve columns, missing values, hierarchy and separate vendor summaries', async () => {
  const source = { subjectCode: '001001', subjectName: '=SUM(1,2)', subjectLevel: 1, hasChild: true,
    periodInitialBorrow: '', periodInitialLoan: '0.00', periodInitialBalance: '9007199254740993.01',
    periodThisBorrow: '-25.50', periodThisLoan: '2.00', periodThisBalance: '-27.50',
    periodYearBorrow: '1.00', periodYearLoan: '2.00', periodYearBalance: '-1.00',
    periodFinalBorrow: '-27.50', periodFinalLoan: '', periodFinalBalance: '' }
  const report = projectBalances({ success: true, count: 0, list: [source,
    { ...source, subjectCode: '00100101', subjectLevel: 2, hasChild: false },
    { ...source, subjectCode: '', subjectName: '本期合计' }] }, { month: '2026-09' }, { id: '35601', name: '测试' }, 100, 65536)
  const bytes = await balanceWorkbook(report)
  const rows = await readSheet(bytes, '科目余额')
  expect(await readSheet(bytes)).toEqual(rows)
  expect(rows).toHaveLength(3)
  expect(rows[0]).toContain('本年累计借方')
  expect(rows[0]).toContain('本年累计贷方')
  expect(rows[0]).not.toContain('年末累计借方')
  expect(rows[1]).toEqual(['001001', '=SUM(1,2)', '1', '是', '未提供', '0.00', '9007199254740993.01',
    '-25.50', '2.00', '-27.50', '1.00', '2.00', '-1.00', '-27.50', '未提供', '未提供'])
  expect(await readSheet(bytes, '合计')).toHaveLength(2)
  report.rows = []
  report.subjectLevel = 2
  expect(await readSheet(await balanceWorkbook(report), '科目余额')).toHaveLength(1)
})
