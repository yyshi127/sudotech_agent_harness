import { expect, it, vi } from 'vitest'
import { collectWriteOffJournalLink, type WriteOffJournalPage } from '../src/open-item-write-off-journal.ts'
import { validateOpenItemWriteOff, type OpenItemWriteOffReceiptId } from '../src/open-item-write-off.ts'
import { projectOpenItems } from '../src/open-items.ts'
import { projectJournals, type JournalQuery } from '../src/journals.ts'

const ledger = { id: '35616', name: '测试账套' }
const receipt = '65833' as OpenItemWriteOffReceiptId
const limits = { maxRows: 10, maxBytes: 100000 }
function fixture(direction: 'receivable' | 'payable' = 'receivable') {
  const input = validateOpenItemWriteOff({ direction, openItemId: '72606', cashAccountId: '174622', amount: '0.02',
    currencyCode: 'RMB', date: '2022-01-09', keeperName: '测试',
    sourceQuery: { direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 1 } }, limits.maxBytes)
  const source = projectOpenItems({ count: 1, list: [{ id: 72606, setOfBooksId: 35616, date: '2022-01-09', abstractStr: '测试核销',
    subjectCode: '', subjectName: '往来', auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户', currencyCode: 'RMB',
    baseCurrencyCode: 'RMB', money: 0.02, balance: 0.02, thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0,
    initialBalance: false, isFinish: false, categoryName: '测试', remark: '' }] }, input.sourceQuery, ledger, 10, limits.maxBytes)
  const journal = { id: 141108, relationId: 65833, channel: 'WRITE_OFF', subjectId: 174622, auxiliaryItemIds: '191501',
    date: input.date, abstractStr: '测试流水', accountCode: '1001', accountName: '库存现金', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
    borrow: direction === 'receivable' ? 0.02 : 0, loan: direction === 'payable' ? 0.02 : 0, balance: 0.02,
    baseBorrow: direction === 'receivable' ? 0.02 : 0, baseLoan: direction === 'payable' ? 0.02 : 0, baseBalance: 0.02,
    categoryName: '测试', keeperName: '测试' }
  return { input, source, journal }
}
function page(rows: unknown[], query: JournalQuery, count: unknown): WriteOffJournalPage {
  return { result: projectJournals(rows, query, ledger, 10, limits.maxBytes), raw: rows, totalCount: count }
}

it.each(['receivable', 'payable'] as const)('matches a unique %s receipt after two counted passes, not by journal ID', async (direction) => {
  const { input, source, journal } = fixture(direction)
  const records = [{ ...journal, id: 141107, relationId: undefined, channel: 'ADD' }, journal]
  const read = vi.fn(async (query: JournalQuery) => page(records.slice(query.page - 1, query.page), query, 2))
  expect(await collectWriteOffJournalLink(input, source, receipt, read, new AbortController().signal, limits))
    .toEqual({ state: 'matched', receiptId: receipt, journalId: '141108' })
  expect(read.mock.calls.map(([query]) => query.page)).toEqual([1, 2, 3, 1, 2, 3])
})

it.each([
  { channel: 'ADD' }, { subjectId: 174623 }, { auxiliaryItemIds: 'other' }, { date: '2022-01-10' },
  { currencyCode: 'USD' }, { baseCurrencyCode: 'USD' }, { borrow: 0.03 }, { loan: 0.01 },
])('reports conflicting receipt-linked content %# without claiming settlement', async (change) => {
  const { input, source, journal } = fixture()
  const read = async (query: JournalQuery) => page(query.page === 1 ? [{ ...journal, ...change }] : [], query, 1)
  expect(await collectWriteOffJournalLink(input, source, receipt, read, new AbortController().signal, limits)).toEqual({ state: 'mismatch' })
})

it.each([{ relationId: undefined }, { relationId: '65834' }, { channel: undefined }, { subjectId: undefined },
  { auxiliaryItemIds: undefined }, { relationId: 9007199254740992 }])('keeps missing or unqualified raw relation metadata unavailable %#', async (change) => {
  const { input, source, journal } = fixture()
  const read = async (query: JournalQuery) => page(query.page === 1 ? [{ ...journal, ...change }] : [], query, 1)
  expect(await collectWriteOffJournalLink(input, source, receipt, read, new AbortController().signal, limits)).toEqual({ state: 'unavailable' })
})

it.each(['missing-count', 'wrong-count', 'count-changed', 'duplicate-id', 'raw-missing', 'wrong-ledger', 'wrong-page',
  'extra-filter', 'changed-second-pass', 'no-empty-page', 'failed-query'] as const)('refuses incomplete or unstable inventories: %s', async (mode) => {
  const { input, source, journal } = fixture()
  let calls = 0
  const read = async (query: JournalQuery) => {
    calls++
    if (mode === 'failed-query') throw new Error('offline')
    const rows = query.page === 1 || mode === 'duplicate-id' || mode === 'no-empty-page' ? [
      { ...journal, id: mode === 'no-empty-page' ? 141108 + query.page : 141108,
        relationId: mode === 'changed-second-pass' && calls > 2 ? 65834 : 65833 },
    ] : []
    const result = page(rows, query, mode === 'missing-count' ? undefined
      : mode === 'wrong-count' || mode === 'count-changed' && query.page > 1 ? 2 : 1)
    if (mode === 'raw-missing') result.raw = []
    if (mode === 'wrong-ledger') result.result.accountId = '35601'
    if (mode === 'wrong-page') result.result.selection.page++
    if (mode === 'extra-filter') result.result.selection.cashAccountId = '174622'
    return result
  }
  await expect(collectWriteOffJournalLink(input, source, receipt, read, new AbortController().signal, limits)).rejects.toThrow()
})

it('keeps duplicated receipt relations unavailable even when the two business IDs differ', async () => {
  const { input, source, journal } = fixture()
  const read = async (query: JournalQuery) => page(query.page < 3 ? [{ ...journal, id: 141107 + query.page }] : [], query, 2)
  expect(await collectWriteOffJournalLink(input, source, receipt, read, new AbortController().signal, limits)).toEqual({ state: 'unavailable' })
})

it('enforces row, accumulated byte and cancellation bounds before returning a link', async () => {
  const { input, source, journal } = fixture()
  const read = vi.fn(async (query: JournalQuery) => page(query.page === 1 ? [journal] : [], query, 1))
  await expect(collectWriteOffJournalLink(input, source, receipt, read, new AbortController().signal,
    { ...limits, maxRows: 0 })).rejects.toThrow()
  await expect(collectWriteOffJournalLink(input, source, receipt, read, new AbortController().signal,
    { ...limits, maxBytes: 1 })).rejects.toThrow('大小')
  const stop = new AbortController(); stop.abort()
  read.mockClear()
  await expect(collectWriteOffJournalLink(input, source, receipt, read, stop.signal, limits)).rejects.toThrow()
  expect(read).not.toHaveBeenCalled()
})
