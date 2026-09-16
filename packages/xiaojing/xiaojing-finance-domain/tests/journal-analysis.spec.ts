import { afterEach, expect, it, vi } from 'vitest'
import { readSheet } from 'read-excel-file/node'
import { analyzeJournals, type JournalAnalysisQuery } from '../src/journal-analysis.ts'
import { journalAnalysisWorkbook } from '../src/journal-analysis-workbook.ts'
import { projectJournals, type JournalQuery, type JournalResult } from '../src/journals.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const query: JournalAnalysisQuery = { cashAccountId: '174553', current: { month: '2026-09' }, baseline: { month: '2026-08' } }
const limits = { maxRows: 100, maxBytes: 65536, pageSize: 1 }
const account = { id: '35601', name: '=SUM(1,2)' }
const marker = { date: '', abstractStr: '合计', accountCode: '', accountName: '', currencyCode: '', baseCurrencyCode: '', categoryName: '', keeperName: '' }
const raw = (selected: JournalQuery) => {
  const total = { ...marker, borrow: selected.month === '2026-08' ? 0 : '0.30', loan: 0 }
  return selected.month === '2026-08' || selected.page > 2 ? [total] : [{ ...marker,
    id: selected.page, subjectId: 174553, date: '2026-09-07', abstractStr: '=HYPERLINK("https://example.com")',
    currencyCode: 'RMB', borrow: selected.page === 1 ? '0.10' : '0.20' }]
}
const page = (selected: JournalQuery): JournalResult => projectJournals(raw(selected), selected, account, 100, 65536)
afterEach(() => vi.unstubAllGlobals())

it('exhausts pages, reconciles provided values and compares without filling nullable source cells', async () => {
  const read = vi.fn(async (selected: JournalQuery) => page(selected))
  const result = await analyzeJournals(query, read, new AbortController().signal, limits)
  expect(read.mock.calls.map(([selected]) => [selected.month, selected.page])).toEqual([
    ['2026-09', 1], ['2026-09', 2], ['2026-09', 3], ['2026-08', 1],
  ])
  expect(result.current).toMatchObject({ income: '0.30', expense: '0.00', currencyCode: 'RMB', pagesRead: 3, incomeMissingValueCount: 0, expenseMissingValueCount: 2 })
  expect(result.current.rows).toHaveLength(2)
  expect(result.current).not.toHaveProperty('missingExpenseRows')
  expect(result.current.rows.map(row => row.expense)).toEqual([null, null])
  expect(result.baseline).toMatchObject({ rows: [], income: '0.00', expense: '0.00', currencyCode: null })
  expect(result.differences).toEqual({ currencyCode: 'RMB', income: '0.30', expense: '0.00' })
  expect(result.selection.current).toEqual({ month: '2026-09', dateStart: '2026-09-01', dateEnd: '2026-09-30' })
  expect(result.coverage).toBe('empty-page-and-totals-reconciled')
  expect(result.verificationOwner).toBe('xiaojing')
  expect(result.notice).toContain('不是有成接口声明的完整性或原子快照保证')
  expect(result.notice).toContain('不是缺少流水记录')
})

it.each(['duplicate', 'missing-currency', 'mixed-currency', 'wrong-total-currency', 'missing-total', 'null-total', 'wrong-total', 'ledger-change', 'selection-change', 'early-empty', 'changing-total', 'multiple-total'])('rejects %s without a partial report', async (failure) => {
  await expect(analyzeJournals(query, async (selected) => {
    const result = page(selected)
    if (selected.page === 2) {
      if (failure === 'duplicate') result.rows = page({ ...selected, page: 1 }).rows
      if (failure === 'missing-currency') result.rows[0]!.currencyCode = ''
      if (failure === 'mixed-currency') result.rows[0]!.currencyCode = 'USD'
      if (failure === 'ledger-change') result.accountId = 'other'
      if (failure === 'selection-change') result.selection.cashAccountId = '999'
      if (failure === 'early-empty') { result.rows = []; result.summaries = page({ ...selected, page: 3 }).summaries }
    }
    if (failure === 'changing-total' && selected.page === 1) {
      result.summaries = page({ ...selected, page: 3 }).summaries
      result.summaries[0]!.income = '0.20'
    }
    if (selected.page === 3) {
      if (failure === 'missing-total') result.summaries = []
      if (failure === 'null-total') result.summaries[0]!.expense = null
      if (failure === 'wrong-total') result.summaries[0]!.income = '0.31'
      if (failure === 'wrong-total-currency') result.summaries[0]!.currencyCode = 'USD'
      if (failure === 'multiple-total') result.summaries.push({ ...result.summaries[0]! })
    }
    return result
  }, new AbortController().signal, limits)).rejects.toThrow('未通过核验')
})

