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
  const rows = await readSheet(bytes, '科目行')
  expect(rows).toHaveLength(3)
  expect(rows[1]).toEqual(['001001', '=SUM(1,2)', '1', 'true', '未提供', '0.00', '9007199254740993.01',
    '-25.50', '2.00', '-27.50', '1.00', '2.00', '-1.00', '-27.50', '未提供', '未提供'])
  expect(await readSheet(bytes, '接口汇总')).toHaveLength(2)
  expect(await readSheet(bytes, '查询说明')).toContainEqual(['完整性', 'unverified'])
  expect(await readSheet(bytes, '查询说明')).toContainEqual(['输出口径', '账套本位币；接口不返回币种代码。仅保留本次接口返回值，完整性未验证，不自行合计父子科目。'])
  expect(await readSheet(bytes, '查询说明')).toContainEqual(['科目行数', '2'])
  expect(await readSheet(bytes, '查询说明')).toContainEqual(['查询科目层级', '接口默认；不代表全部层级'])
  report.rows = []
  report.subjectLevel = 2
  expect(await readSheet(await balanceWorkbook(report), '查询说明')).toContainEqual(['查询科目层级', '2'])
  expect(await readSheet(await balanceWorkbook(report), '科目行')).toHaveLength(1)
})
