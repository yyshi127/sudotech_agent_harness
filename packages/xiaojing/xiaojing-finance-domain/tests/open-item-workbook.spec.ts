import { describe, expect, it } from 'vitest'
import { readSheet as readExcelFile } from 'read-excel-file/node'
import type { OpenItemAnalysisResult } from '../src/open-item-analysis.ts'
import type { OpenItemId } from '../src/open-items.ts'
import { openItemWorkbook } from '../src/open-item-workbook.ts'

function report(): OpenItemAnalysisResult {
  return {
    accountId: '35601', accountName: '=HYPERLINK("https://example.com")',
    selection: { direction: 'receivable', groupBy: 'subject', current: { periodStart: '2026-09', periodEnd: '2026-09' } },
    current: { periodStart: '2026-09', periodEnd: '2026-09', recordCount: 1, pagesRead: 1,
      groups: [{ currencyCode: 'CNY', dimensionId: '001122', dimensionName: '+SUM(1,2)',
        recordIds: ['000123' as OpenItemId], amount: '9007199254740993.01', balance: '-0.01' }] },
    coverage: 'vendor-count-reconciled', notice: '不是历史期末余额；无原子快照保证。',
  }
}

describe('open-item workbook', () => {
  it('rejects oversized text rather than publishing a truncated cell', async () => {
    const input = report()
    input.current.groups[0]!.dimensionName = '长'.repeat(32_768)
    await expect(openItemWorkbook(input)).rejects.toThrow('单元格容量')
  })

  it('round-trips exact text amounts and formula-like business names without technical worksheets', async () => {
    const input = report()
    const buffer = await openItemWorkbook(input)
    const groups = await readExcelFile(buffer, '分组结果')
    expect(await readExcelFile(buffer)).toEqual(groups)
    expect(groups[1]).toEqual(['当前', '2026-09', '2026-09', 'CNY', '+SUM(1,2)', '9007199254740993.01', '-0.01'])
  })

  it('keeps an empty queried set empty and exports backend differences without recomputing them', async () => {
    const input = report()
    input.baseline = { periodStart: '2026-08', periodEnd: '2026-08', recordCount: 0, pagesRead: 1, groups: [] }
    input.selection.baseline = { periodStart: '2026-08', periodEnd: '2026-08' }
    input.differences = [{ currencyCode: 'CNY', dimensionId: '001122', presence: 'baseline-only',
      amount: '9007199254740993.01', balance: '-0.01' }]
    const buffer = await openItemWorkbook(input)
    expect(await readExcelFile(buffer, '分组结果')).toHaveLength(2)
    expect((await readExcelFile(buffer, '期间差额'))[1]).toEqual([
      'CNY', '+SUM(1,2)', '仅基准期间', '9007199254740993.01', '-0.01',
    ])
  })
})
