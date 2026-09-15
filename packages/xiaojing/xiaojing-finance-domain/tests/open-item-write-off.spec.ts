import { expect, it } from 'vitest'
import { compareOpenItemWriteOff, readOpenItemWriteOffIdentity, selectBaseCurrencyWriteOffCash,
  selectOpenItemWriteOffTarget, validateOpenItemWriteOff } from '../src/open-item-write-off.ts'
import { projectOpenItems, type OpenItemQuery } from '../src/open-items.ts'
import { projectReferences } from '../src/references.ts'

const ledger = { id: '35616', name: '测试账套' }
const query: OpenItemQuery = { direction: 'receivable', periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 2 }
const proposal = { direction: 'receivable', openItemId: '72602', cashAccountId: '174622', amount: '0.19',
  currencyCode: 'RMB', date: '2022-01-02', keeperName: '测试制单人', sourceQuery: query }
const raw = { id: 72602, setOfBooksId: 35616, date: '2022-01-01', abstractStr: '核销检查专用',
  subjectCode: '', subjectName: '往来账户', auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户',
  currencyCode: 'RMB', baseCurrencyCode: 'RMB', money: 0.19, balance: 0.19,
  thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0,
  initialBalance: false, isFinish: false, categoryName: '其他收入', remark: '' }
const page = (rows: unknown[] = [raw], selection = query) =>
  projectOpenItems({ count: rows.length, list: rows }, selection, ledger, 20, 65536)

it.each(['receivable', 'payable'] as const)('qualifies %s cash through current base-only subject configuration', (direction) => {
  const selection = { ...query, direction }
  const input = validateOpenItemWriteOff({ ...proposal, direction, sourceQuery: selection }, 65536)
  const cash = projectReferences([{ accountId: 174622, accountName: '现金', subjectCode: '1001', status: 0,
    currencyId: 120455 }], { kind: 'cash-accounts' }, ledger, 20, 65536)
  const subjects = projectReferences([{ subjectCode: '1001', subjectName: '现金', enableStatus: 1,
    hasChild: false, currencyList: [] }], { kind: 'subjects', code: '1001' }, ledger, 20, 65536)
  expect(selectBaseCurrencyWriteOffCash(input, page([raw], selection), cash, subjects)).toMatchObject({
    currencyCode: 'RMB', cashAccount: { id: '174622' }, subject: { code: '1001' },
  })
  for (const changed of [
    { ...subjects, accountId: '35601' },
    { ...subjects, rows: [] },
    { ...subjects, rows: subjects.rows.map(row => ({ ...row, code: '1002' })) },
    { ...subjects, rows: subjects.rows.map(row => ({ ...row, status: 'disabled' as const })) },
    { ...subjects, rows: subjects.rows.map(row => ({ ...row, hasChildren: true })) },
    { ...subjects, rows: subjects.rows.map(row => ({ ...row, currencyCodes: ['RMB', 'USD'] })) },
    { ...subjects, rows: subjects.rows.map(({ currencyCodes: _codes, ...row }) => row) },
  ]) expect(() => selectBaseCurrencyWriteOffCash(input, page([raw], selection), cash, changed)).toThrow()
  const foreign = page([{ ...raw, currencyCode: 'USD' }], selection)
  expect(() => selectBaseCurrencyWriteOffCash({ ...input, currencyCode: 'USD' }, foreign, cash, subjects)).toThrow()
})

it.each([
  { subjectId: 174626, expected: '174626' }, { subjectId: '174626', expected: '174626' },
  { subjectId: undefined, expected: undefined }, { subjectId: 0, expected: undefined },
  { subjectId: '9007199254740992', expected: undefined },
])('observes settled identity independently of open-state eligibility %#', ({ subjectId, expected }) => {
  const row = { ...raw, subjectId, isFinish: true, balance: 0, thisMoney: 0.19 }
  expect(readOpenItemWriteOffIdentity({ list: [row] }, page([row]), '72602')).toBe(expected)
})

it('does not infer identity from absence, duplicate targets or another ledger', () => {
  const row = { ...raw, subjectId: 174626 }
  for (const list of [[], [row, row], [{ ...row, setOfBooksId: 35601 }]]) {
    expect(readOpenItemWriteOffIdentity({ list }, page(), '72602')).toBeUndefined()
  }
})

it.each(['receivable', 'payable'] as const)('selects the full %s balance but never calls it payment or proven operation', (direction) => {
  const selection = { ...query, direction }
  const input = validateOpenItemWriteOff({ ...proposal, direction, sourceQuery: selection }, 65536)
  const before = page([raw], selection)
  expect(selectOpenItemWriteOffTarget(input, before, ledger).id).toBe('72602')
  const after = page([{ ...raw, balance: 0, thisMoney: 0.19, isFinish: true }], selection)
  expect(compareOpenItemWriteOff(input, before, after)).toEqual({ content: 'matched', settlement: 'matched', operation: 'unverified' })
})

