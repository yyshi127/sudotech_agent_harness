import { expect, it } from 'vitest'
import { buildJournalSubmission, resolveJournalReferences, validateJournalPreparation } from '../src/journal-preparation.ts'
import { projectReferences } from '../src/references.ts'

const account = { id: '35616', name: '施的演示账套' }
const input = { cashAccountId: '174553', date: '2022-01-01', direction: 'income', amount: '0.20',
  summary: ' F3A合成日记账 ', keeperName: '小兢测试' }
const prepare = (value: unknown = input) => validateJournalPreparation(value, 8192)
const cash = (status: number | undefined = 0) => projectReferences([
  { accountId: 174553, accountName: '现金测试', subjectCode: '1001', status },
], { kind: 'cash-accounts' }, account, 100, 65536)
const categories = () => projectReferences([{ id: 3, code: '03', name: '测试收入', type: 0 },
  { id: 4, code: '04', name: '测试支出', type: 1 }], { kind: 'cash-categories' }, account, 100, 65536)

it('maps income and expense to one active money side and uses the cash account ID', () => {
  for (const direction of ['income', 'expense']) {
    const value = prepare({ ...input, direction })
    const selection = resolveJournalReferences(value, account, cash())
    expect(buildJournalSubmission(value, selection, '0')).toEqual({ accountName: account.name,
      subjectId: 174553, date: input.date, abstractStr: 'F3A合成日记账', keeperName: input.keeperName,
      borrow: direction === 'income' ? 0.2 : null, loan: direction === 'expense' ? 0.2 : null, preId: 0 })
  }
})

it.each(['0.00', '-0.01', '1', '1.001', '1e2', 'NaN', '9007199254740993.01'])('rejects invalid or unsafe amount %s', (amount) => {
  expect(() => prepare({ ...input, amount })).toThrow()
})

it('rejects impossible dates, empty names, unknown fields and oversized proposals', () => {
  for (const extra of [{ date: '2022-02-29' }, { summary: ' ' }, { keeperName: '' }, { reviewUser: 'admin' },
    { subjectId: 1001 }, { cashAccountId: '9007199254740993' }, { amount: 0.2 }]) {
    expect(() => prepare({ ...input, ...extra })).toThrow()
  }
  const value = prepare()
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  expect(validateJournalPreparation(input, bytes)).toEqual(value)
  expect(() => validateJournalPreparation(input, bytes - 1)).toThrow('大小')
})

it('requires an enabled unique returned cash account in the same ledger', () => {
  const value = prepare()
  for (const result of [cash(1), { ...cash(), rows: [] }, { ...cash(), accountId: '35601' },
    { ...cash(), accountName: '其他账套' }, { ...cash(), rows: [...cash().rows, ...cash().rows] },
    { ...cash(), rows: cash().rows.map(row => ({ ...row, status: 'unknown' as const })) }]) {
    expect(() => resolveJournalReferences(value, account, result)).toThrow()
  }
})

it('retains returned currency, account type and direction without inventing missing attributes', () => {
  const accounts = projectReferences([{ accountId: 174553, accountName: '现金测试', subjectCode: '1001', status: 0,
    currencyId: 120455, type: 1, direction: false }], { kind: 'cash-accounts' }, account, 100, 65536)
  expect(resolveJournalReferences(prepare(), account, accounts)).toMatchObject({ cashAccountCurrencyId: '120455',
    cashAccountType: 1, cashAccountDirectionRaw: '0' })
  expect(resolveJournalReferences(prepare(), account, cash())).not.toHaveProperty('cashAccountCurrencyId')
})

it('resolves category names only for the selected direction and rejects ambiguous name mapping', () => {
  const value = prepare({ ...input, categoryId: '3' })
  const selection = resolveJournalReferences(value, account, cash(), categories())
  expect(buildJournalSubmission(value, selection, '42')).toMatchObject({ categoryName: '测试收入', preId: 42 })
  for (const result of [undefined, { ...categories(), accountId: '35601' },
    { ...categories(), rows: categories().rows.map(row => ({ ...row, name: '测试收入' })) }]) {
    expect(() => resolveJournalReferences(value, account, cash(), result)).toThrow()
  }
  expect(() => resolveJournalReferences(prepare({ ...input, categoryId: '4' }), account, cash(), categories())).toThrow('方向')
  expect(() => buildJournalSubmission(value, resolveJournalReferences(prepare(), account, cash()), '0')).toThrow('不一致')
  for (const previous of ['-1', '1.5', '9007199254740993']) {
    expect(() => buildJournalSubmission(value, selection, previous)).toThrow()
  }
})
