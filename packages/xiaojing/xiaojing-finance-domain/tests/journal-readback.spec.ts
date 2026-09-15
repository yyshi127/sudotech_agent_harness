import { afterEach, expect, it, vi } from 'vitest'
import { compareJournalReadback } from '../src/journal-submission.ts'
import { validateJournalPreparation } from '../src/journal-preparation.ts'
import { projectJournals } from '../src/journals.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const account = { id: '35616', name: '测试账套' }
const input = validateJournalPreparation({ cashAccountId: '174622', date: '2022-01-01', direction: 'income',
  amount: '0.11', summary: 'F3A测试', keeperName: '小兢测试' }, 10000)
const selection = { accountId: account.id, accountName: account.name, cashAccountId: input.cashAccountId,
  cashAccountCode: '1001', cashAccountName: '库存现金' }
const query = { month: '2022-01', dateStart: input.date, dateEnd: input.date, cashAccountId: input.cashAccountId, page: 1, pageSize: 10 }
const raw = { id: 253183, subjectId: 174622, date: input.date, abstractStr: input.summary, keeperName: input.keeperName,
  accountCode: '', accountName: '', subjectName: '库存现金', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
  borrow: 0.11, categoryName: '', preId: 0, reviewStatus: 0, reviewUser: '', reviewUserId: '',
  certificateWordAndCode: '', cashManagementId: '', auxiliaryItemIds: '', orderCode: '', relationOrderCodeList: [], attachList: [] }
const compare = (value: unknown = raw) => compareJournalReadback(projectJournals([value], query, account, 100, 10000),
  [value], '253183', input, selection, '0')
afterEach(() => vi.unstubAllGlobals())

it('matches exact record identity and content with an omitted inactive side, without inventing an amount', () => {
  expect(compare()).toEqual({ content: 'matched', associations: 'matched', complete: true })
  expect(compare({ ...raw, loan: 0 })).toEqual({ content: 'matched', associations: 'matched', complete: true })
  expect(compare({ ...raw, borrow: 0.12 })).toEqual({ content: 'mismatch', associations: 'matched', complete: false })
  expect(compare({ ...raw, loan: 0.01 }).complete).toBe(false)
  expect(compare({ ...raw, categoryName: '其他' }).complete).toBe(false)
})

it('does not verify missing IDs, wrong ledgers, absent audit fields or unexpected associations', () => {
  const page = projectJournals([raw], query, account, 100, 10000)
  expect(compareJournalReadback(page, [raw], '999', input, selection, '0').content).toBe('unavailable')
  expect(compareJournalReadback({ ...page, accountId: '35601' }, [raw], '253183', input, selection, '0').content).toBe('mismatch')
  expect(compare({ ...raw, reviewStatus: undefined }).associations).toBe('unavailable')
  for (const extra of [{ preId: 3 }, { reviewStatus: 1 }, { certificateId: 4 }, { tempCertificateId: 5 },
    { certificateWordAndCode: '记-1' }, { cashManagementId: '4' }, { auxiliaryItemIds: '5' },
    { relationOrderCodeList: ['order'] }, { attachList: [{ fileId: '1' }] }]) {
    expect(compare({ ...raw, ...extra }).associations).toBe('mismatch')
  }
})

it('compares selected category IDs rather than vendor direction-prefixed display names', () => {
  const selected = validateJournalPreparation({ ...input, categoryId: '578250' }, 10000)
  const references = { ...selection, categoryName: '其他收入' }
  const value = { ...raw, categoryId: 578250, categoryName: '收-其他收入' }
  const page = projectJournals([value], query, account, 100, 10000)
  expect(compareJournalReadback(page, [value], '253183', selected, references, '0').complete).toBe(true)
  expect(compareJournalReadback(page, [{ ...value, categoryId: 578251 }], '253183', selected, references, '0').content).toBe('mismatch')
  expect(compareJournalReadback(page, [{ ...value, categoryId: undefined }], '253183', selected, references, '0').content).toBe('unavailable')
})

it.each(['found', 'missing', 'repeated', 'failed'] as const)('bounds the read-only accepted-ID lookup with %s pages', async (mode) => {
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
    if (url.pathname.includes('getAccountList')) return Response.json({ result: 100, data: [{ accountId: 174622 }] })
    expect(url.pathname).toBe('/finance/cashjournal/getListPage.rjson')
    if (typeof init.body !== 'string') throw new Error('Expected JSON')
    const body: unknown = JSON.parse(init.body)
    expect(body).toMatchObject({ dateStart: input.date, dateEnd: input.date, subjectId: 174622, pageSize: 1 })
    reads += 1
    if (mode === 'failed') throw new Error('read unavailable')
    const rows = mode === 'missing' ? [] : [{ ...raw, id: mode === 'repeated' || reads === 1 ? 12 : 253183 }]
    return Response.json({ result: 100, data: rows })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const result = await adapter.querySubmittedJournal({ system: 'youcheng', environment: 'test', appKey: 'fake-key', accountCode: '35616' },
    'fake-secret', '253183', input, selection, '0', new AbortController().signal, { maxRows: 3, pageSize: 1, maxBytes: 10000 })
  expect(result.complete).toBe(mode === 'found')
  expect(reads).toBeLessThanOrEqual(2)
})
