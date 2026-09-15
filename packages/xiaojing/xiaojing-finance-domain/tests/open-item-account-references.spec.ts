import { afterEach, expect, it, vi } from 'vitest'
import { projectOpenItems } from '../src/open-items.ts'
import { projectOpenItemAccountReferences, resolveObservedOpenItemAccount } from '../src/open-item-account-references.ts'
import { validateOpenItemPreparation } from '../src/open-item-preparation.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const ledger = { id: '35616', name: '施的演示账套' }
const query = { direction: 'receivable' as const, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 }
const row = { id: 72595, setOfBooksId: 35616, date: '2022-01-01', abstractStr: 'F3账户属性',
  subjectCode: '', subjectName: '应收账款', subjectId: 174626, accountStatus: 0, accountWb: false,
  auxiliaryItemIds: '191501', auxiliaryItemName: '淘云科技', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
  money: 0.03, balance: 0.03, categoryName: '收-其他收入', remark: '' }
const input = validateOpenItemPreparation({ direction: query.direction, accountId: '174626', categoryId: '578250',
  auxiliaryCategoryCode: '01', auxiliaryItemId: '191501', amount: '0.03', date: row.date, summary: row.abstractStr, keeperName: '施' }, 10000)
function project(rows: object[] = [row]) {
  const raw = { count: rows.length, list: rows }
  return projectOpenItemAccountReferences(raw, projectOpenItems(raw, query, ledger, 100, 65536), 65536)
}
afterEach(() => vi.unstubAllGlobals())

it('retains exact source rows and page scope without claiming an account inventory', () => {
  const result = project()
  expect(result).toMatchObject({ ledgerId: ledger.id, ledgerName: ledger.name, query,
    source: 'existing-open-item-page', coverage: 'returned-page-only', observations: [{ sourceRecordId: '72595',
      id: '174626', name: '应收账款', status: 'enabled', foreignCurrency: false, currencyCode: 'RMB', baseCurrencyCode: 'RMB' }] })
  expect(resolveObservedOpenItemAccount(result, ledger, 'receivable', input.accountId)).toEqual(result.observations[0])
  expect(project([]).observations).toEqual([])
  expect(() => resolveObservedOpenItemAccount(project([]), ledger, 'receivable', input.accountId)).toThrow('未返回')
})

it('retains unknown attributes instead of enabling an account or inferring base currency', () => {
  const result = project([{ ...row, subjectId: null, accountStatus: null, accountWb: null }])
  expect(result.observations[0]).toMatchObject({ id: null, status: 'unknown', foreignCurrency: null })
  for (const extra of [{ accountStatus: undefined }, { accountStatus: 1 }, { accountWb: undefined },
    { accountWb: true }, { currencyCode: 'USD' }, { baseCurrencyCode: '' }]) {
    expect(() => resolveObservedOpenItemAccount(project([{ ...row, ...extra }]), ledger, 'receivable', input.accountId)).toThrow()
  }
})

it('rejects wrong ledger/direction and conflicting observations for the selected account', () => {
  const references = project()
  expect(() => resolveObservedOpenItemAccount(references, { ...ledger, id: '35601' }, 'receivable', input.accountId)).toThrow('账套')
  expect(() => resolveObservedOpenItemAccount(references, { ...ledger, name: '其他' }, 'receivable', input.accountId)).toThrow('账套')
  expect(() => resolveObservedOpenItemAccount(references, ledger, 'payable', input.accountId)).toThrow('方向')
  for (const extra of [{ accountStatus: 1 }, { accountWb: true }, { subjectName: '改名' }, { currencyCode: 'USD' }]) {
    const changed = project([row, { ...row, id: 72596, ...extra }])
    expect(() => resolveObservedOpenItemAccount(changed, ledger, 'receivable', input.accountId)).toThrow('不一致')
  }
  expect(resolveObservedOpenItemAccount(project([row, { ...row, id: 72596 }]), ledger, 'receivable', input.accountId).id).toBe('174626')
})

it('rejects invalid wire types, unsafe IDs, mismatched raw rows and oversized observations', () => {
  for (const extra of [{ accountStatus: '0' }, { accountWb: 'false' }, { subjectId: 0 },
    { subjectId: Number.MAX_SAFE_INTEGER + 1 }, { subjectId: '9007199254740992' }]) {
    expect(() => project([{ ...row, ...extra }])).toThrow()
  }
  const raw = { count: 1, list: [row] }
  const page = projectOpenItems(raw, query, ledger, 100, 65536)
  expect(() => projectOpenItemAccountReferences({ list: [] }, page, 65536)).toThrow('不一致')
  expect(() => projectOpenItemAccountReferences({ list: [row, row] }, page, 65536)).toThrow('不一致')
  expect(() => projectOpenItemAccountReferences(raw, page, 10)).toThrow('大小限制')
})

