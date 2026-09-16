import { afterEach, describe, expect, it, vi } from 'vitest'
import { YouchengConnection } from '../src/youcheng.ts'
import { collectVoucherPages, projectVoucherPage, validateVoucherQuery } from '../src/vouchers.ts'

const urls = { test: 'https://example.test', production: 'https://example.test' }
const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: 'ledger-2' }
const query = { month: '2022-01', page: 1, pageSize: 20 }
const account = { id: 'ledger-2', name: '演示账套' }
const row = { certificateId: 'voucher-1', certificateDate: '2022-01-01', certificateWord: '记', certificateCode: 1,
  entryList: [
    { abstractName: '销售商品', subjectCode: '1122', subjectName: '应收账款', direction: 0, borrorMoneyStr: '30000.00', loanMoneyStr: '', borrorMoney: 30000 },
    { abstractName: '销售商品', subjectCode: '5001', subjectName: '主营业务收入', direction: 1, borrorMoneyStr: '', loanMoneyStr: '30000.00', loanMoney: 30000 },
  ],
}
const data = { success: true, count: 1, list: [row] }
const signal = () => new AbortController().signal
afterEach(() => vi.unstubAllGlobals())

describe('temporary Youcheng voucher query', () => {
  it.each(['transport', 'projection'])('reports the failing stage without raw secrets: %s', async (kind) => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
      if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
      if (kind === 'transport') throw new TypeError('fake-secret fake-key fake-token')
      return Response.json({ result: 100, data: { success: true, count: 3, list: [] } })
    }))
    const request = new YouchengConnection(urls, 1000).queryVouchers(config, 'fake-secret', query, signal(), 65_536)
    await expect(request).rejects.toThrow(kind === 'transport' ? 'network；阶段：凭证列表请求' : 'invalid-response；阶段：凭证响应校验')
    await expect(request).rejects.not.toThrow(/fake-key|fake-secret|fake-token/)
  })

  it('uses the configured ID to resolve a unique name, and sends only the read-only Finance request', async () => {
    const calls: { url: URL; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (typeof init.body !== 'string') throw new Error('Expected JSON body')
      calls.push({ url, body: JSON.parse(init.body) })
      expect(init.redirect).toBe('error')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return Response.json({ result: 100, data: url.pathname.includes('/auth/') ? 'fake-token'
        : url.pathname.includes('queryAccountList') ? [{ id: 'wrong', sobName: '其他账套' }, { id: account.id, sobName: account.name }] : data })
    }))
    const result = await new YouchengConnection(urls, 20_000).queryVouchers(config, 'fake-secret', query, signal(), 65_536)
    expect(calls.map(call => call.url.pathname)).toEqual(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/certificate/list.rjson'])
    expect(calls[1]?.body).toEqual({})
    expect(calls[2]?.body).toEqual({ accountName: '演示账套', page: 1, pageSize: 20, certificateDateMonthStart: '2022-01', certificateDateMonthEnd: '2022-01' })
    expect(result).toMatchObject({ accountId: 'ledger-2', accountName: '演示账套', total: 1, voucherCount: 1, hasMore: false })
    expect(result.rows.map(r => [r.number, r.debit, r.credit])).toEqual([['记-1', '30000.00', '0.00'], ['记-1', '0.00', '30000.00']])
    expect(JSON.stringify(result)).not.toMatch(/fake-key|fake-secret|fake-token|appKey|accessToken/)
  })

  it.each([
    [], [{ id: 'other', sobName: account.name }],
    [{ id: account.id, sobName: account.name }, { id: 'other', sobName: account.name }],
    [{ id: account.id, sobName: account.name }, { id: account.id, sobName: '其他名称' }],
  ].map(ledgers => ({ ledgers })))('rejects unavailable or ambiguous ledgers before querying vouchers', async ({ ledgers }) => {
    const fetcher = vi.fn(async (url: URL) => Response.json({ result: 100, data: url.pathname.includes('/auth/') ? 'fake-token' : ledgers }))
    vi.stubGlobal('fetch', fetcher)
    await expect(new YouchengConnection(urls, 1000).queryVouchers(config, 'fake-secret', query, signal(), 65_536)).rejects.toThrow('account-unavailable')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('sends only the requested period range and summary and preserves every returned entry', async () => {
    const filtered = { ...query, monthEnd: '2022-03', summary: '销售' }
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
      if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
      if (typeof init.body !== 'string') throw new Error('Expected JSON body')
      expect(JSON.parse(init.body)).toEqual({ accountName: account.name, page: 1, pageSize: 20,
        certificateDateMonthStart: '2022-01', certificateDateMonthEnd: '2022-03', abstractName: '销售' })
      return Response.json({ result: 100, data: { ...data, list: [{ ...row,
        entryList: [row.entryList[0], { ...row.entryList[1], abstractName: '结转' }],
      }] } })
    }))
    const result = await new YouchengConnection(urls, 1000).queryVouchers(config, 'fake-secret', filtered, signal(), 65_536)
    expect(result).toMatchObject({ month: '2022-01', monthEnd: '2022-03', summary: '销售', voucherCount: 1 })
    expect(result.rows.map(line => line.summary)).toEqual(['销售商品', '结转'])
    expect(result.notice).toContain('精确或模糊匹配语义未核验')
  })

  it.each([
    { ...query, monthEnd: '2021-12' }, { ...query, monthEnd: '2022-13' },
    { page: 1, pageSize: 20, monthEnd: '2022-03' }, { ...query, summary: '  ' },
  ])('rejects invalid ranges or blank summaries before authentication: %j', async (invalid) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(new YouchengConnection(urls, 1000).queryVouchers(config, 'fake-secret', invalid, signal(), 65_536)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects invalid queries and absent credentials before any network request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    for (const invalid of [{ ...query, month: '2022-13' }, { ...query, page: 0 }, { ...query, pageSize: 101 }, { ...query, page: 1.5 }, { ...query, accountName: '其他账套' }]) {
      expect(() => { validateVoucherQuery(invalid) }).toThrow()
    }
    await expect(new YouchengConnection(urls, 1000).queryVouchers(config, undefined, query, signal(), 65_536)).rejects.toThrow('AppSecret')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('distinguishes an empty month from failed, inconsistent, and oversized results', () => {
    expect(projectVoucherPage({ success: true, count: 0, list: [] }, query, account, 1024))
      .toMatchObject({ total: 0, rows: [], hasMore: false })
    for (const invalid of [
      { success: false, list: [], count: 0 }, { success: true, count: 1, list: [] }, { ...data, count: 21 },
      { ...data, list: [{ ...row, entryList: [{ ...row.entryList[0], borrorMoney: undefined, borrorMoneyStr: '' }] }] },
      { ...data, list: [{ ...row, entryList: [{ ...row.entryList[0], borrorMoneyStr: 'not-money' }] }] },
    ]) expect(() => projectVoucherPage(invalid, query, account, 65_536)).toThrow()
    const result = projectVoucherPage(data, query, account, 65_536)
    const size = Buffer.byteLength(JSON.stringify(result))
    expect(projectVoucherPage(data, query, account, size)).toEqual(result)
    expect(() => projectVoucherPage(data, query, account, size - 1)).toThrow('过大')
  })

  it('does not infer accounting periods from voucher dates', () => {
    const result = projectVoucherPage({ ...data, list: [{ ...row, certificateDate: '2022-02-01' }] }, query, account, 65_536)
    expect(result.rows[0]?.date).toBe('2022-02-01')
    expect(result.month).toBe('2022-01')
    expect(result.notice).toContain('期间筛选未逐笔复核')
  })

  it('distinguishes a full page, the final page, and a page beyond the reported total', () => {
    expect(projectVoucherPage({ ...data, count: 2 }, { ...query, pageSize: 1 }, account, 65_536)).toMatchObject({ hasMore: true })
    expect(projectVoucherPage({ ...data, count: 2 }, { ...query, page: 2, pageSize: 1 }, account, 65_536)).toMatchObject({ hasMore: false })
    expect(projectVoucherPage({ ...data, count: 2, list: [] }, { ...query, page: 3, pageSize: 1 }, account, 65_536))
      .toMatchObject({ total: 2, voucherCount: 0 })
    expect(() => projectVoucherPage({ ...data, count: 2, list: [row, row] }, query, account, 65_536)).toThrow('分页')
  })

  it('does not describe a vendor zero-count out-of-range page as an empty ledger', () => {
    const result = projectVoucherPage({ success: true, count: 0, list: [] },
      { ...query, page: 3, pageSize: 2 }, account, 65_536)
    expect(result).toMatchObject({ total: 0, voucherCount: 0, hasMore: false })
    expect(result.notice).toContain('这不能证明筛选总数为零')
    expect(result.notice).toContain('重查第一页')
    const bytes = Buffer.byteLength(JSON.stringify(result))
    expect(() => projectVoucherPage({ success: true, count: 0, list: [] },
      { ...query, page: 3, pageSize: 2 }, account, bytes - 1)).toThrow('过大')
  })

  it.each([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])('rejects unsafe numeric money but preserves decimal strings: %s', (value) => {
    const list = [{ ...row, entryList: [{ ...row.entryList[0], borrorMoneyStr: '', borrorMoney: value }] }]
    expect(() => projectVoucherPage({ ...data, list }, query, account, 65_536)).toThrow('精度')
    list[0]!.entryList[0]!.borrorMoneyStr = `${value}.00`
    expect(projectVoucherPage({ ...data, list }, query, account, 65_536).rows[0]?.debit).toBe(`${value}.00`)
  })

  it('bounds raw responses even when the oversized fields would be dropped from projection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => Response.json({ result: 100, data: url.pathname.includes('/auth/') ? 'fake-token'
      : url.pathname.includes('queryAccountList') ? [{ id: account.id, sobName: account.name }]
        : { ...data, ignored: 'x'.repeat(4096) } })))
    await expect(new YouchengConnection(urls, 1000).queryVouchers(config, 'fake-secret', query, signal(), 2048)).rejects.toThrow('invalid-response')
  })

  it('sanitizes vendor failures and aborts in-flight requests', async () => {
    const adapter = new YouchengConnection(urls, 1000)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: 500, message: 'fake-secret fake-token' })))
    await expect(adapter.queryVouchers(config, 'fake-secret', query, signal(), 1024)).rejects.toThrow('authentication')
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>{  reject(new Error('fake-secret')) }, { once: true })
      controller.abort()
    })))
    await expect(adapter.queryVouchers(config, 'fake-secret', query, controller.signal, 1024)).rejects.toThrow('已取消')
  })

  it('exports every voucher page from page one and reconciles the vendor total', async () => {
    const pages: number[] = []
    const report = await collectVoucherPages({ ...query, page: 9 }, (selected) => {
      pages.push(selected.page)
      const item = { ...row, certificateId: `voucher-${selected.page}`, certificateCode: selected.page }
      return Promise.resolve(projectVoucherPage({ success: true, count: 2, list: [item] }, selected, account, 65_536))
    }, signal(), { pageSize: 1, maxBytes: 65_536 })
    expect(pages).toEqual([1, 2])
    expect(report).toMatchObject({ page: 1, pageSize: 1, total: 2, voucherCount: 2, hasMore: false, pagesRead: 2 })
    expect(report.rows.map(item => item.voucherId)).toEqual(['voucher-1', 'voucher-1', 'voucher-2', 'voucher-2'])
    expect(report.notice).toContain('全部凭证分录')
  })

  it('refuses an incomplete or changing voucher export', async () => {
    await expect(collectVoucherPages(query, selected => Promise.resolve(projectVoucherPage(
      { success: true, count: selected.page === 1 ? 2 : 3,
        list: [{ ...row, certificateId: `voucher-${selected.page}` }] }, selected, account, 65_536)),
    signal(), { pageSize: 1, maxBytes: 65_536 })).rejects.toThrow('总张数')
    await expect(collectVoucherPages(query, selected => Promise.resolve(projectVoucherPage(
      { success: true, count: 2, list: [row] }, selected, account, 65_536)),
    signal(), { pageSize: 1, maxBytes: 65_536 })).rejects.toThrow('重复凭证')
  })
})
