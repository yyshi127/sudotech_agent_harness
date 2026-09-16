import { afterEach, expect, it, vi } from 'vitest'
import { collectJournalPages, projectJournals, resolveJournalQuery } from '../src/journals.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const query = { month: '2026-09', page: 1, pageSize: 20 }
const account = { id: '35601', name: '测试账套' }
const marker = { date: '', abstractStr: '初始余额', accountCode: '', accountName: '', currencyCode: '', baseCurrencyCode: '',
  balance: 0, baseBalance: 0, categoryName: '', keeperName: '' }
const entry = { ...marker, id: 123, date: '2026-09-07', abstractStr: '收入测试', accountCode: '1001', accountName: '库存现金',
  currencyCode: 'CNY', baseCurrencyCode: 'CNY', borrow: '120.00', loan: 0, balance: 120 }
const project = (list: unknown[]) => projectJournals(list, query, account, 100, 65536)
const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35601' }
const adapter = () => new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)

it('uses returned subject labels when account labels are blank and checks the selected account', () => {
  const raw = { ...entry, accountCode: '', accountName: '', subjectId: 174553, subjectName: '库存现金', subjectCode: '' }
  expect(projectJournals([raw], { ...query, cashAccountId: '174553' }, account, 100, 65536).rows[0])
    .toMatchObject({ accountName: '库存现金', accountCode: '' })
  for (const subjectId of [174554, undefined]) {
    expect(() => projectJournals([{ ...raw, subjectId }], { ...query, cashAccountId: '174553' }, account, 100, 65536))
      .toThrow('账户')
  }
})
afterEach(() => vi.unstubAllGlobals())

it('resolves real calendar boundaries and rejects contradictory selection', () => {
  expect(resolveJournalQuery({ ...query, month: '2024-02' }).dateEnd).toBe('2024-02-29')
  expect(resolveJournalQuery({ ...query, month: '2100-02' }).dateEnd).toBe('2100-02-28')
  expect(() => resolveJournalQuery({ ...query, dateStart: '2026-09-01' })).toThrow()
  expect(() => resolveJournalQuery({ ...query, dateStart: '2026-08-31', dateEnd: '2026-09-07' })).toThrow()
})

it('does not count the live empty-account markers as business transactions', () => {
  const result = project([marker, { ...marker, abstractStr: '合计' }])
  expect(result.rows).toEqual([])
  expect(result.summaries.map(row => row.kind)).toEqual(['opening', 'total'])
  expect(result.summaries[0]?.income).toBeNull()
  expect(result.summaries[0]?.balance).toBe('0.00')
  expect(result.coverage).toBe('unverified')
})

it('preserves nonzero markers without claiming complete daily activity or a currency', () => {
  const result = projectJournals([ { ...marker, balance: 100 }, { ...marker, abstractStr: '合计', balance: 100 } ],
    { ...query, dateStart: '2026-09-08', dateEnd: '2026-09-08' }, account, 100, 65536)
  expect(result.rows).toEqual([])
  expect(result.summaries.map(row => [row.balance, row.income, row.expense, row.currencyCode]))
    .toEqual([['100.00', null, null, ''], ['100.00', null, null, '']])
  expect(result.notice).toContain('本次查询页未返回业务流水')
  expect(result.notice).toContain('币种未提供')
  expect(result.notice).toContain('不证明日初日末余额已核验')
  expect(result.notice).toContain('不是收支核对或跨期比较结果')
  expect(result.notice).toContain('analyze:true')
  expect(result.notice).toContain('baselineMonth')
})

it('preserves income, expense and currency without mistaking a business summary for a total', () => {
  const result = project([{ ...entry, abstractStr: '合计' }])
  expect(result.summaries).toEqual([])
  expect(result.rows[0]).toMatchObject({ id: '123', income: '120.00', expense: '0.00', currencyCode: 'CNY' })
})

it('rejects duplicate IDs, invalid dates and unrecognized markers', () => {
  expect(() => project([entry, entry])).toThrow()
  expect(() => project([{ ...entry, date: '2026-08-01' }])).toThrow()
  expect(() => project([{ ...marker, abstractStr: '未知' }])).toThrow()
  expect(() => project([{ ...entry, borrow: undefined, loan: undefined }])).toThrow()
})

