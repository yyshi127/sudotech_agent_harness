import { afterEach, expect, it, vi } from 'vitest'
import { classifyOpenItemDeletion, collectOpenItemDeletionInventory, inspectOpenItemDeletion,
  compareOpenItemDeletion, type OpenItemDeletionPage } from '../src/open-item-deletion.ts'
import { projectOpenItems, type OpenItemQuery } from '../src/open-items.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const account = { id: '35616', name: '测试账套' }
const limits = { maxPages: 4, maxRows: 20, maxBytes: 131072, pageSize: 2 }
const query: OpenItemQuery = { direction: 'receivable', periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 2 }
const raw = { id: 72602, setOfBooksId: 35616, subjectId: 174626, accountStatus: 0,
  date: '2022-01-01', abstractStr: '删除检查专用', subjectCode: '', subjectName: '往来账户',
  auxiliaryItemIds: '191501', auxiliaryItemName: '测试往来单位', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
  money: 0.19, balance: 0.19, thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0,
  initialBalance: false, isFinish: false, categoryName: '其他收入', remark: '',
  attachList: [], certificateWordAndCode: '', orderCode: '' }
const page = (rows: unknown[], selected = query, count = rows.length): OpenItemDeletionPage => {
  const data = { list: rows, count }
  return { raw: data, result: projectOpenItems(data, selected, account, limits.maxRows, limits.maxBytes) }
}
afterEach(() => vi.unstubAllGlobals())

it.each([
  [{ result: 100, data: '1' }, true, { state: 'accepted' }],
  [{ result: 201, message: 'vendor-private' }, true, { state: 'rejected', code: 201 }],
  [{ result: 300 }, true, { state: 'outcome-unknown' }],
  [{ result: 99 }, true, { state: 'outcome-unknown' }],
  [{ result: 100.5 }, true, { state: 'outcome-unknown' }],
  [{ result: '100' }, true, { state: 'outcome-unknown' }],
  [{ result: 100 }, false, { state: 'outcome-unknown' }],
  [null, true, { state: 'outcome-unknown' }],
])('keeps delete acknowledgement separate from readback %#', (value, ok, expected) => {
  expect(classifyOpenItemDeletion(value, ok)).toEqual(expected)
})

