import { afterEach, expect, it, vi } from 'vitest'
import { collectOpenItemPages, openItemQuerySchema, projectOpenItems } from '../src/open-items.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const query = { direction: 'receivable' as const, periodStart: '2026-09', periodEnd: '2026-09', page: 1, pageSize: 20 }
const account = { id: '35601', name: '测试账套' }
const marker = { id: -1788766706333, date: '', abstractStr: '合计', subjectCode: '', subjectName: '',
  auxiliaryItemIds: '', auxiliaryItemName: '', currencyCode: '', baseCurrencyCode: '', money: 0, balance: 0,
  baseMoney: 0, baseBalance: 0, categoryName: '', remark: '' }
const entry = { ...marker, id: 123, setOfBooksId: 35601, date: '2026-09-07', abstractStr: '往来测试',
  subjectCode: '1122', subjectName: '应收账款', auxiliaryItemIds: '456', auxiliaryItemName: '测试客户',
  currencyCode: 'CNY', baseCurrencyCode: 'CNY', money: '300.00', balance: '200.00', thisMoney: '100.00', isFinish: false }
const project = (data: unknown) => projectOpenItems(data, query, account, 100, 65536)
afterEach(() => vi.unstubAllGlobals())

it('separates live negative-ID totals from empty business pages', () => {
  const result = project({ count: 0, list: [marker], pageUpRecord: { ...marker, abstractStr: '上一页的总计' } })
  expect(result.rows).toEqual([])
  expect(result.totalCount).toBe(0)
  expect(result.summaries.map(row => row.kind)).toEqual(['total', 'previous-page'])
  expect(result.summaries[0]?.settledAmount).toBeNull()
  expect(result.coverage).toBe('unverified')
})

it('preserves zero-valued business records and does not infer counterparty identity from names', () => {
  const result = project({ count: 1, list: [{ ...entry, abstractStr: '合计', money: 0, balance: 0 }] })
  expect(result.summaries).toEqual([])
  expect(result.rows[0]).toMatchObject({ id: '123', amount: '0.00', balance: '0.00',
    auxiliaryItemIds: '456', auxiliaryItemName: '测试客户', finished: false, initialBalance: null })
})

it('retains independently supplied amounts rather than deriving settlement from subtraction', () => {
  const result = project({ count: 1, list: [{ ...entry, money: '9007199254740993.01', thisMoney: undefined }] })
  expect(result.rows[0]).toMatchObject({ amount: '9007199254740993.01', balance: '200.00', settledAmount: null })
  expect(() => project({ count: 1, list: [{ ...entry, money: Number.MAX_SAFE_INTEGER }] })).toThrow()
})

it.each([
  { count: 1, list: [{ ...entry, setOfBooksId: 999 }] },
  { count: 1, list: [{ ...entry, setOfBooksId: undefined }] },
  { count: 1, list: [{ ...entry, date: '' }] },
  { count: 0, list: [{ ...marker, abstractStr: '未知总计' }] },
  { count: 2, list: [entry, entry] },
  { count: 0, list: [entry] },
  { count: 1, list: [entry], pageUpRecord: entry },
])('rejects inconsistent ledger, row identity, and pagination: %#', (data) => {
  expect(() => project(data)).toThrow()
})

it('bounds the entire emitted result including previous-page summaries', () => {
  const data = { count: 0, list: [marker], pageUpRecord: { ...marker, abstractStr: '上一页的总计' } }
  const result = project(data)
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8')
  expect(projectOpenItems(data, query, account, 2, bytes)).toEqual(result)
  expect(() => projectOpenItems(data, query, account, 1, bytes)).toThrow()
  expect(() => projectOpenItems(data, query, account, 2, bytes - 1)).toThrow()
})

it('rejects reversed periods and model-supplied ledger overrides', () => {
  expect(openItemQuerySchema.safeParse({ ...query, periodEnd: '2026-08' }).success).toBe(false)
  expect(openItemQuerySchema.safeParse({ ...query, setOfBooksId: '999' }).success).toBe(false)
})