it('rejects unsafe numeric money while preserving decimal strings and enforces full result bounds', () => {
  expect(() => project([{ ...entry, borrow: Number.MAX_SAFE_INTEGER }])).toThrow()
  expect(project([{ ...entry, borrow: '9007199254740993.01' }]).rows[0]?.income).toBe('9007199254740993.01')
  expect(() => projectJournals([entry], query, account, 0, 65536)).toThrow()
  const value = project([entry])
  const size = Buffer.byteLength(JSON.stringify(value), 'utf8')
  expect(projectJournals([entry], query, account, 100, size)).toEqual(value)
  expect(() => projectJournals([entry], query, account, 100, size - 1)).toThrow()
})

it('validates a cash account against the saved ledger and sends concrete dates', async () => {
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    paths.push(url.pathname)
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '测试账套' }] })
    if (typeof init.body !== 'string') throw new Error('Expected JSON body')
    if (url.pathname.includes('getAccountList')) {
      expect(JSON.parse(init.body)).toEqual({ setOfBooksId: '35601', sobName: '测试账套' })
      return Response.json({ result: 100, data: [{ accountId: 174553 }] })
    }
    expect(JSON.parse(init.body)).toEqual({ accountName: '测试账套', periodNumber: '2026-09', dateStart: '2026-09-01', dateEnd: '2026-09-30',
      page: 1, pageSize: 20, subjectId: 174553 })
    return Response.json({ result: 100, data: [marker] })
  }))
  const result = await adapter().queryJournals(config, 'fake-secret', { ...query, cashAccountId: '174553' }, new AbortController().signal, 100, 65536)
  expect(result.rows).toEqual([])
  expect(paths).toEqual(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/cashjournal/getAccountList.rjson', '/finance/cashjournal/getListPage.rjson'])
})

it.each(['unknown-account', 'network', 'secret', 'vendor-error'])('rejects %s instead of returning an empty journal', async (failure) => {
  let journalRequests = 0
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '测试账套' }] })
    if (url.pathname.includes('getAccountList')) return Response.json({ result: 100, data: [] })
    journalRequests += 1
    if (failure === 'network') throw new TypeError('private-network fake-secret')
    if (failure === 'vendor-error') return Response.json({ result: 400, message: 'private-error' })
    return Response.json({ result: 100, data: [{ ...marker, keeperName: 'fake-secret' }] })
  }))
  let errorText = ''
  try {
    await adapter().queryJournals(config, 'fake-secret', { ...query, ...failure === 'unknown-account' ? { cashAccountId: '174553' } : {} }, new AbortController().signal, 100, 65536)
  } catch (error) { errorText = String(error) }
  expect(errorText).toContain('查询失败')
  expect(errorText).not.toMatch(/fake-secret|private-/)
  expect(journalRequests).toBe(failure === 'unknown-account' ? 0 : 1)
})

it('exports journal rows from page one through the first empty business page', async () => {
  const pages: number[] = []
  const report = await collectJournalPages({ ...query, page: 7 }, (selected) => {
    pages.push(selected.page)
    const list = selected.page > 2 ? [marker, { ...marker, abstractStr: '合计' }]
      : [{ ...entry, id: selected.page }]
    return Promise.resolve(projectJournals(list, selected, account, 100, 65_536))
  }, new AbortController().signal, { pageSize: 1, maxRows: 10, maxBytes: 65_536 })
  expect(pages).toEqual([1, 2, 3])
  expect(report).toMatchObject({ pagesRead: 3, coverage: 'unverified' })
  expect(report.rows.map(item => item.id)).toEqual(['1', '2'])
  expect(report.summaries.map(item => item.kind)).toEqual(['opening', 'total'])
  expect(report.notice).toContain('首个空业务页')
})

it('refuses duplicate or oversized journal pagination', async () => {
  await expect(collectJournalPages(query, selected => Promise.resolve(projectJournals(
    [{ ...entry, id: 1 }], selected, account, 100, 65_536)), new AbortController().signal,
  { pageSize: 1, maxRows: 10, maxBytes: 65_536 })).rejects.toThrow('重复流水')
  await expect(collectJournalPages(query, selected => Promise.resolve(projectJournals(
    [{ ...entry, id: selected.page }], selected, account, 100, 65_536)), new AbortController().signal,
  { pageSize: 1, maxRows: 1, maxBytes: 65_536 })).rejects.toThrow('超过上限')
})
