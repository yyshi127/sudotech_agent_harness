import { expect, it } from 'vitest'
import { verifyOpenItemDeletionBalances } from '../src/open-item-deletion-balances.ts'
import { projectOpenItems } from '../src/open-items.ts'

const row = (id: number, balance: string, extra: object = {}) => projectOpenItems({ count: 1, list: [{
  id, setOfBooksId: 35616, date: '2022-01-01', abstractStr: '余额核验', subjectCode: '1122', subjectName: '应收账款',
  auxiliaryItemIds: '1', auxiliaryItemName: '测试客户', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
  money: balance, balance, thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0, categoryName: '', remark: '', ...extra,
}] }, { direction: 'receivable', periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 },
{ id: '35616', name: '测试账套' }, 100, 100000).rows[0]!

it.each([false, true])('checks a same-currency deletion without inventing missing fields; base=%s', (base) => {
  const target = row(1, '0.01')
  const survivor = row(2, '0.26')
  const before = [survivor, target]
  const snapshot = structuredClone(before)
  expect(verifyOpenItemDeletionBalances(before, [survivor], target, base)).toEqual({
    state: 'matched', remaining: 'matched', changes: [{ currencyCode: 'RMB', before: '0.27', after: '0.26',
      removed: '0.01', expectedAfter: '0.26', state: 'matched', basis: base ? 'same-currency' : 'reported' }],
  })
  expect(before).toEqual(snapshot)
  expect(survivor.baseBalance).toBeNull()
})

it.each([false, true])('verifies deletion of the last record; base=%s', (base) => {
  const target = row(1, '0.01')
  expect(verifyOpenItemDeletionBalances([target], [], target, base)).toMatchObject({ state: 'matched', remaining: 'matched',
    changes: [{ before: '0.01', after: '0.00', removed: '0.01', expectedAfter: '0.00', state: 'matched' }] })
})

it('keeps foreign-currency totals separate and missing conversion unavailable', () => {
  const target = row(1, '0.01')
  const dollar = row(2, '1.00', { currencyCode: 'USD' })
  const before = [target, dollar]
  const original = verifyOpenItemDeletionBalances(before, [dollar], target, false)
  expect(original.state).toBe('matched')
  expect(original.changes).toEqual([
    { currencyCode: 'RMB', before: '0.01', after: '0.00', removed: '0.01', expectedAfter: '0.00', state: 'matched', basis: 'reported' },
    { currencyCode: 'USD', before: '1.00', after: '1.00', removed: '0.00', expectedAfter: '1.00', state: 'matched', basis: 'reported' },
  ])
  expect(verifyOpenItemDeletionBalances(before, [dollar], target, true)).toEqual({ state: 'unavailable', remaining: 'unavailable',
    changes: [{ currencyCode: 'RMB', before: null, after: null, removed: '0.01', expectedAfter: null,
      state: 'unavailable', basis: 'unavailable' }] })
})

it('uses reported FX base balances and labels mixed reported/derived evidence', () => {
  const target = row(1, '0.01')
  const dollar = row(2, '1.00', { currencyCode: 'USD', baseBalance: '7.00' })
  expect(verifyOpenItemDeletionBalances([target, dollar], [dollar], target, true)).toEqual({
    state: 'matched', remaining: 'matched', changes: [{ currencyCode: 'RMB', before: '7.01', after: '7.00',
      removed: '0.01', expectedAfter: '7.00', state: 'matched', basis: 'mixed' }],
  })
})

it.each(['balance', 'settledAmount', 'badDebtAmount', 'offsetAmount', 'returnAmount'] as const)(
  'rejects changed surviving %s', (field) => {
    const target = row(1, '0.01')
    const survivor = row(2, '0.26')
    expect(verifyOpenItemDeletionBalances([target, survivor], [{ ...survivor, [field]: '0.02' }], target, false).state)
      .toBe('mismatch')
  })

it('detects offsetting row changes even when the total matches', () => {
  const target = row(1, '0.01'), a = row(2, '0.10'), b = row(3, '0.20')
  const result = verifyOpenItemDeletionBalances([target, a, b], [row(2, '0.11'), row(3, '0.19')], target, false)
  expect(result).toMatchObject({ state: 'mismatch', remaining: 'mismatch', changes: [{ state: 'matched' }] })
})

it.each(['missing-base-code', 'missing-settlement', 'conflicting-base', 'changed-base', 'changed-currency'])(
  'preserves missing or contradictory evidence: %s', (mode) => {
    const target = row(1, '0.01')
    const survivor = row(2, '0.26', mode === 'conflicting-base' ? { baseBalance: '0.27' }
      : mode === 'missing-base-code' ? { baseCurrencyCode: '' } : {})
    if (mode === 'missing-settlement') survivor.settledAmount = null
    const next = { ...survivor, ...(mode === 'changed-base' ? { baseBalance: '0.30' }
      : mode === 'changed-currency' ? { currencyCode: 'USD' } : {}) }
    const base = mode !== 'missing-settlement'
    expect(verifyOpenItemDeletionBalances([target, survivor], [next], target, base).state)
      .toBe(mode.startsWith('missing') ? 'unavailable' : 'mismatch')
  })

it('does not zero a missing deleted FX base balance and handles exact large/negative decimals', () => {
  const foreign = row(1, '0.01', { currencyCode: 'USD' })
  expect(verifyOpenItemDeletionBalances([foreign], [], foreign, true)).toMatchObject({ state: 'unavailable',
    changes: [{ before: null, after: '0.00', removed: null, expectedAfter: null }] })
  const target = row(1, '0.01'), survivor = row(2, '99999999999999999999.99'), negative = row(3, '-0.02')
  expect(verifyOpenItemDeletionBalances([target, survivor, negative], [survivor, negative], target, false)).toMatchObject({
    state: 'matched', changes: [{ before: '99999999999999999999.98', after: '99999999999999999999.97' }],
  })
})
