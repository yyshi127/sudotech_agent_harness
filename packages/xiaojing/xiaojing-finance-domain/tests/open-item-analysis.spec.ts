import { afterEach, expect, it, vi } from 'vitest'
import { analyzeOpenItems, type OpenItemAnalysisQuery } from '../src/open-item-analysis.ts'
import { projectOpenItems, type OpenItemQuery } from '../src/open-items.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const query: OpenItemAnalysisQuery = { direction: 'receivable', groupBy: 'currency',
  current: { periodStart: '2026-09', periodEnd: '2026-09' } }
const account = { id: '35601', name: '测试账套' }
const raw = (id: number, amount: string, currency = 'CNY') => ({ id, setOfBooksId: 35601, date: '2026-09-07',
  abstractStr: '测试', subjectCode: '1122', subjectName: '应收账款', auxiliaryItemIds: '42,43', auxiliaryItemName: '组合项目',
  currencyCode: currency, baseCurrencyCode: 'CNY', money: amount, balance: amount, categoryName: '', remark: '' })
const limits = { pageSize: 1, maxRows: 100, maxBytes: 65536 }
const signal = () => new AbortController().signal
const page = (selected: OpenItemQuery, rows: unknown[], total: number) =>
  projectOpenItems({ count: total, list: rows }, selected, account, 100, 65536)
afterEach(() => vi.unstubAllGlobals())

it.each(['missing-id', 'vendor-error'] as const)('reports safe grouping diagnostics for %s', async (scenario) => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '测试账套' }] })
    if (scenario === 'vendor-error') return Response.json({ result: 201, message: 'fake-secret 分组标识', data: null })
    return Response.json({ result: 100, data: { count: 1, list: [{ ...raw(1, '300.00'), subjectCode: '' }] } })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const request = adapter.analyzeOpenItems({ system: 'youcheng', environment: 'test', appKey: 'fake-key', accountCode: '35601' },
    'fake-secret', { ...query, groupBy: 'subject' }, signal(), limits)
  if (scenario === 'missing-id') await expect(request).rejects.toThrow('可改为按币种汇总')
  else await expect(request).rejects.not.toThrow(/fake-secret|分组标识/)
})

it('reads each page before exact currency-separated sums and omits vendor totals', async () => {
  const rows = [raw(1, '0.10'), raw(2, '0.20'), raw(3, '3.00', 'USD')]
  const read = vi.fn(async (selected: OpenItemQuery) => page(selected, [rows[selected.page - 1]], 3))
  const result = await analyzeOpenItems(query, read, signal(), limits)
  expect(read.mock.calls.map(([selected]) => selected.page)).toEqual([1, 2, 3])
  expect(result.current.groups).toEqual([
    { currencyCode: 'CNY', dimensionId: '', dimensionName: '', recordIds: ['1', '2'], amount: '0.30', balance: '0.30' },
    { currencyCode: 'USD', dimensionId: '', dimensionName: '', recordIds: ['3'], amount: '3.00', balance: '3.00' },
  ])
  expect(result.coverage).toBe('vendor-count-reconciled')
  expect(result.notice).toContain('小兢会计根据有成接口返回的业务行在本地计算分组与差额')
  expect(result.notice).not.toContain('待验收')
})

it('compares matching currencies and uses zero only for groups absent from a reconciled set', async () => {
  const result = await analyzeOpenItems({ ...query, baseline: { periodStart: '2026-08', periodEnd: '2026-08' } },
    async selected => page(selected, selected.periodStart === '2026-08' ? [raw(1, '1.00', 'USD')] : [raw(2, '-0.20')], 1), signal(), limits)
  expect(result.differences).toEqual([
    { currencyCode: 'CNY', dimensionId: '', presence: 'current-only', amount: '-0.20', balance: '-0.20' },
    { currencyCode: 'USD', dimensionId: '', presence: 'baseline-only', amount: '-1.00', balance: '-1.00' },
  ])
  expect(result.notice).toContain('完整读取的某组缺席按零组总额参与比较')
  expect(result.notice).not.toContain('单笔金额补零')
})

