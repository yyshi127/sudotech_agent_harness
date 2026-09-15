import { afterEach, expect, it, vi } from 'vitest'
import { inspectVoucherDeletion, prepareVoucherDeletion, classifyVoucherDeletion, observeVoucherAbsence } from '../src/voucher-deletion.ts'
import type { VoucherPage, VoucherQuery } from '../src/vouchers.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const account = { id: '35616', name: '测试账套' }
const maxBytes = 65536
const raw = {
  accountId: account.id, certificateId: '123', certificateWord: '记', certificateCode: 1,
  certificateDate: '2022-01-01', periods: '2022-01', auditingStatus: false, settleStatus: false,
  documentMaker: '测试员', modified: '2026-09-10 12:00:00', channel: 'EXTERNAL_ACCESS', sysCreate: false,
  relationCode: '', adjustPeriodsStatus: 0, attachmentStatus: false, attachmentList: [],
  corpBalanceSheetCertificateList: [], subjectCertificateWrites: [],
  certificateLists: [
    { abstractName: '删除专用测试', subjectCode: '1001', subjectName: '现金', direction: 0,
      borrorMoneyStr: '0.01', loanMoneyStr: '0.00', auxiliaryList: [], currencyCode: '' },
    { abstractName: '删除专用测试', subjectCode: '1002', subjectName: '银行', direction: 1,
      borrorMoneyStr: '0.00', loanMoneyStr: '0.01', auxiliaryList: [], currencyCode: '' },
  ],
}
const inspect = (data: unknown, bytes = maxBytes) => inspectVoucherDeletion(data, '123', account, bytes)
afterEach(() => vi.unstubAllGlobals())

it.each(['absent', 'present', 'partial', 'changed', 'wrong-ledger', 'filtered', 'count-mismatch', 'error'])(
  'independent deletion inventory treats %s honestly', async (mode) => {
    let calls = 0
    const read = vi.fn(async (query): Promise<VoucherPage> => {
      calls++
      expect(query).toEqual({ page: 1, pageSize: 100 })
      if (mode === 'error') throw new Error('permission denied')
      const id = mode === 'present' ? '123' : mode === 'changed' && calls > 1 ? 'other' : 'retained'
      return { accountId: mode === 'wrong-ledger' ? 'other' : account.id, accountName: account.name,
        month: '不限月份', ...mode === 'filtered' ? { summary: 'filter' } : {}, page: 1, pageSize: 100,
        total: mode === 'partial' || mode === 'count-mismatch' ? 2 : 1, voucherCount: 1, hasMore: mode === 'partial', notice: '',
        rows: [{ voucherId: id, date: '2022-01-01', number: '记-1', summary: '', subjectCode: '1001',
          subjectName: '现金', debit: '0.01', credit: '0.00' }] }
    })
    const observed = observeVoucherAbsence({ accountId: account.id, accountName: account.name, voucherId: '123' }, read, 1)
    if (mode === 'absent' || mode === 'present') {
      expect(await observed).toEqual({ state: mode, voucherCount: 1 })
      expect(read).toHaveBeenCalledTimes(mode === 'absent' ? 2 : 1)
    } else await expect(observed).rejects.toThrow()
  })

it('retains exact accounting and observed counts without treating an empty blocker list as approval', () => {
  expect(inspect(raw)).toMatchObject({ detail: { accountId: account.id, voucherId: '123' }, attachmentCount: 0,
    auxiliaryEntryCount: 0, currencyCodes: [], blockers: [] })
  expect(inspect(raw).notice).toContain('未取得删除授权')
})

it.each(['complete', 'duplicate-page', 'changed-total', 'page-cap'] as const)('handles multi-page deletion inventory: %s', async (mode) => {
  const read = vi.fn(async (query: VoucherQuery): Promise<VoucherPage> => {
    const id = query.page === 1 || mode === 'duplicate-page' ? 'retained-1' : 'retained-2'
    return { accountId: account.id, accountName: account.name, month: '不限月份', page: query.page, pageSize: 100,
      total: mode === 'changed-total' && query.page === 2 ? 3 : 2, voucherCount: 1, hasMore: query.page === 1, notice: '',
      rows: [{ voucherId: id, date: '2022-01-01', number: '记-1', summary: '', subjectCode: '1001',
        subjectName: '现金', debit: '0.01', credit: '0.00' }] }
  })
  const result = observeVoucherAbsence({ accountId: account.id, accountName: account.name, voucherId: '123' }, read,
    mode === 'page-cap' ? 1 : 2)
  if (mode !== 'complete') await expect(result).rejects.toThrow()
  else {
    expect(await result).toEqual({ state: 'absent', voucherCount: 2 })
    expect(read.mock.calls.map(([query]) => query.page)).toEqual([1, 2, 1, 2])
  }
})