for (const direction of ['receivable', 'payable'] as const) {
  it.each(['accepted', 'rejected', 'lost', 'cancel-after', 'http-error', 'invalid-json', 'oversized', 'secret-response',
    'cancel-before', 'already-cancelled', 'reservation-failed', 'changed', 'changed-survivor', 'linked',
    'wrong-ledger', 'wrong-direction', 'missing-target', 'unsafe-id', 'missing-secret', 'ambiguous-name',
    'renamed-ledger', 'incomplete', 'denied-read', 'mutated-config', 'mutated-target'] as const)(
    `sends at most one ${direction} delete: %s`, async (mode) => {
      const controller = new AbortController()
      const selection = { direction, periodStart: '2022-01', periodEnd: '2022-01' }
      const rows = [raw, { ...raw, id: 72610 }]
      const inspection = await collectOpenItemDeletionInventory(selection, String(raw.id),
        async selected => page(selected.page === 1 ? rows : [], selected, 2), controller.signal, limits)
      const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fixture-key', accountCode: account.id }
      const finalCheck = vi.fn(async () => {
        if (mode === 'reservation-failed') throw new Error('reservation or authority failed')
        if (mode === 'cancel-before') controller.abort()
        if (mode === 'mutated-config') config.accountCode = '35601'
        if (mode === 'mutated-target') inspection.selection.direction = direction === 'receivable' ? 'payable' : 'receivable'
      })
      if (mode === 'wrong-ledger') config.accountCode = '35601'
      if (mode === 'missing-target') delete inspection.target
      if (mode === 'unsafe-id' && inspection.target) inspection.target.row.id = '9007199254740993' as typeof inspection.target.row.id
      if (mode === 'wrong-direction' && inspection.target) inspection.target.direction = direction === 'receivable' ? 'payable' : 'receivable'
      if (mode === 'already-cancelled') controller.abort()
      let writes = 0
      const pages: number[] = []
      vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
        expect(url.origin).toBe('https://example.test')
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fixture-token' })
        if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100,
          data: [{ id: account.id, sobName: mode === 'renamed-ledger' ? '新账套名称' : account.name },
            ...(mode === 'ambiguous-name' ? [{ id: '35601', sobName: account.name }] : [])] })
        if (typeof init.body !== 'string') throw new Error('missing JSON body')
        if (url.pathname === '/finance/cashjournal/getCashierList') {
          const request = JSON.parse(init.body) as { page: number; direction: number; setOfBooksId: number }
          expect(request.direction).toBe(direction === 'receivable' ? 0 : 1)
          expect(request.setOfBooksId).toBe(35616)
          pages.push(request.page)
          if (mode === 'denied-read') return Response.json({ result: 201 })
          const current = rows.map((row, index) => ({ ...row,
            ...(mode === 'changed' && index === 0 || mode === 'changed-survivor' && index === 1 ? { remark: 'edited' } : {}),
            ...(mode === 'linked' && index === 0 ? { certificateId: 123 } : {}),
          }))
          return Response.json({ result: 100, data: { count: mode === 'incomplete' ? 3 : 2, list: request.page === 1 ? current : [] } })
        }
        expect(url.pathname).toBe('/finance/cashier/account/management/delete.rjson')
        expect(finalCheck).toHaveBeenCalledTimes(1)
        expect(pages).toEqual([1, 2, 1, 2])
        expect(JSON.parse(init.body)).toEqual({ booksName: account.name, managementId: raw.id })
        expect(init.redirect).toBe('error')
        writes++
        if (mode === 'lost') throw new Error('lost response')
        if (mode === 'cancel-after') { controller.abort(); throw new Error('cancelled response') }
        if (mode === 'invalid-json') return new Response('invalid')
        return Response.json({ result: mode === 'rejected' ? 201 : 100,
          data: mode === 'secret-response' ? 'fixture-token' : mode === 'oversized' ? 'x'.repeat(limits.maxBytes) : '1' },
        { status: mode === 'http-error' ? 503 : 200 })
      }))
      const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 2000, true)
      const result = await adapter.sendReservedOpenItemDeletion(config, mode === 'missing-secret' ? undefined : 'fixture-secret',
        inspection, controller.signal, limits, finalCheck)
      const sent = ['accepted', 'rejected', 'lost', 'cancel-after', 'http-error', 'invalid-json', 'oversized', 'secret-response'].includes(mode)
      expect(writes).toBe(sent ? 1 : 0)
      expect(result.state).toBe(!sent ? 'not-sent' : mode === 'accepted' || mode === 'rejected' ? mode : 'outcome-unknown')
      expect(JSON.stringify(result)).not.toMatch(/fixture-key|fixture-secret|fixture-token/)
      if (sent) expect(inspection.target?.unverified).toHaveLength(4)
    })
}

it.each(['receivable', 'payable'] as const)('retains %s target and unknown constraints', (direction) => {
  const result = inspectOpenItemDeletion(page([raw], { ...query, direction }), '72602', limits.maxBytes)
  expect(result).toMatchObject({ direction, businessAccountId: '174626', row: { id: '72602', balance: '0.19' }, blockers: [] })
  expect(result.unverified).toHaveLength(4)
  expect(result.unverified.some(value => value.includes('连带删除'))).toBe(true)
  expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect(result.row.baseAmount).toBeNull()
})

it.each(['subjectId', 'accountStatus', 'initialBalance', 'isFinish', 'attachList', 'certificateWordAndCode', 'orderCode'])(
  'refuses omitted deletion metadata %s', (key) => {
    const value = Object.fromEntries(Object.entries(raw).filter(([name]) => name !== key))
    expect(() => inspectOpenItemDeletion(page([value]), '72602', limits.maxBytes)).toThrow('缺少状态')
  })