it('rejects a currency change between nonempty periods', async () => {
  await expect(analyzeJournals(query, async (selected) => {
    const result = page({ ...selected, month: '2026-09', dateStart: '2026-09-01', dateEnd: '2026-09-30' })
    result.selection = { ...result.selection, month: selected.month, dateStart: selected.month + '-01', dateEnd: selected.month === '2026-08' ? '2026-08-31' : '2026-09-30' }
    if (selected.month === '2026-08') for (const row of result.rows) row.currencyCode = 'USD'
    return result
  }, new AbortController().signal, limits)).rejects.toThrow('两个期间')
})

it('enforces row, accumulated-byte and cancellation limits', async () => {
  const read = vi.fn(async (selected: JournalQuery) => page(selected))
  await expect(analyzeJournals(query, read, new AbortController().signal, { ...limits, maxRows: 1 })).rejects.toThrow('上限')
  await expect(analyzeJournals(query, read, new AbortController().signal, { ...limits, maxBytes: 1 })).rejects.toThrow('上限')
  const controller = new AbortController()
  await expect(analyzeJournals(query, async (selected) => {
    controller.abort(); return page(selected)
  }, controller.signal, limits)).rejects.toThrow()
  const notRead = vi.fn(async (selected: JournalQuery) => page(selected))
  await expect(analyzeJournals({ ...query, current: { month: '2026-09', dateStart: '2026-08-01', dateEnd: '2026-09-30' } }, notRead, new AbortController().signal, limits)).rejects.toThrow()
  expect(notRead).not.toHaveBeenCalled()
})

it('exports business totals, exact source values and backend differences without spreadsheet formulas', async () => {
  const result = await analyzeJournals(query, async selected => page(selected), new AbortController().signal, limits)
  const bytes = await journalAnalysisWorkbook(result)
  expect(await readSheet(bytes)).toEqual(await readSheet(bytes, '收支汇总'))
  expect((await readSheet(bytes, '收支汇总'))[1]).toEqual(['当前', '2026-09', '2026-09-01', '2026-09-30', 'RMB', '0.30', '0.00'])
  const sources = await readSheet(bytes, '流水明细')
  expect(sources).toHaveLength(3)
  expect(sources[1]!.slice(0, 3)).toEqual(['当前', '2026-09-07', '=HYPERLINK("https://example.com")'])
  expect(sources[1]!.slice(7, 10)).toEqual(['0.10', '未提供', '未提供'])
  expect((await readSheet(bytes, '期间差额'))[1]).toEqual(['RMB', '0.30', '0.00'])
})

it.each(['ok', 'wrong-account', 'vendor-failure'])('uses only the saved connection and safe diagnostics: %s', async (scenario) => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: account.name }] })
    if (url.pathname.includes('getAccountList')) return Response.json({ result: 100, data: [{ accountId: 174553 }] })
    expect(url.pathname).toBe('/finance/cashjournal/getListPage.rjson')
    if (typeof init.body !== 'string') throw new Error('Expected JSON body')
    const body = JSON.parse(init.body) as { subjectId: number; accountName: string; periodNumber: string; page: number; pageSize: number }
    expect(body.subjectId).toBe(174553)
    expect(body.accountName).toBe(account.name)
    if (scenario === 'vendor-failure') return Response.json({ result: 400, message: 'private fake-secret' })
    const rows = raw({ month: body.periodNumber, page: body.page, pageSize: body.pageSize })
    if (scenario === 'wrong-account') Object.assign(rows[0]!, { id: 123, subjectId: 999, date: '2026-09-07', borrow: '0.10' })
    return Response.json({ result: 100, data: rows })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const pending = adapter.analyzeJournals({ system: 'youcheng', environment: 'test', accountCode: '35601', appKey: 'fake-key' }, 'fake-secret', query, new AbortController().signal, limits)
  if (scenario === 'ok') expect((await pending).current.income).toBe('0.30')
  else await expect(pending).rejects.toThrow(/^有成日记账查询失败/)
})
