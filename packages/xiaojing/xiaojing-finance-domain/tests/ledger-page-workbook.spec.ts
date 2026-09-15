import { expect, it } from 'vitest'
import { readSheet } from 'read-excel-file/node'
import { projectJournals } from '../src/journals.ts'
import { projectOpenItems } from '../src/open-items.ts'
import { journalWorkbook, openItemPageWorkbook } from '../src/ledger-page-workbook.ts'

const account = { id: '35601', name: '测试账套' }

it('exports journal currencies, all amount sides and markers without merging them', async () => {
  const marker = { date: '', abstractStr: '初始余额', accountCode: '', accountName: '', currencyCode: '', baseCurrencyCode: '',
    balance: 0, baseBalance: 0, categoryName: '', keeperName: '' }
  const report = projectJournals([marker, { ...marker, id: 123, date: '2026-09-07', abstractStr: '=1+1', accountCode: '001001',
    accountName: '现金', currencyCode: 'USD', baseCurrencyCode: 'CNY', borrow: '9007199254740993.01', loan: '-0.01' }],
  { month: '2026-09', page: 1, pageSize: 20 }, account, 100, 65536)
  const bytes = await journalWorkbook(report)
  expect((await readSheet(bytes, '日记账业务'))[1]).toEqual(['123', '2026-09-07', '=1+1', '001001', '现金', 'USD', 'CNY',
    '9007199254740993.01', '-0.01', '0.00', '未提供', '未提供', '0.00', null, null])
  const summaries = await readSheet(bytes, '接口汇总')
  expect(summaries).toHaveLength(2)
  expect(summaries[1]?.[0]).toBe('opening')
  expect(await readSheet(bytes, '查询说明')).toContainEqual(['完整性', 'unverified'])
})

it.each(['receivable', 'payable'] as const)('exports %s with nullable flags, eight amounts and separate page totals', async (direction) => {
  const marker = { id: -123, date: '', abstractStr: '合计', subjectCode: '', subjectName: '', auxiliaryItemIds: '', auxiliaryItemName: '',
    currencyCode: '', baseCurrencyCode: '', money: 0, balance: 0, baseMoney: 0, baseBalance: 0, categoryName: '', remark: '' }
  const report = projectOpenItems({ count: 1, list: [marker, { ...marker, id: 123, setOfBooksId: 35601, date: '2026-09-07',
    abstractStr: '+SUM(1,2)', subjectCode: '1122', subjectName: '应收', auxiliaryItemIds: '00456', auxiliaryItemName: '辅助',
    currencyCode: 'USD', baseCurrencyCode: 'CNY', money: '300.00', balance: '-0.01', thisMoney: '100.00',
    badMoney: '1.00', hedgeMoney: '2.00', returnMoney: '3.00', isFinish: false, remark: '@备注' }],
  pageUpRecord: { ...marker, abstractStr: '上一页的总计' } },
  { direction, periodStart: '2026-09', periodEnd: '2026-09', page: 1, pageSize: 20 }, account, 100, 65536)
  const bytes = await openItemPageWorkbook(report)
  expect((await readSheet(bytes, '往来业务'))[1]).toEqual(['123', '2026-09-07', '+SUM(1,2)', '1122', '应收', '00456', '辅助',
    'USD', 'CNY', '300.00', '-0.01', '0.00', '0.00', '100.00', '1.00', '2.00', '3.00', '未提供', 'false', null, '@备注'])
  expect((await readSheet(bytes, '接口汇总')).slice(1).map(r => r[0])).toEqual(['total', 'previous-page'])
  expect(await readSheet(bytes, '查询说明')).toContainEqual(['查询条件', JSON.stringify(report.selection)])
  report.rows = []
  expect(await readSheet(await openItemPageWorkbook(report), '往来业务')).toHaveLength(1)
})
