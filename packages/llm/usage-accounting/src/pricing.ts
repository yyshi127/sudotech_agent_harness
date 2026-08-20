/** Built-in DeepSeek tariffs and Beijing request-time pricing. */

/** Disjoint provider usage buckets accepted by the accounting core. */
export interface UsageBuckets {
  cacheHitInputTokens: number
  cacheMissInputTokens: number
  outputTokens: number
  cacheWriteTokens: number
}

/** Exact integer rates for one time band. */
export interface PriceBand {
  cacheHitInputNanoyuanPerToken: bigint
  cacheMissInputNanoyuanPerToken: bigint
  outputNanoyuanPerToken: bigint
}

/** One model's peak and off-peak rates. */
export interface ModelPrice {
  peak: PriceBand
  offPeak: PriceBand
}

/** Versioned built-in tariff table. */
export interface PriceTable {
  version: string
  models: Readonly<Record<string, ModelPrice>>
}

/** Result fixed into one request ledger row. */
export interface PricedUsage {
  cacheHitInputCostNanoyuan: bigint | null
  cacheMissInputCostNanoyuan: bigint | null
  outputCostNanoyuan: bigint | null
  costNanoyuan: bigint
  unpricedTokens: number
  priceVersion: string | null
}

function priceBand(cacheHit: bigint, cacheMiss: bigint, output: bigint): PriceBand {
  return Object.freeze({
    cacheHitInputNanoyuanPerToken: cacheHit,
    cacheMissInputNanoyuanPerToken: cacheMiss,
    outputNanoyuanPerToken: output,
  })
}

function modelPrice(peak: PriceBand, offPeak: PriceBand): ModelPrice {
  return Object.freeze({ peak, offPeak })
}

/** Sole runtime tariff, matching the published DeepSeek V4 Flash and V4 Pro prices. */
export const EMBEDDED_PRICE_TABLE: PriceTable = Object.freeze({
  version: 'deepseek-public-v4-2026-08',
  models: Object.freeze({
    'deepseek-v4-flash': modelPrice(
      priceBand(100n, 3_000n, 9_000n),
      priceBand(50n, 1_500n, 4_500n),
    ),
    'deepseek-v4-pro': modelPrice(
      priceBand(300n, 9_000n, 27_000n),
      priceBand(150n, 4_500n, 13_500n),
    ),
  }),
})

/**
 * Convert one instant to Beijing calendar fields; China Standard Time is fixed at UTC+08:00.
 * @param timestampMs - Unix timestamp in milliseconds.
 * @returns Beijing date, month, and hour fields.
 */
export function beijingClock(timestampMs: number): { date: string; month: string; hour: number } {
  const shifted = new Date(timestampMs + 8 * 60 * 60 * 1_000)
  const year = shifted.getUTCFullYear()
  const monthNumber = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  const month = `${String(year).padStart(4, '0')}-${monthNumber}`
  return { date: `${month}-${day}`, month, hour: shifted.getUTCHours() }
}

/**
 * Test the official half-open peak windows: 09:00–12:00 and 14:00–18:00 Beijing time.
 * @param timestampMs - Unix timestamp in milliseconds.
 * @returns whether the instant falls inside a peak window.
 */
export function isPeakTime(timestampMs: number): boolean {
  const hour = beijingClock(timestampMs).hour
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/**
 * Price one provider-reported request with a versioned built-in tariff.
 * @param table - immutable built-in tariff.
 * @param model - exact wire model id.
 * @param usage - disjoint usage buckets.
 * @param timestampMs - request start time.
 * @param officialEndpoint - whether the request targeted the official public endpoint.
 * @returns fixed cost and unpriced count stored with the request.
 */
export function priceUsage(
  table: PriceTable,
  model: string,
  usage: UsageBuckets,
  timestampMs: number,
  officialEndpoint: boolean,
): PricedUsage {
  const total = usage.cacheHitInputTokens + usage.cacheMissInputTokens
    + usage.outputTokens + usage.cacheWriteTokens
  const modelPrice = officialEndpoint ? table.models[model] : undefined
  if (modelPrice === undefined) {
    return {
      cacheHitInputCostNanoyuan: null,
      cacheMissInputCostNanoyuan: null,
      outputCostNanoyuan: null,
      costNanoyuan: 0n,
      unpricedTokens: total,
      priceVersion: null,
    }
  }
  const rates = isPeakTime(timestampMs) ? modelPrice.peak : modelPrice.offPeak
  const cacheHitInputCostNanoyuan = BigInt(usage.cacheHitInputTokens) * rates.cacheHitInputNanoyuanPerToken
  const cacheMissInputCostNanoyuan = BigInt(usage.cacheMissInputTokens) * rates.cacheMissInputNanoyuanPerToken
  const outputCostNanoyuan = BigInt(usage.outputTokens) * rates.outputNanoyuanPerToken
  return {
    cacheHitInputCostNanoyuan,
    cacheMissInputCostNanoyuan,
    outputCostNanoyuan,
    costNanoyuan: cacheHitInputCostNanoyuan + cacheMissInputCostNanoyuan + outputCostNanoyuan,
    unpricedTokens: usage.cacheWriteTokens,
    priceVersion: table.version,
  }
}