it('binds the fingerprint to omitted raw fields without exposing private attachment URLs', () => {
  const url = 'https://private.example.test/original?signature=private'
  const changed = { ...raw, attachmentStatus: true, attachmentList: [{ url }],
    certificateLists: raw.certificateLists.map(row => ({ ...row, currencyCode: 'USD', auxiliaryList: [{ id: '1' }] })) }
  const result = inspect(changed)
  expect(result).toMatchObject({ attachmentCount: 1, auxiliaryEntryCount: 2, currencyCodes: ['USD'] })
  expect(result.notice).toContain('本操作不清理原OSS文件；凭证删除不证明有成转存附件已清除，也不保证附件长期保留。')
  expect(JSON.stringify(result)).not.toContain(url)
  expect(result.fingerprint).not.toBe(inspect(raw).fingerprint)
  expect(inspect({ ...raw, unknownVendorField: 'changed' }).fingerprint).not.toBe(inspect(raw).fingerprint)
  expect(inspect(raw).fingerprint).toBe(inspect(structuredClone(raw)).fingerprint)
})

it.each(['modified', 'channel', 'sysCreate', 'relationCode', 'adjustPeriodsStatus', 'attachmentStatus',
  'attachmentList', 'corpBalanceSheetCertificateList', 'subjectCertificateWrites'])('refuses missing %s', (key) => {
  const data = Object.fromEntries(Object.entries(raw).filter(([name]) => name !== key))
  expect(() => inspect(data)).toThrow('未完整返回')
})

it.each([
  { audited: { auditingStatus: true } }, { settled: { settleStatus: true } }, { generated: { sysCreate: true } },
  { related: { relationCode: 'link' } }, { relatedSheet: { corpBalanceSheetCertificateList: [{}] } },
  { relatedWrites: { subjectCertificateWrites: [{}] } }, { adjustment: { adjustPeriodsStatus: 1 } },
  { attachmentMismatch: { attachmentStatus: true } },
])('exposes a refusal for %j', (change) => {
  expect(inspect({ ...raw, ...Object.values(change)[0] }).blockers).not.toHaveLength(0)
})

it('rejects wrong identity, unprovided entry metadata, raw oversize and complete-result oversize', () => {
  expect(() => inspect({ ...raw, accountId: 'other' })).toThrow('身份')
  expect(() => inspect({ ...raw, certificateId: 'other' })).toThrow('身份')
  expect(() => inspect({ ...raw, certificateLists: raw.certificateLists.map(row => ({ ...row, auxiliaryList: null })) })).toThrow()
  expect(() => inspect(undefined)).toThrow()
  expect(() => inspect(raw, 10)).toThrow('大小限制')
  const rawBytes = Buffer.byteLength(JSON.stringify(raw))
  const resultBytes = Buffer.byteLength(JSON.stringify(inspect(raw)))
  expect(resultBytes).toBeGreaterThan(rawBytes)
  expect(() => inspect(raw, resultBytes - 1)).toThrow('大小限制')
  expect(inspect(raw, resultBytes)).toEqual(inspect(raw))
})

it('uses only authenticated reads and does not mistake a query rejection for deletion', async () => {
  const paths: string[] = []
  let rejectDetail = false
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    paths.push(url.pathname)
    if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fixture-token' })
    if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') {
      return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
    }
    expect(url.pathname).toBe('/finance/certificate/info.rjson')
    if (typeof init.body !== 'string') throw new Error('expected JSON request body')
    expect(JSON.parse(init.body)).toEqual({ accountName: account.name, certificateId: '123' })
    return Response.json(rejectDetail ? { result: 201, message: 'not-found-or-denied' } : { result: 100, data: raw })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fixture-key', accountCode: account.id }
  const read = () => adapter.inspectVoucherDeletion(config, 'fixture-secret', '123', new AbortController().signal, maxBytes)
  expect(await read()).toEqual(inspect(raw))
  rejectDetail = true
  await expect(read()).rejects.toThrow('失败不等于凭证不存在')
  expect(paths.filter(path => path === '/finance/certificate/info.rjson')).toHaveLength(2)
})