const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35601' }
const adapter = () => new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)

it.each(['receivable', 'payable'] as const)('sends the bound ledger and exact %s direction', async (direction) => {
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    paths.push(url.pathname)
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '测试账套' }] })
    if (typeof init.body !== 'string') throw new Error('Expected JSON body')
    expect(JSON.parse(init.body)).toEqual({ setOfBooksId: 35601, direction: direction === 'receivable' ? 0 : 1,
      periodNumberStart: '2026-09', periodNumberEnd: '2026-09', page: 1, pageSize: 20 })
    return Response.json({ result: 100, data: { count: 1, list: [entry] } })
  }))
  const result = await adapter().queryOpenItems(config, 'fake-secret', { ...query, direction }, new AbortController().signal, 100, 65536)
  expect(result.selection.direction).toBe(direction)
  expect(result.rows[0]?.balance).toBe('200.00')
  expect(paths).toEqual(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/cashjournal/getCashierList'])
})

it.each(['network', 'secret', 'vendor-error'])('reports %s as failure without leaking credentials', async (failure) => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '测试账套' }] })
    if (failure === 'network') throw new TypeError('private-network fake-secret')
    if (failure === 'vendor-error') return Response.json({ result: 400, message: 'private-error' })
    return Response.json({ result: 100, data: { count: 1, list: [{ ...entry, remark: 'fake-secret' }] } })
  }))
  let message = ''
  try { await adapter().queryOpenItems(config, 'fake-secret', query, new AbortController().signal, 100, 65536) }
  catch (error) { message = String(error) }
  expect(message).toContain('查询失败')
  expect(message).not.toMatch(/fake-secret|private-/)
})

it('exports every open-item page from page one and reconciles the vendor count', async () => {
  const pages: number[] = []
  const report = await collectOpenItemPages({ ...query, page: 8 }, (selected) => {
    pages.push(selected.page)
    return Promise.resolve(projectOpenItems({ count: 2,
      list: [{ ...entry, id: selected.page }], ...selected.page === 2 ? { pageUpRecord: {
        ...marker, abstractStr: '上一页的总计' } } : {} }, selected, account, 100, 65_536))
  }, new AbortController().signal, { pageSize: 1, maxRows: 10, maxBytes: 65_536 })
  expect(pages).toEqual([1, 2])
  expect(report).toMatchObject({ totalCount: 2, pagesRead: 2, coverage: 'vendor-count-reconciled' })
  expect(report.rows.map(item => item.id)).toEqual(['1', '2'])
  expect(report.notice).toContain('全部应收或应付记录')
})

it('refuses changing totals, short pages, and duplicate open items', async () => {
  await expect(collectOpenItemPages(query, selected => Promise.resolve(projectOpenItems({
    count: selected.page === 1 ? 2 : 3, list: [{ ...entry, id: selected.page }],
  }, selected, account, 100, 65_536)), new AbortController().signal,
  { pageSize: 1, maxRows: 10, maxBytes: 65_536 })).rejects.toThrow('总数变化')
  await expect(collectOpenItemPages(query, selected => Promise.resolve(projectOpenItems({
    count: 2, list: selected.page === 1 ? [{ ...entry, id: 1 }] : [],
  }, selected, account, 100, 65_536)), new AbortController().signal,
  { pageSize: 1, maxRows: 10, maxBytes: 65_536 })).rejects.toThrow('分页记录数')
  await expect(collectOpenItemPages(query, selected => Promise.resolve(projectOpenItems({
    count: 2, list: [{ ...entry, id: 1 }],
  }, selected, account, 100, 65_536)), new AbortController().signal,
  { pageSize: 1, maxRows: 10, maxBytes: 65_536 })).rejects.toThrow('重复记录')
})
