import { afterEach, expect, it, vi } from 'vitest'
import { YouchengConnection } from '../src/youcheng.ts'
import { classifyOpenItemSubmission, compareOpenItemReadback } from '../src/open-item-submission.ts'
import { validateOpenItemPreparation, resolveOpenItemCounterparty } from '../src/open-item-preparation.ts'
import { projectReferences } from '../src/references.ts'
import { projectOpenItems } from '../src/open-items.ts'

const ledger = { id: '35616', name: '施的演示账套' }
afterEach(() => vi.unstubAllGlobals())
const fixture = (direction: 'receivable' | 'payable' = 'receivable') => {
  const payable = direction === 'payable'
  const input = validateOpenItemPreparation({ direction, accountId: payable ? '174624' : '174626',
    categoryId: payable ? '578260' : '578250', auxiliaryCategoryCode: payable ? '02' : '01',
    auxiliaryItemId: payable ? '191573' : '191501', amount: payable ? '0.05' : '0.03',
    date: '2022-01-09', summary: 'F3回查测试', keeperName: '施' }, 8192)
  const categories = projectReferences([{ id: 101, categoryCode: input.auxiliaryCategoryCode,
    categoryName: payable ? '供应商' : '客户' }], { kind: 'auxiliary-categories' }, ledger, 100, 65536)
  const items = projectReferences([{ id: input.auxiliaryItemId, itemCode: '03', itemName: '往来测试' }],
    { kind: 'auxiliary-items', categoryCode: input.auxiliaryCategoryCode }, ledger, 100, 65536, '101')
  const selection = { ledgerId: ledger.id, ledgerName: ledger.name, accountName: payable ? '应付账款' : '应收账款',
    currencyCode: 'RMB', counterparty: resolveOpenItemCounterparty(input, ledger, categories, items) }
  const raw = { count: 1, list: [{ id: 72595, setOfBooksId: 35616, date: input.date, abstractStr: input.summary,
    money: input.amount, balance: input.amount, currencyCode: 'RMB', baseCurrencyCode: 'RMB', subjectCode: '',
    subjectName: selection.accountName, auxiliaryItemIds: input.auxiliaryItemId, auxiliaryItemName: '往来测试',
    thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0, initialBalance: false, isFinish: false,
    categoryName: payable ? '支-其他支出' : '收-其他收入', remark: '', subjectId: Number(input.accountId),
    categoryId: Number(input.categoryId), keeperName: input.keeperName, attachList: [], certificateWordAndCode: '', orderCode: '' }] }
  const page = projectOpenItems(raw, { direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 },
    ledger, 1000, 65536)
  return { input, selection, raw, page }
}

it.each(['receivable', 'payable'] as const)('compares %s content, original associations and outstanding balance separately', (direction) => {
  const { page, raw, input, selection } = fixture(direction)
  expect(compareOpenItemReadback(page, raw, '72595', input, selection)).toEqual({ content: 'matched',
    associations: 'matched', balance: 'matched', complete: true })
  const withTotal = { ...raw, list: [...raw.list, { id: -1 }] }
  expect(compareOpenItemReadback(page, withTotal, '72595', input, selection).complete).toBe(true)
})

it('does not match another record, ledger or direction by summary', () => {
  const { page, raw, input, selection } = fixture()
  expect(compareOpenItemReadback(page, raw, '72596', input, selection).content).toBe('unavailable')
  for (const changed of [{ ...page, accountId: '35601' }, { ...page, accountName: '其他' },
    { ...page, selection: { ...page.selection, direction: 'payable' as const } }]) {
    expect(compareOpenItemReadback(changed, raw, '72595', input, selection)).toMatchObject({ content: 'mismatch', complete: false })
  }
})

it('keeps absent associations unavailable and rejects wrong account/category/maker or unexpected links', () => {
  const { page, raw, input, selection } = fixture()
  expect(compareOpenItemReadback(page, {}, '72595', input, selection)).toMatchObject({ associations: 'unavailable', complete: false })
  for (const extra of [{ subjectId: 174622 }, { categoryId: 1 }, { keeperName: '其他人' },
    { attachList: [{}] }, { certificateWordAndCode: '记-001' }, { orderCode: '销售单1' }]) {
    const changed = { ...raw, list: [{ ...raw.list[0], ...extra }] }
    expect(compareOpenItemReadback(page, changed, '72595', input, selection).associations).toBe('mismatch')
  }
  for (const extra of [{ auxiliaryItemIds: '191502' }, { auxiliaryItemName: '同名并非同一人' }, { subjectName: '其他账户' }]) {
    const changed = { ...page, rows: page.rows.map(row => ({ ...row, ...extra })) }
    expect(compareOpenItemReadback(changed, raw, '72595', input, selection).associations).toBe('mismatch')
  }
})