it('builds only the documented deletion fields from the inspected voucher', () => {
  expect(prepareVoucherDeletion(inspect(raw))).toEqual({ accountName: account.name, cerInfoList: [{ cerId: '123' }] })
  expect(() => prepareVoucherDeletion(inspect({ ...raw, auditingStatus: true }))).toThrow('删除限制')
})

it.each([
  [{ result: 100, data: {} }, true, 'accepted'], [{ result: 201, message: 'private' }, true, 'rejected'],
  [{ result: 100 }, false, 'outcome-unknown'], [{ result: '100' }, true, 'outcome-unknown'],
  [{ result: 500 }, true, 'outcome-unknown'], [null, true, 'outcome-unknown'],
])('classifies %j without claiming verified deletion', (response, ok, state) => {
  const outcome = classifyVoucherDeletion(response, ok)
  expect(outcome.state).toBe(state)
  expect(JSON.stringify(outcome)).not.toContain('private')
})

it.each(['accepted', 'rejected', 'lost-response', 'cancel-after-send', 'cancel-before-send', 'stale', 'denied',
  'wrong-ledger', 'wrong-target', 'leaked-token', 'changed-key', 'changed-environment', 'changed-payload',
  'changed-inspection', 'changed-during-auth'] as const)('single-send transport handles %s', async (scenario) => {
  const controller = new AbortController()
  let sent = 0
  const reserve = vi.fn(async () => {
    if (scenario === 'denied') throw new Error('not approved')
    if (scenario === 'cancel-before-send') controller.abort()
    if (scenario === 'changed-key') config.appKey = 'another-key'
    if (scenario === 'changed-environment') config.environment = 'production'
    if (scenario === 'changed-payload') payload.accountName = 'another-ledger'
    if (scenario === 'changed-inspection') inspection.notice = 'Changed after confirmation'
  })
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname === '/auth/getAccessToken.rjson') {
      if (scenario === 'changed-during-auth') config.appKey = 'another-key'
      return Response.json({ result: 100, data: 'fixture-token' })
    }
    if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') {
      return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
    }
    if (url.pathname === '/finance/certificate/info.rjson') {
      return Response.json({ result: 100, data: scenario === 'stale' ? { ...raw, modified: 'later' } : raw })
    }
    expect(url.pathname).toBe('/finance/certificate/delCertificate.rjson')
    expect(reserve).toHaveBeenCalledTimes(1)
    if (typeof init.body !== 'string') throw new Error('expected JSON request body')
    expect(JSON.parse(init.body)).toEqual({ accountName: account.name, cerInfoList: [{ cerId: '123' }] })
    expect(init.redirect).toBe('error')
    sent++
    if (scenario === 'lost-response') throw new Error('socket lost')
    if (scenario === 'cancel-after-send') { controller.abort(); throw new Error('cancelled after dispatch') }
    return Response.json(scenario === 'rejected' ? { result: 201 } : { result: 100,
      data: scenario === 'leaked-token' ? 'fixture-token' : {} })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const config = { system: 'youcheng' as const, environment: 'test' as 'test' | 'production', appKey: 'fixture-key', accountCode: account.id }
  const payload = prepareVoucherDeletion(inspect(raw))
  const inspection = inspect(raw)
  if (scenario === 'wrong-target') payload.cerInfoList[0].cerId = 'other'
  if (scenario === 'wrong-ledger') config.accountCode = 'other'
  const outcome = await adapter.sendReservedVoucherDeletion(config, 'fixture-secret', payload, inspection,
    controller.signal, maxBytes, reserve)
  const unsent = ['cancel-before-send', 'stale', 'denied', 'wrong-ledger', 'wrong-target', 'changed-key',
    'changed-environment', 'changed-payload', 'changed-inspection', 'changed-during-auth'].includes(scenario)
  expect(sent).toBe(unsent ? 0 : 1)
  expect(outcome.state).toBe(unsent ? 'not-sent'
    : scenario === 'accepted' || scenario === 'rejected' ? scenario : 'outcome-unknown')
})
