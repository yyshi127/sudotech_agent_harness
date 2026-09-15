import { afterEach, expect, it, vi } from 'vitest'
import { collectJournalDeletionInventory, inspectJournalDeletion, compareJournalDeletion, classifyJournalDeletion,
  type JournalDeletionPage } from '../src/journal-deletion.ts'
import { projectJournals, type JournalQuery } from '../src/journals.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const account = { id: '35616', name: '测试账套' }
const selection = { month: '2022-01', cashAccountId: '174622' }
const query: JournalQuery = { ...selection, page: 1, pageSize: 2 }
const limits = { maxRows: 20, pageSize: 2, maxPages: 4, maxBytes: 131072 }
const raw = { id: 141053, subjectId: 174622, date: '2022-01-01', abstractStr: '专用删除检查',
  accountCode: '', accountName: '库存现金', subjectCode: '', subjectName: '库存现金',
  currencyCode: 'RMB', baseCurrencyCode: 'RMB', borrow: 0.11, loan: null, balance: 0.11,
  baseBorrow: 0.11, baseLoan: null, baseBalance: 0.11, categoryName: '收-其他收入', keeperName: '测试员',
  reviewStatus: 0, reviewUser: '', reviewUserId: '', accountStatus: 0, channel: 'ADD',
  certificateWordAndCode: '', cashManagementId: '', auxiliaryItemIds: '', orderCode: '', relationOrderCodeList: [],
  attachList: [], attachIdList: [], canWriteOffAmount: 0.11 }
const page = (rows: unknown[], selected = query, count: unknown = rows.length): JournalDeletionPage => ({
  result: projectJournals(rows, selected, account, limits.maxRows, limits.maxBytes), raw: rows, totalCount: count })
afterEach(() => vi.unstubAllGlobals())

it('retains the exact target, amount and account without granting consent', () => {
  expect(inspectJournalDeletion(page([raw]), '141053', limits.maxBytes)).toMatchObject({
    accountId: account.id, cashAccountId: '174622', row: { id: '141053', income: '0.11' }, blockers: [] })
  expect(() => inspectJournalDeletion(page([raw]), 'other', limits.maxBytes)).toThrow('目标')
  expect(() => inspectJournalDeletion(page([raw]), '141053', 10)).toThrow('大小')
})

it.each(['reviewStatus', 'reviewUser', 'reviewUserId', 'accountStatus', 'channel', 'certificateWordAndCode',
  'cashManagementId', 'auxiliaryItemIds', 'orderCode', 'relationOrderCodeList', 'attachList', 'attachIdList', 'canWriteOffAmount'])(
  'refuses missing deletion evidence %s', (key) => {
    const value = Object.fromEntries(Object.entries(raw).filter(([name]) => name !== key))
    expect(() => inspectJournalDeletion(page([value]), '141053', limits.maxBytes)).toThrow('未完整返回')
  })

it.each([
  { reviewStatus: 1 }, { reviewUser: '审计员' }, { reviewUserId: '1' }, { accountStatus: 1 }, { channel: 'OTHER' },
  { certificateWordAndCode: '记-10' }, { certificateId: 123 }, { tempCertificateId: 124 }, { cashManagementId: '1' },
  { auxiliaryItemIds: '191501' }, { orderCode: 'other' }, { relationOrderCodeList: ['linked'] },
  { attachList: [{ url: 'https://private.test?signature=private' }] }, { attachIdList: ['1'] },
  { canWriteOffAmount: 0.10 }, { borrow: 0, loan: 0 }, { borrow: 0.1, loan: 0.01 },
])('reports restrictions for %j without exposing attachment URLs', (change) => {
  const inspected = inspectJournalDeletion(page([{ ...raw, ...change }]), '141053', limits.maxBytes)
  expect(inspected.blockers.length).toBeGreaterThan(0)
  expect(JSON.stringify(inspected)).not.toContain('signature=')
})

