import { describe, expect, it } from 'vitest'
import {
  beijingClock,
  EMBEDDED_PRICE_TABLE,
  isPeakTime,
  priceUsage,
} from '../src/pricing.ts'

function beijingTimestamp(hour: number, minute = 0): number {
  return Date.UTC(2026, 7, 20, hour - 8, minute)
}

const usage = {
  cacheHitInputTokens: 1_000_000,
  cacheMissInputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheWriteTokens: 0,
}

describe('DeepSeek request-time pricing', () => {
  it('uses Beijing dates and half-open peak windows', () => {
    expect(beijingClock(Date.UTC(2026, 7, 19, 16))).toEqual({
      date: '2026-08-20', month: '2026-08', hour: 0,
    })
    expect(isPeakTime(beijingTimestamp(8, 59))).toBe(false)
    expect(isPeakTime(beijingTimestamp(9))).toBe(true)
    expect(isPeakTime(beijingTimestamp(11, 59))).toBe(true)
    expect(isPeakTime(beijingTimestamp(12))).toBe(false)
    expect(isPeakTime(beijingTimestamp(13, 59))).toBe(false)
    expect(isPeakTime(beijingTimestamp(14))).toBe(true)
    expect(isPeakTime(beijingTimestamp(17, 59))).toBe(true)
    expect(isPeakTime(beijingTimestamp(18))).toBe(false)
  })

  it('prices Flash and Pro with exact integer nanoyuan rates', () => {
    expect(priceUsage(
      EMBEDDED_PRICE_TABLE, 'deepseek-v4-flash', usage, beijingTimestamp(9), true,
    )).toEqual({
      cacheHitInputCostNanoyuan: 100_000_000n,
      cacheMissInputCostNanoyuan: 3_000_000_000n,
      outputCostNanoyuan: 9_000_000_000n,
      costNanoyuan: 12_100_000_000n,
      unpricedTokens: 0,
      priceVersion: 'deepseek-public-v4-2026-08',
    })
    expect(priceUsage(
      EMBEDDED_PRICE_TABLE, 'deepseek-v4-flash', usage, beijingTimestamp(12), true,
    ).costNanoyuan).toBe(6_050_000_000n)
    expect(priceUsage(
      EMBEDDED_PRICE_TABLE, 'deepseek-v4-pro', usage, beijingTimestamp(14), true,
    ).costNanoyuan).toBe(36_300_000_000n)
  })

  it('retains unknown, non-official, and cache-write tokens without pricing them', () => {
    const withWrite = { ...usage, cacheWriteTokens: 7 }
    expect(priceUsage(
      EMBEDDED_PRICE_TABLE, 'deepseek-v4-flash', withWrite, beijingTimestamp(9), true,
    ).unpricedTokens).toBe(7)
    expect(priceUsage(
      EMBEDDED_PRICE_TABLE, 'future-model', withWrite, beijingTimestamp(9), true,
    )).toEqual({
      cacheHitInputCostNanoyuan: null,
      cacheMissInputCostNanoyuan: null,
      outputCostNanoyuan: null,
      costNanoyuan: 0n,
      unpricedTokens: 3_000_007,
      priceVersion: null,
    })
    expect(priceUsage(
      EMBEDDED_PRICE_TABLE, 'deepseek-v4-flash', withWrite, beijingTimestamp(9), false,
    ).unpricedTokens).toBe(3_000_007)
  })
})