it.each([
  { amount: '0.00' }, { amount: '-0.19' }, { amount: 0.19 }, { amount: '0.199' }, { amount: '1e2' },
  { amount: '90071992547409.91' }, { openItemId: '9007199254740992' }, { openItemId: '-1' },
  { cashAccountId: '0' }, { cashAccountId: '现金' }, { date: '2022-02-30' }, { keeperName: ' ' },
  { direction: 'payable' }, { journalId: '141107' }, { resource: 3 }, { type: 2 },
  { approved: true }, { booksName: '其他账套' }, { endpoint: '/arbitrary' },
])('rejects unsafe or unsupported local intent %#', (change) => {
  expect(() => validateOpenItemWriteOff({ ...proposal, ...change }, 65536)).toThrow()
})

it('enforces the normalized complete byte limit including multibyte text', () => {
  const input = validateOpenItemWriteOff(proposal, 65536)
  const bytes = Buffer.byteLength(JSON.stringify(input))
  expect(validateOpenItemWriteOff(proposal, bytes)).toEqual(input)
  expect(() => validateOpenItemWriteOff(proposal, bytes - 1)).toThrow('大小')
})

it.each([
  { balance: 0.18 }, { balance: 0.20 }, { money: -0.19 }, { isFinish: true }, { isFinish: undefined },
  { initialBalance: true }, { initialBalance: undefined }, { currencyCode: 'USD' }, { date: '2022-02-01' },
  { thisMoney: '' }, { badMoney: null }, { hedgeMoney: undefined }, { returnMoney: '' },
])('refuses changed amount, range, state or missing components %#', (change) => {
  expect(() => selectOpenItemWriteOffTarget(validateOpenItemWriteOff(proposal, 65536), page([{ ...raw, ...change }]), ledger)).toThrow()
})

it('rejects wrong ledger, different source page, missing target and an earlier settlement date', () => {
  const input = validateOpenItemWriteOff(proposal, 65536)
  expect(() => selectOpenItemWriteOffTarget(input, page(), { ...ledger, id: '35601' })).toThrow('账套')
  expect(() => selectOpenItemWriteOffTarget(input, page([], { ...query, page: 2 }), ledger)).toThrow('范围')
  expect(() => selectOpenItemWriteOffTarget(input, page([]), ledger)).toThrow('不存在')
  const early = validateOpenItemWriteOff({ ...proposal, date: '2021-12-31' }, 65536)
  expect(() => selectOpenItemWriteOffTarget(early, page(), ledger)).toThrow('日期')
})

it.each([
  { balance: 0.01 }, { thisMoney: 0.18 }, { thisMoney: 0.20 }, { isFinish: false },
  { badMoney: 0.01 }, { hedgeMoney: 0.01 }, { returnMoney: 0.01 },
])('does not accept a zero or changed balance alone as expected settlement %#', (change) => {
  const after = page([{ ...raw, balance: 0, thisMoney: 0.19, isFinish: true, ...change }])
  expect(compareOpenItemWriteOff(validateOpenItemWriteOff(proposal, 65536), page(), after).settlement).toBe('mismatch')
})

it.each([{ thisMoney: '' }, { badMoney: null }, { hedgeMoney: undefined }, { isFinish: undefined }])(
  'keeps incomplete readback unavailable %#', (change) => {
    const after = page([{ ...raw, balance: 0, thisMoney: 0.19, isFinish: true, ...change }])
    expect(compareOpenItemWriteOff(validateOpenItemWriteOff(proposal, 65536), page(), after).settlement).toBe('unavailable')
  })

it('keeps absence and failed reads unknown and rejects unrelated ledger, direction or content', () => {
  const input = validateOpenItemWriteOff(proposal, 65536)
  expect(compareOpenItemWriteOff(input, page(), undefined).settlement).toBe('unavailable')
  expect(compareOpenItemWriteOff(input, page(), page([])).settlement).toBe('unavailable')
  expect(compareOpenItemWriteOff(input, page(), { ...page(), accountId: '35601' }).content).toBe('mismatch')
  expect(compareOpenItemWriteOff(input, page(), page([raw], { ...query, direction: 'payable' })).content).toBe('mismatch')
  expect(compareOpenItemWriteOff(input, page(), page([{ ...raw, abstractStr: '被修改' }])).content).toBe('mismatch')
})
