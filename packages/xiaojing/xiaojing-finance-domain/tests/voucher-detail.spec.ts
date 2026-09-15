import { afterEach, expect, it, vi } from 'vitest'
import { projectVoucherDetail, validateVoucherId } from '../src/vouchers.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const account = { id: '35601', name: '测试账套' }
const detail = {
  accountId: account.id, certificateId: '270825', certificateWord: '记', certificateCode: 2,
  certificateDate: '2026-09-07', periods: '2026-09', auditingStatus: false, settleStatus: false,
  documentMaker: '测试', certificateLists: [
    { abstractName: '银行提现', subjectCode: '1001', subjectName: '库存现金', direction: 0, borrorMoney: 25.5, borrorMoneyStr: '25.50', loanMoneyStr: '' },
    { abstractName: '银行提现', subjectCode: '1002', subjectName: '银行存款', direction: 1, loanMoney: 25.5, loanMoneyStr: '25.50', borrorMoneyStr: '' },
  ],
}
const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: account.id }
const adapter = () => new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
afterEach(() => vi.unstubAllGlobals())

it('projects real detail field names, decimal amounts, period and statuses without unverified extras', () => {
  const result = projectVoucherDetail({ ...detail, attachmentList: [{ secretUrl: 'not-for-model' }] }, '270825', account, 65_536)
  expect(result).toMatchObject({ voucherId: '270825', period: '2026-09', audited: false, settled: false })
  expect(result.rows.map(r => [r.debit, r.credit])).toEqual([['25.50', '0.00'], ['0.00', '25.50']])
  expect(JSON.stringify(result)).not.toContain('not-for-model')
  const bytes = Buffer.byteLength(JSON.stringify(result))
  expect(projectVoucherDetail(detail, '270825', account, bytes)).toEqual(result)
  expect(() => projectVoucherDetail(detail, '270825', account, bytes - 1)).toThrow('过大')
})

it.each([
  { ...detail, accountId: 'other' }, { ...detail, certificateId: 'other' },
  { ...detail, certificateLists: [] }, { ...detail, periods: '2026-13' },
  { ...detail, auditingStatus: 'false' },
  { ...detail, certificateLists: [{ ...detail.certificateLists[0], borrorMoney: undefined, borrorMoneyStr: '' }] },
])('rejects mismatched or incomplete detail %#', (invalid) => {
  expect(() => projectVoucherDetail(invalid, '270825', account, 65_536)).toThrow()
})

it.each(['', ' ', ' 270825', 'x'.repeat(201)])('rejects invalid identifiers before authentication: %s', async (voucherId) => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  expect(() => { validateVoucherId(voucherId) }).toThrow()
  await expect(adapter().queryVoucherDetail(config, 'fake-secret', voucherId, new AbortController().signal, 65_536)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

it('authenticates, resolves the saved ledger and calls only the detail read endpoint', async () => {
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    paths.push(url.pathname)
    expect(init.redirect).toBe('error')
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
    if (typeof init.body !== 'string') throw new Error('Expected JSON body')
    expect(JSON.parse(init.body)).toEqual({ accountName: account.name, certificateId: '270825' })
    return Response.json({ result: 100, data: detail })
  }))
  const result = await adapter().queryVoucherDetail(config, 'fake-secret', '270825', new AbortController().signal, 65_536)
  expect(paths).toEqual(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/certificate/info.rjson'])
  expect(result.voucherId).toBe('270825')
})

it('rejects cross-ledger details without leaking provider data', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => Response.json({ result: 100,
    data: url.pathname.includes('/auth/') ? 'fake-token' : url.pathname.includes('queryAccountList')
      ? [{ id: account.id, sobName: account.name }] : { ...detail, accountId: 'other', documentMaker: 'private-value' },
  })))
  await expect(adapter().queryVoucherDetail(config, 'fake-secret', '270825', new AbortController().signal, 65_536))
    .rejects.toThrow('invalid-response')
})