it.each(['receivable', 'payable'] as const)('reads one explicit %s public page without cash-account or private endpoint fallback', async (direction) => {
  const fetch = vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: ledger.id, sobName: ledger.name }] })
    expect(url.pathname).toBe('/finance/cashjournal/getCashierList')
    if (typeof init.body !== 'string') throw new Error('Expected JSON')
    expect(JSON.parse(init.body)).toEqual({ setOfBooksId: 35616, direction: direction === 'receivable' ? 0 : 1,
      periodNumberStart: '2022-01', periodNumberEnd: '2022-01', page: 1, pageSize: 100 })
    return Response.json({ result: 100, data: { count: 1, list: [row] } })
  })
  vi.stubGlobal('fetch', fetch)
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const references = await adapter.queryObservedOpenItemAccounts({ system: 'youcheng', environment: 'test', appKey: 'fake-key', accountCode: ledger.id },
    'fake-secret', { ...query, direction }, new AbortController().signal, 100, 65536)
  expect(references.observations[0]?.id).toBe('174626')
  expect(references.query.direction).toBe(direction)
  expect(fetch).toHaveBeenCalledTimes(3)
})

it.each(['receivable', 'payable'] as const)('prepares %s from current account, category and qualified counterparty identities', async (direction) => {
  const payable = direction === 'payable'
  const proposal = validateOpenItemPreparation({ ...input, direction, accountReferenceQuery: { ...query, direction },
    accountId: payable ? '174624' : '174626', categoryId: payable ? '578260' : '578250',
    auxiliaryCategoryCode: payable ? '02' : '01', auxiliaryItemId: payable ? '191573' : '191501' }, 65536)
  for (const mode of ['valid', 'missing-account', 'disabled-account', 'foreign-account', 'wrong-category-direction', 'duplicate-category', 'changed-auxiliary']) {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
      if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: ledger.id, sobName: ledger.name }] })
      if (url.pathname === '/finance/cashjournal/getCashierList') return Response.json({ result: 100, data: {
        count: mode === 'missing-account' ? 0 : 1, list: mode === 'missing-account' ? [] : [{ ...row, subjectId: Number(proposal.accountId),
          subjectName: payable ? '应付账款' : '应收账款', accountStatus: mode === 'disabled-account' ? 1 : 0, accountWb: mode === 'foreign-account' }] } })
      if (url.pathname === '/finance/cashjournal/getCategoryList.rjson') {
        const category = { id: Number(proposal.categoryId), code: '01', name: payable ? '其他支出' : '其他收入',
          type: mode === 'wrong-category-direction' ? payable ? 0 : 1 : payable ? 1 : 0 }
        return Response.json({ result: 100, data: [category, ...mode === 'duplicate-category' ? [{ ...category, id: 2 }] : []] })
      }
      if (url.pathname === '/finance/auxiliary/queryAuxiliaryCategoryList.rjson') return Response.json({ result: 100,
        data: [{ id: 101, categoryCode: proposal.auxiliaryCategoryCode, categoryName: payable ? '供应商' : '客户' }] })
      expect(url.pathname).toBe('/finance/auxiliary/queryAuxiliaryItemList.rjson')
      return Response.json({ result: 100, data: [{ id: Number(proposal.auxiliaryItemId), itemCode: '03', itemName: '往来测试',
        categoryId: mode === 'changed-auxiliary' ? 102 : 101 }] })
    }))
    const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
    const pending = adapter.prepareOpenItem({ system: 'youcheng', environment: 'test', appKey: 'fake-key', accountCode: ledger.id },
      'fake-secret', proposal, new AbortController().signal, 100, 65536)
    if (mode !== 'valid') { await expect(pending).rejects.toThrow(); continue }
    const preview = await pending
    expect(preview.references).toMatchObject({ accountId: proposal.accountId, categoryId: proposal.categoryId,
      currencyCode: 'RMB', counterparty: { itemId: proposal.auxiliaryItemId, wireName: `${payable ? '供应商' : '客户'}:往来测试` } })
    expect(preview.input.accountReferenceQuery).toEqual({ ...query, direction })
    expect(preview.notice).toContain('不是完整账户目录')
  }
})

it('requires an explicit same-direction source page before preparation performs a read', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  for (const proposal of [input, { ...input, accountReferenceQuery: { ...query, direction: 'payable' as const } }]) {
    await expect(adapter.prepareOpenItem({ system: 'youcheng', environment: 'test', appKey: 'fake-key', accountCode: ledger.id },
      'fake-secret', proposal, new AbortController().signal, 100, 65536)).rejects.toThrow('来源查询页')
  }
  expect(fetch).not.toHaveBeenCalled()
})