it.each([
  { accountStatus: 1 }, { initialBalance: true }, { isFinish: true }, { money: 0 }, { money: -1 },
  { balance: 0.18 }, { thisMoney: 0.01 }, { badMoney: 0.01 }, { hedgeMoney: 0.01 }, { returnMoney: 0.01 },
  { thisMoney: '' }, { badMoney: null }, { hedgeMoney: undefined }, { returnMoney: '' },
  { certificateWordAndCode: '记-1' }, { certificateId: 123 }, { certificateId: '123' }, { tempCertificateId: 456 },
  { otherMoney: 0.01 }, { otherMoney: '-0.01' }, { otherMoney: 'invalid' }, { otherMoney: {} },
  { orderCode: 'order-1' }, { attachList: [{ url: 'https://private.test?signature=private' }] },
])('reports observed restriction %# without returning attachment links', (change) => {
  const result = inspectOpenItemDeletion(page([{ ...raw, ...change }]), '72602', limits.maxBytes)
  expect(result.blockers.length).toBeGreaterThan(0)
  expect(JSON.stringify(result)).not.toContain('signature=private')
})

it.each([0, '0', '0.0', '0.00'])('retains explicit other write-off zero %j without claiming exhaustive link safety', (otherMoney) => {
  const result = inspectOpenItemDeletion(page([{ ...raw, otherMoney, certificateId: 0, tempCertificateId: '' }]), '72602', limits.maxBytes)
  expect(result.blockers).toEqual([])
  expect(result.unverified).toHaveLength(3)
  expect(result.unverified.some(value => value.includes('完整关联影响未核实'))).toBe(true)
})

it.each([null, undefined, ''])('does not convert missing other write-off amount %j into zero', (otherMoney) => {
  const result = inspectOpenItemDeletion(page([{ ...raw, otherMoney }]), '72602', limits.maxBytes)
  expect(result.unverified).toContain('其他核销金额未提供，不按零处理。')
})

it('rejects missing, duplicate, wrong-ledger and oversized target evidence', () => {
  expect(() => inspectOpenItemDeletion(page([raw]), '174626', limits.maxBytes)).toThrow('缺失')
  const duplicate = page([raw])
  duplicate.raw = { list: [raw, raw] }
  expect(() => inspectOpenItemDeletion(duplicate, '72602', limits.maxBytes)).toThrow('不唯一')
  const wrongLedger = page([raw])
  wrongLedger.raw = { list: [{ ...raw, setOfBooksId: 35601 }] }
  expect(() => inspectOpenItemDeletion(wrongLedger, '72602', limits.maxBytes)).toThrow('账套不符')
  expect(() => inspectOpenItemDeletion(page([raw]), '72602', 10)).toThrow('大小')
})

it.each(['receivable', 'payable'] as const)('collects counted %s inventories, never global absence', async (direction) => {
  const seen: number[] = []
  const result = await collectOpenItemDeletionInventory({ direction, periodStart: '2022-01', periodEnd: '2022-01' }, '72699',
    async (selected) => { seen.push(selected.page); return page(selected.page === 1 ? [raw] : [], selected, 1) },
    new AbortController().signal, limits)
  expect(seen).toEqual([1, 2, 1, 2])
  expect(result).toMatchObject({ totalCount: 1, selection: { direction }, scope: 'selected-direction-periods' })
  expect(result.target).toBeUndefined()
})

it.each(['wrong-direction', 'wrong-ledger', 'wrong-period', 'outside-period', 'count-change', 'duplicate',
  'short-final', 'changed', 'limited-pages', 'limited-bytes', 'limited-rows', 'cancelled', 'denied'] as const)(
  'rejects incomplete inventory: %s', async (mode) => {
    const controller = new AbortController()
    let calls = 0
    const read = async (selected: OpenItemQuery) => {
      calls++
      if (mode === 'denied') throw new Error('permission denied')
      if (mode === 'cancelled') controller.abort()
      const value = { ...raw, ...(mode === 'changed' && calls > 2 ? { remark: 'changed' } : {}),
        ...(mode === 'outside-period' ? { date: '2022-02-01' } : {}) }
      const response = page(selected.page === 1 || mode === 'duplicate' ? [value] : [], selected,
        mode === 'short-final' || mode === 'duplicate' || mode === 'count-change' && selected.page > 1 ? 2 : 1)
      if (mode === 'wrong-direction') response.result.selection = { ...selected, direction: 'payable' }
      if (mode === 'wrong-ledger' && calls > 1) response.result.accountId = '35601'
      if (mode === 'wrong-period') response.result.selection = { ...selected, periodEnd: '2022-02' }
      return response
    }
    await expect(collectOpenItemDeletionInventory({ direction: query.direction, periodStart: query.periodStart,
      periodEnd: query.periodEnd }, '72602', read, controller.signal, { ...limits,
      maxPages: mode === 'limited-pages' ? 1 : limits.maxPages, maxBytes: mode === 'limited-bytes' ? 10 : limits.maxBytes,
      maxRows: mode === 'limited-rows' ? 0 : limits.maxRows })).rejects.toThrow()
  })

