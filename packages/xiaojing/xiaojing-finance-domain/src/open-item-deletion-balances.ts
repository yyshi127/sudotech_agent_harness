/** Currency-separated deletion balance evidence; no exchange-rate conversion or mutation of source rows. */
import type { OpenItemRow } from './open-items.ts'
import assert from 'node:assert/strict'

type State = 'matched' | 'mismatch' | 'unavailable'
type Basis = 'reported' | 'same-currency' | 'mixed' | 'unavailable'

/** Scoped sums and unchanged-survivor checks, not an account-wide balance or bank movement. */
export interface DeletionBalanceVerification {
  state: State
  remaining: State
  changes: Array<{
    currencyCode: string
    before: string | null
    after: string | null
    removed: string | null
    expectedAfter: string | null
    state: State
    basis: Basis
  }>
}

const combine = (states: State[]): State => states.includes('mismatch') ? 'mismatch'
  : states.includes('unavailable') ? 'unavailable' : 'matched'
const cents = (value: string) => BigInt(value.replace('.', ''))
function money(value: bigint): string {
  const absolute = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

function observation(row: OpenItemRow, base: boolean): { currency: string; value: string | null; basis: Basis; conflict: boolean } {
  const sameCurrency = row.currencyCode !== '' && row.currencyCode === row.baseCurrencyCode
  const derived = base && row.baseBalance === null && sameCurrency
  const value = base ? derived ? row.balance : row.baseBalance : row.balance
  return { currency: base ? row.baseCurrencyCode : row.currencyCode, value,
    basis: value === null ? 'unavailable' : derived ? 'same-currency' : 'reported',
    conflict: base && sameCurrency && row.baseBalance !== null && row.balance !== null && row.baseBalance !== row.balance }
}

/**
 * Verify survivors and exact per-currency deletion deltas using validated, counted same-scope inventories.
 * @param before - Original rows containing the unique target.
 * @param after - Rows with exactly that target absent and all surviving identities preserved.
 * @param target - Target from the original inventory.
 * @param base - Select base balances; missing values can use balance only when both currency codes explicitly match.
 * @returns Separate survivor and delta evidence. Empty post-deletion groups sum to zero; missing row amounts never do.
 */
export function verifyOpenItemDeletionBalances(before: OpenItemRow[], after: OpenItemRow[], target: OpenItemRow,
  base: boolean): DeletionBalanceVerification {
  const observedBefore = before.map(row => observation(row, base))
  const observedAfter = after.map(row => observation(row, base))
  const removed = observation(target, base)
  const remainingStates: State[] = []
  const afterById = new Map(after.map(row => [row.id, row]))
  for (const row of before.filter(row => row.id !== target.id)) {
    const next = afterById.get(row.id)
    assert.ok(next, 'Balance comparison requires the previously verified surviving identities')
    const left = observation(row, base)
    const right = observation(next, base)
    const otherFields = ['settledAmount', 'badDebtAmount', 'offsetAmount', 'returnAmount'] as const
    const changed = left.currency !== right.currency || left.value !== right.value || left.conflict || right.conflict
      || !base && otherFields.some(field => row[field] !== next[field])
    const missing = left.currency === '' || left.value === null || right.value === null
      || !base && otherFields.some(field => row[field] === null || next[field] === null)
    remainingStates.push(changed ? 'mismatch' : missing ? 'unavailable' : 'matched')
  }
  const sum = (rows: ReturnType<typeof observation>[]): bigint | null => {
    let total = 0n
    for (const row of rows) {
      if (row.value === null) return null
      total += cents(row.value)
    }
    return total
  }
  const changes = [...new Set([...observedBefore, ...observedAfter].map(row => row.currency))].sort().map((currencyCode) => {
    const left = observedBefore.filter(row => row.currency === currencyCode)
    const right = observedAfter.filter(row => row.currency === currencyCode)
    const original = sum(left)
    const current = sum(right)
    const deleted = removed.currency !== currencyCode ? 0n : removed.value === null ? null : cents(removed.value)
    const expected = original === null || deleted === null ? null : original - deleted
    const unavailable = currencyCode === '' || original === null || current === null || deleted === null
    const mismatch = [...left, ...right].some(row => row.conflict)
      || current !== null && expected !== null && current !== expected
    const bases = new Set([...left, ...right].map(row => row.basis))
    const basis: Basis = unavailable ? 'unavailable' : bases.size > 1 ? 'mixed'
      : bases.has('same-currency') ? 'same-currency' : 'reported'
    const state: State = mismatch ? 'mismatch' : unavailable ? 'unavailable' : 'matched'
    return { currencyCode, before: original === null ? null : money(original), after: current === null ? null : money(current),
      removed: deleted === null ? null : money(deleted), expectedAfter: expected === null ? null : money(expected), state, basis }
  })
  const remaining = combine(remainingStates)
  return { state: combine([remaining, ...changes.map(change => change.state)]), remaining, changes }
}