it.each(['complete', 'absent', 'count-missing', 'count-string', 'count-change', 'duplicate', 'partial', 'changed',
  'wrong-ledger', 'wrong-query', 'limited-rows', 'limited-bytes', 'permission', 'cancelled'] as const)(
  'counted two-pass inventory handles %s', async (mode) => {
    const controller = new AbortController()
    let calls = 0
    const read = vi.fn(async (selected: JournalQuery): Promise<JournalDeletionPage> => {
      calls++
      if (mode === 'permission') throw new Error('read denied')
      if (mode === 'cancelled') controller.abort()
      const result = page(selected.page === 1 ? [mode === 'changed' && calls > 2 ? { ...raw, keeperName: '变更' } : raw]
        : mode === 'duplicate' || mode === 'partial' ? [{ ...raw, id: mode === 'duplicate' ? raw.id : raw.id + calls }] : [], selected, 1)
      if (mode === 'count-missing') result.totalCount = undefined
      if (mode === 'count-string') result.totalCount = '1'
      if (mode === 'count-change' && selected.page > 1) result.totalCount = 2
      if (mode === 'wrong-ledger' && selected.page > 1) result.result.accountId = '35601'
      if (mode === 'wrong-query') result.result.selection.dateEnd = '2022-01-02'
      return result
    })
    const collected = collectJournalDeletionInventory(selection,
      mode === 'absent' ? '141999' : '141053', read, controller.signal,
      { ...limits, maxRows: mode === 'limited-rows' ? 0 : limits.maxRows, maxBytes: mode === 'limited-bytes' ? 10 : limits.maxBytes })
    if (mode === 'complete' || mode === 'absent') {
      const inventory = await collected
      expect(inventory).toMatchObject({ totalCount: 1, accountId: account.id, scope: 'selected-month' })
      expect(inventory.target?.row.id).toBe(mode === 'complete' ? '141053' : undefined)
      expect(inventory.notice).toContain('不等于全账套不存在')
      expect(read.mock.calls.map(([value]) => value.page)).toEqual([1, 2, 1, 2])
    } else await expect(collected).rejects.toThrow()
  })

it.each(['provided', 'missing', 'denied', 'other-ledger'] as const)('adapter retains authenticated envelope count: %s', async (mode) => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    calls.push(url.pathname)
    if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fixture-token' })
    if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100,
      data: [{ id: mode === 'other-ledger' ? '35601' : account.id, sobName: account.name }] })
    if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json({ result: 100, data: [{ accountId: 174622 }] })
    expect(url.pathname).toBe('/finance/cashjournal/getListPage.rjson')
    expect(init.redirect).toBe('error')
    if (typeof init.body !== 'string') throw new Error('missing JSON body')
    const request = JSON.parse(init.body) as { page: number; accountName: string; subjectId: number }
    expect(request.accountName).toBe(account.name)
    expect(request.subjectId).toBe(174622)
    return Response.json({ result: mode === 'denied' ? 201 : 100, ...(mode === 'missing' ? {} : { count: 1 }),
      data: request.page === 1 ? [raw] : [] })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fixture-key', accountCode: account.id }
  const outcome = adapter.inspectJournalDeletion(config, 'fixture-secret', selection,
    '141053', new AbortController().signal, limits)
  if (mode === 'provided') expect(await outcome).toMatchObject({ totalCount: 1, target: { blockers: [] } })
  else await expect(outcome).rejects.toThrow()
  expect(calls.some(path => /delete|add|writeOff/.test(path))).toBe(false)
})

it.each(['matched', 'present', 'wrong-ledger', 'changed-content', 'changed-balance', 'missing-balance',
  'missing-total', 'unknown-currency', 'no-account', 'wrong-opening'] as const)('compares journal deletion balances: %s', async (mode) => {
  const make = async (deleted: boolean) => {
    const original = [raw,
      { ...raw, id: 141055, borrow: null, loan: 0.03, baseBorrow: null, baseLoan: 0.03,
        balance: 0.08, baseBalance: 0.08, canWriteOffAmount: 0.03 },
      { ...raw, id: 141057, borrow: null, loan: 0.02, baseBorrow: null, baseLoan: 0.02,
        balance: deleted ? 0.09 : 0.06, baseBalance: deleted ? 0.09 : 0.06, canWriteOffAmount: 0.02 }]
    const rows = deleted ? original.filter(row => row.id !== 141055) : original
    const marker = { ...raw, id: undefined, date: '', abstractStr: '初始余额', borrow: 0, loan: 0,
      baseBorrow: 0, baseLoan: 0, balance: 0, baseBalance: 0 }
    return collectJournalDeletionInventory(selection, '141055', async (selected) => {
      const records = rows.slice((selected.page - 1) * selected.pageSize, selected.page * selected.pageSize)
      return page([...(selected.page === 1 ? [marker] : []), ...records,
        { ...marker, abstractStr: '合计', balance: deleted ? 0.09 : 0.06, baseBalance: deleted ? 0.09 : 0.06 }], selected, rows.length)
    }, new AbortController().signal, limits)
  }
  const before = await make(false)
  const after = await make(mode !== 'present')
  if (mode === 'wrong-ledger') after.accountId = '35601'
  if (mode === 'changed-content') after.rows[0]!.summary = 'changed'
  if (mode === 'changed-balance') after.rows[1]!.balance = '0.10'
  if (mode === 'missing-balance') after.rows[1]!.baseBalance = null
  if (mode === 'missing-total') after.summaries = after.summaries.filter(row => row.kind !== 'total')
  if (mode === 'wrong-opening') after.summaries.find(row => row.kind === 'opening')!.balance = '0.01'
  if (mode === 'unknown-currency') before.target!.row.currencyCode = ''
  if (mode === 'no-account') { before.selection = { month: query.month }; after.selection = { month: query.month } }
  const result = compareJournalDeletion(before, after)
  expect(result.scope).toBe('selected-month')
  expect(result.target).toBe(mode === 'present' ? 'present' : mode === 'wrong-ledger' ? 'unavailable' : 'not-observed')
  expect(result.balances).toBe(mode === 'matched' ? 'matched'
    : mode === 'changed-balance' || mode === 'wrong-opening' ? 'mismatch' : 'unavailable')
  expect(result.content).toBe(mode === 'changed-content' ? 'mismatch'
    : mode === 'wrong-ledger' || mode === 'present' ? 'unavailable' : 'matched')
})