it.each(['receivable', 'payable'] as const)('adapter keeps %s reads authenticated and never calls a mutation', async (direction) => {
  const calls: string[] = []
  const pages: number[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    calls.push(url.pathname)
    if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fixture-token' })
    if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100,
      data: [{ id: account.id, sobName: account.name }] })
    expect(url.pathname).toBe('/finance/cashjournal/getCashierList')
    expect(init.redirect).toBe('error')
    if (typeof init.body !== 'string') throw new Error('Missing JSON body')
    const body = JSON.parse(init.body) as { setOfBooksId: number; direction: number; page: number; pageSize: number }
    expect(body.setOfBooksId).toBe(35616)
    expect(body.direction).toBe(direction === 'receivable' ? 0 : 1)
    expect(body.pageSize).toBe(2)
    pages.push(body.page)
    return Response.json({ result: 100, data: { count: 1, list: body.page === 1 ? [raw] : [] } })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const result = await adapter.inspectOpenItemDeletion({ system: 'youcheng', environment: 'test',
    appKey: 'fixture-app-key', accountCode: account.id }, 'fixture-secret',
  { direction, periodStart: '2022-01', periodEnd: '2022-01' }, '72602', new AbortController().signal, limits)
  expect(result.target?.direction).toBe(direction)
  expect(pages).toEqual([1, 2, 1, 2])
  expect(calls).toHaveLength(6)
  expect(JSON.stringify(result)).not.toMatch(/fixture-token|fixture-secret|fixture-app-key/)
})

it.each(['receivable', 'payable'] as const)('compares surviving %s records and separates unknown base balances', async (direction) => {
  const selection = { direction, periodStart: '2022-01', periodEnd: '2022-01' }
  const survivor = { ...raw, id: 72610, baseMoney: 0.19, baseBalance: 0.19 }
  const collect = (records: unknown[]) => collectOpenItemDeletionInventory(selection, '72602',
    async selected => page(selected.page === 1 ? records : [], selected, records.length), new AbortController().signal, limits)
  const before = await collect([raw, survivor])
  const after = await collect([survivor])
  expect(compareOpenItemDeletion(before, after)).toMatchObject({ target: 'not-observed', content: 'matched',
    remainingBalances: 'matched', scope: 'selected-direction-periods',
    balances: { original: { state: 'matched' }, base: { state: 'matched' } } })
  expect(compareOpenItemDeletion(before, before).target).toBe('present')
  expect(compareOpenItemDeletion(after, after).target).toBe('unavailable')
  expect(compareOpenItemDeletion(before, { ...after, selection: { ...selection,
    direction: direction === 'receivable' ? 'payable' : 'receivable' } }).target).toBe('unavailable')
  expect(compareOpenItemDeletion(before, { ...after, accountId: '35601' }).target).toBe('unavailable')
  expect(compareOpenItemDeletion(before, await collect([])).content).toBe('mismatch')
  expect(compareOpenItemDeletion(before, await collect([{ ...survivor, remark: 'edited' }])).content).toBe('mismatch')
  expect(compareOpenItemDeletion(before, await collect([{ ...survivor, attachList: [{ id: 1 }] }])).content).toBe('mismatch')
  const changedBalance = compareOpenItemDeletion(before, await collect([{ ...survivor, balance: 0.18 }]))
  expect(changedBalance).toMatchObject({ content: 'matched', remainingBalances: 'mismatch' })
  const missingBefore = await collect([raw, { ...survivor, baseBalance: undefined }])
  const missingAfter = await collect([{ ...survivor, baseBalance: undefined }])
  expect(compareOpenItemDeletion(missingBefore, missingAfter)).toMatchObject({ remainingBalances: 'matched',
    balances: { base: { changes: [{ basis: 'same-currency' }] } } })
  expect(compareOpenItemDeletion(await collect([raw]), await collect([]))).toMatchObject({ remainingBalances: 'matched',
    balances: { original: { changes: [{ after: '0.00', expectedAfter: '0.00' }] } } })
})
