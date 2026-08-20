/** Exact display helpers for token and nanoyuan values. */

/**
 * Compact an integer token count without changing the stored total.
 * @param value - non-negative token count.
 * @returns compact decimal text using K or M where applicable.
 */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000)}M`
  if (value >= 1_000) return `${trimFixed(value / 1_000)}K`
  return String(value)
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

/**
 * Format an exact integer nanoyuan value as yuan rounded half up to fen.
 * @param value - non-negative integer nanoyuan string.
 * @returns yuan text with exactly two decimal places.
 */
export function formatNanoyuan(value: string): string {
  const fen = (BigInt(value) + 5_000_000n) / 10_000_000n
  const whole = fen / 100n
  const fraction = (fen % 100n).toString().padStart(2, '0')
  return `${whole}.${fraction}`
}
