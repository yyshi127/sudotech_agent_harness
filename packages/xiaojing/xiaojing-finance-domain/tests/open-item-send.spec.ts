import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { OpenItemRecords } from '../src/open-item-records.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const roots: string[] = []
const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
const digest = 'a'.repeat(64)
async function fixture(direction: 'receivable' | 'payable') {
  const root = await mkdtemp(join(tmpdir(), 'f3a-open-item-send-'))
  roots.push(root)
  const records = new OpenItemRecords(root, 'client/session', 10000)
  const payable = direction === 'payable'
  const record = await records.create({ direction, accountId: payable ? '174624' : '174626',
    categoryId: payable ? '578260' : '578250', auxiliaryCategoryCode: payable ? '02' : '01',
    auxiliaryItemId: payable ? '191573' : '191501', date: '2022-01-01', amount: '0.03', summary: 'F3单次发送', keeperName: '施' }, digest)
  const reserved = await records.reserve(record.id, 1, digest, async ({ input }) => ({ ledgerId: '35616', ledgerName: '测试账套',
    accountId: input.accountId, accountName: payable ? '应付账款' : '应收账款', currencyCode: 'RMB',
    categoryId: input.categoryId, categoryName: payable ? '其他支出' : '其他收入', counterparty: {
      categoryId: input.auxiliaryItemId, categoryCode: input.auxiliaryCategoryCode, categoryName: payable ? '供应商' : '客户',
      itemId: input.auxiliaryItemId, itemCode: '03', itemName: '往来测试', itemStatus: 'enabled',
      wireName: `${payable ? '供应商' : '客户'}:往来测试` } }))
  return { records, reserved, adapter: new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000, true) }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it.each(['receivable', 'payable'] as const)('sends the durable %s request once and preserves transport outcomes', async (direction) => {
  for (const mode of ['accepted', 'lost', 'http-error', 'rejected', 'cancelled-after-response', 'invalid-json', 'oversized', 'leaked-secret']) {
    const { records, reserved, adapter } = await fixture(direction)
    const stop = new AbortController()
    const before = vi.fn(async () => {})
    let writes = 0
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
      if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '测试账套' }] })
      expect(url.pathname).toBe('/finance/cashier/account/management/add.rjson')
      expect(init.redirect).toBe('error')
      expect(before).toHaveBeenCalledTimes(1)
      if (typeof init.body !== 'string') throw new Error('Expected JSON')
      expect(JSON.parse(init.body)).toEqual(reserved.reservation?.payload)
      writes += 1
      if (mode === 'lost') throw new TypeError('lost', { cause: { code: 'ECONNRESET' } })
      if (mode === 'cancelled-after-response') stop.abort()
      if (mode === 'invalid-json') return new Response('invalid')
      if (mode === 'oversized') return new Response('x'.repeat(10001))
      if (mode === 'leaked-secret') return Response.json({ result: 100, data: '72595', message: 'fake-secret' })
      return Response.json({ result: mode === 'rejected' ? 201 : 100, data: '72595' }, { status: mode === 'http-error' ? 500 : 200 })
    }))
    const outcome = await adapter.sendReservedOpenItem(config, 'fake-secret', reserved, stop.signal, 10000, before)
    expect(writes).toBe(1)
    expect(outcome).toEqual(mode === 'accepted' || mode === 'cancelled-after-response' ? { state: 'accepted', openItemId: '72595' }
      : mode === 'rejected' ? { state: 'rejected', code: 201 } : { state: 'outcome-unknown' })
    const observed = await records.recordOutcome(reserved.id, 1, outcome)
    expect(await adapter.sendReservedOpenItem(config, 'fake-secret', observed, new AbortController().signal, 10000, before))
      .toEqual({ state: 'not-sent', reason: 'preflight-failed' })
    expect(writes).toBe(1)
  }
})

it('does not send after changed ledger, lost credentials, stale references, cancellation or duplicate ledger name', async () => {
  const { reserved, adapter } = await fixture('receivable')
  for (const mode of ['wrong-ledger', 'no-secret', 'renamed', 'duplicate', 'preflight-failed', 'cancelled']) {
    const before = vi.fn(async () => { if (mode === 'preflight-failed') throw new Error('changed configuration') })
    const stop = new AbortController()
    if (mode === 'cancelled') stop.abort()
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
      expect(url.pathname).toBe('/finance/auxiliary/queryAccountList.rjson')
      return Response.json({ result: 100, data: [{ id: '35616', sobName: mode === 'renamed' ? '已更名' : '测试账套' },
        ...mode === 'duplicate' ? [{ id: '35601', sobName: '测试账套' }] : []] })
    }))
    const result = await adapter.sendReservedOpenItem(mode === 'wrong-ledger' ? { ...config, accountCode: '35601' } : config,
      mode === 'no-secret' ? undefined : 'fake-secret', reserved, stop.signal, 10000, before)
    expect(result).toEqual({ state: 'not-sent', reason: mode === 'cancelled' ? 'cancelled' : 'preflight-failed' })
    if (mode !== 'preflight-failed') expect(before).not.toHaveBeenCalled()
  }
})

it('rejects an unreserved or changed request before authentication', async () => {
  const { reserved, adapter } = await fixture('payable')
  const reservation = reserved.reservation
  if (reservation === undefined) throw new Error('Expected reservation')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  for (const record of [{ ...reserved, phase: 'prepared' as const },
    { ...reserved, reservation: { ...reservation, payload: { ...reservation.payload, money: 99 } } },
    { ...reserved, reservation: { ...reservation, selection: { ...reservation.selection, accountId: reserved.input.categoryId } } }]) {
    expect(await adapter.sendReservedOpenItem(config, 'fake-secret', record, new AbortController().signal, 10000, async () => {}))
      .toEqual({ state: 'not-sent', reason: 'preflight-failed' })
  }
  expect(fetch).not.toHaveBeenCalled()
})