it('does not convert missing settlement values to zero or call changed balances unchanged', () => {
  const { page, raw, input, selection } = fixture()
  for (const extra of [{ settledAmount: null }, { badDebtAmount: null }, { initialBalance: null }, { finished: null }]) {
    const changed = { ...page, rows: page.rows.map(row => ({ ...row, ...extra })) }
    expect(compareOpenItemReadback(changed, raw, '72595', input, selection)).toMatchObject({ balance: 'unavailable', complete: false })
  }
  for (const extra of [{ balance: '0.01' }, { settledAmount: '0.02' }, { offsetAmount: '0.02' }, { finished: true }]) {
    const changed = { ...page, rows: page.rows.map(row => ({ ...row, ...extra })) }
    expect(compareOpenItemReadback(changed, raw, '72595', input, selection).balance).toBe('mismatch')
  }
  for (const extra of [{ amount: '0.04' }, { date: '2022-01-10' }, { summary: '别的记录' }, { currencyCode: 'USD' }]) {
    const changed = { ...page, rows: page.rows.map(row => ({ ...row, ...extra })) }
    expect(compareOpenItemReadback(changed, raw, '72595', input, selection).content).toBe('mismatch')
  }
})

it('classifies only explicit public results and never exposes vendor messages', () => {
  expect(classifyOpenItemSubmission({ result: 100, data: '72595', message: 'secret' }, true)).toEqual({ state: 'accepted', openItemId: '72595' })
  expect(classifyOpenItemSubmission({ result: 201, message: 'secret' }, true)).toEqual({ state: 'rejected', code: 201 })
  for (const value of [{ result: 100 }, { result: 100, data: 72595 }, { result: 100, data: '0' },
    { result: 100, data: '9'.repeat(201) }, { result: 300 }, {}, { result: '100', data: '72595' }]) {
    expect(classifyOpenItemSubmission(value, true)).toEqual({ state: 'outcome-unknown' })
  }
  expect(classifyOpenItemSubmission({ result: 100, data: '72595' }, false)).toEqual({ state: 'outcome-unknown' })
})

it.each(['receivable', 'payable'] as const)('finds an accepted %s through bounded public readback without writes', async (direction) => {
  const { raw, input, selection } = fixture(direction)
  const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: ledger.id }
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  for (const mode of ['found', 'missing', 'repeated', 'failed', 'capped', 'wrong-ledger', 'renamed-ledger']) {
    let reads = 0
    const fetch = vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
      if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100,
        data: [{ id: ledger.id, sobName: mode === 'renamed-ledger' ? '其他账套' : ledger.name }] })
      expect(url.pathname).toBe('/finance/cashjournal/getCashierList')
      if (typeof init.body !== 'string') throw new Error('Expected JSON')
      expect(JSON.parse(init.body)).toMatchObject({ setOfBooksId: 35616, direction: direction === 'receivable' ? 0 : 1,
        periodNumberStart: '2022-01', periodNumberEnd: '2022-01', pageSize: 1 })
      reads += 1
      if (mode === 'failed') throw new Error('query unavailable')
      const list = mode === 'missing' ? [] : [{ ...raw.list[0], id: mode === 'capped' ? reads
        : mode === 'repeated' || reads === 1 ? 12 : 72595 }]
      return Response.json({ result: 100, data: { count: 3, list } })
    })
    vi.stubGlobal('fetch', fetch)
    const result = await adapter.querySubmittedOpenItem(mode === 'wrong-ledger' ? { ...config, accountCode: '35601' } : config,
      'fake-secret', '72595', input, selection, new AbortController().signal, { maxRows: 3, pageSize: 1, maxBytes: 65536 })
    expect(result.complete).toBe(mode === 'found')
    expect(reads).toBeLessThanOrEqual(3)
    if (mode === 'wrong-ledger') expect(fetch).not.toHaveBeenCalled()
    if (mode === 'renamed-ledger') expect(result.content).toBe('mismatch')
  }
})