it.each([
  [{ result: 100 }, true, 'accepted'], [{ result: 201, message: 'private' }, true, 'rejected'],
  [{ result: 400 }, true, 'outcome-unknown'], [{ result: '100' }, true, 'outcome-unknown'],
  [{ result: 100 }, false, 'outcome-unknown'], [null, true, 'outcome-unknown'],
])('classifies journal deletion %j without readback claims', (body, ok, expected) => {
  expect(classifyJournalDeletion(body, ok).state).toBe(expected)
  expect(JSON.stringify(classifyJournalDeletion(body, ok))).not.toContain('private')
})

it.each(['accepted', 'rejected', 'lost', 'cancel-before', 'cancel-after', 'changed', 'denied', 'wrong-ledger', 'secret-response',
  'changed-key', 'changed-environment', 'changed-evidence', 'changed-during-auth'] as const)(
  'dispatches at most one journal delete for %s', async (mode) => {
    const controller = new AbortController()
    const inspection = await collectJournalDeletionInventory(selection, '141053',
      async selected => page(selected.page === 1 ? [raw] : [], selected, 1), controller.signal, limits)
    const config = { system: 'youcheng' as const, environment: 'test' as 'test' | 'production', appKey: 'fixture-key', accountCode: account.id }
    const finalCheck = vi.fn(async () => {
      if (mode === 'denied') throw new Error('authority changed')
      if (mode === 'cancel-before') controller.abort()
      if (mode === 'changed-key') config.appKey = 'other-key'
      if (mode === 'changed-environment') config.environment = 'production'
      if (mode === 'changed-evidence') inspection.notice = 'Changed after approval'
    })
    let writes = 0
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname === '/auth/getAccessToken.rjson') {
        if (mode === 'changed-during-auth') config.appKey = 'other-key'
        return Response.json({ result: 100, data: 'fixture-token' })
      }
      if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100,
        data: [{ id: account.id, sobName: account.name }] })
      if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json({ result: 100, data: [{ accountId: 174622 }] })
      if (typeof init.body !== 'string') throw new Error('missing JSON body')
      if (url.pathname === '/finance/cashjournal/getListPage.rjson') {
        const request = JSON.parse(init.body) as { page: number }
        return Response.json({ result: 100, count: 1,
          data: request.page === 1 ? [mode === 'changed' ? { ...raw, reviewStatus: 1 } : raw] : [] })
      }
      expect(url.pathname).toBe('/finance/cashjournal/delete.rjson')
      expect(finalCheck).toHaveBeenCalledTimes(1)
      expect(JSON.parse(init.body)).toEqual({ id: 141053, accountName: account.name })
      expect(init.redirect).toBe('error')
      writes++
      if (mode === 'lost') throw new Error('socket lost')
      if (mode === 'cancel-after') { controller.abort(); throw new Error('cancelled after dispatch') }
      return Response.json({ result: mode === 'rejected' ? 201 : 100, data: mode === 'secret-response' ? 'fixture-token' : {} })
    }))
    const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000, true)
    if (mode === 'wrong-ledger') config.accountCode = '35601'
    const result = await adapter.sendReservedJournalDeletion(config,
      'fixture-secret', inspection, controller.signal, limits, finalCheck)
    const unsent = ['cancel-before', 'changed', 'denied', 'wrong-ledger', 'changed-key', 'changed-environment',
      'changed-evidence', 'changed-during-auth'].includes(mode)
    expect(writes).toBe(unsent ? 0 : 1)
    expect(result.state).toBe(unsent ? 'not-sent' : mode === 'accepted' || mode === 'rejected' ? mode : 'outcome-unknown')
  })