it.each(['subject', 'auxiliary'] as const)('groups by explicit %s identity, not a name guess', async (groupBy) => {
  const result = await analyzeOpenItems({ ...query, groupBy }, async selected => page(selected, [raw(1, '9007199254740993.01')], 1), signal(), limits)
  expect(result.current.groups[0]).toMatchObject({ dimensionId: groupBy === 'subject' ? '1122' : '42,43', amount: '9007199254740993.01' })
})

it.each(['subject', 'auxiliary'] as const)('rejects missing %s identities instead of grouping by labels', async (groupBy) => {
  for (const missing of ['', '   ']) {
    const read = async (selected: OpenItemQuery) => page(selected, [{ ...raw(1, '300.00'),
      ...groupBy === 'subject' ? { subjectCode: missing } : { auxiliaryItemIds: missing },
    }], 1)
    await expect(analyzeOpenItems({ ...query, groupBy }, read, signal(), limits)).rejects.toThrow('分组标识')
    const byCurrency = await analyzeOpenItems(query, read, signal(), limits)
    expect(byCurrency.current.groups[0]?.amount).toBe('300.00')
  }
})

it.each(['duplicate', 'count-change', 'short-page', 'ledger-change', 'selection-change'])('rejects %s without partial totals', async (failure) => {
  const read = vi.fn(async (selected: OpenItemQuery) => {
    const result = page(selected, [raw(selected.page, '1.00')], 2)
    if (selected.page === 2) {
      if (failure === 'duplicate') result.rows = page(selected, [raw(1, '1.00')], 2).rows
      if (failure === 'count-change') result.totalCount = 3
      if (failure === 'short-page') result.rows = []
      if (failure === 'ledger-change') result.accountId = '999'
      if (failure === 'selection-change') result.selection.direction = 'payable'
    }
    return result
  })
  await expect(analyzeOpenItems(query, read, signal(), limits)).rejects.toThrow()
  expect(read).toHaveBeenCalledTimes(2)
})

it('rejects total and cumulative-byte limits before returning a report', async () => {
  const read = vi.fn(async (selected: OpenItemQuery) => page(selected, [raw(selected.page, '1.00')], 2))
  await expect(analyzeOpenItems(query, read, signal(), { ...limits, maxRows: 1 })).rejects.toThrow('上限')
  expect(read).toHaveBeenCalledTimes(1)
  const first = await read({ ...query.current, direction: query.direction, page: 1, pageSize: 1 })
  await expect(analyzeOpenItems(query, read, signal(), { ...limits, maxBytes: Buffer.byteLength(JSON.stringify(first)) + 1 })).rejects.toThrow('上限')
})

it('cancels collection before issuing another page', async () => {
  const controller = new AbortController()
  const read = vi.fn(async (selected: OpenItemQuery) => { controller.abort(); return page(selected, [raw(1, '1.00')], 2) })
  await expect(analyzeOpenItems(query, read, controller.signal, limits)).rejects.toThrow()
  expect(read).toHaveBeenCalledTimes(1)
})

it('authenticates once for all pages and keeps both periods on one saved ledger', async () => {
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    paths.push(url.pathname)
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '测试账套' }] })
    if (typeof init.body !== 'string') throw new Error('Expected body')
    const body = JSON.parse(init.body) as { page: number; setOfBooksId: number; direction: number }
    expect(body.setOfBooksId).toBe(35601)
    expect(body.direction).toBe(0)
    return Response.json({ result: 100, data: { count: 2, list: [raw(body.page, '1.00')] } })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const result = await adapter.analyzeOpenItems({ system: 'youcheng', environment: 'test', appKey: 'fake-key', accountCode: '35601' },
    'fake-secret', { ...query, baseline: { periodStart: '2026-08', periodEnd: '2026-08' } }, signal(), limits)
  expect(result.differences?.[0]?.amount).toBe('0.00')
  expect(paths.filter(path => path.includes('/auth/'))).toHaveLength(1)
  expect(paths.filter(path => path.includes('queryAccountList'))).toHaveLength(1)
  expect(paths.filter(path => path.includes('getCashierList'))).toHaveLength(4)
})
