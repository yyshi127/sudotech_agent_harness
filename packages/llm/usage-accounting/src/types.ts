/** Client-safe usage-accounting Remote and event vocabulary. */

/** One Beijing calendar day's locally observed DeepSeek usage. */
export interface UsageAccountingDay {
  /** Calendar date in `YYYY-MM-DD` form. */
  date: string
  /** Provider-reported cached prompt tokens. */
  cacheHitInputTokens: number
  /** Provider-reported uncached prompt tokens. */
  cacheMissInputTokens: number
  /** Provider-reported completion tokens. */
  outputTokens: number
  /** Sum of all token buckets, including any unpriced tokens. */
  totalTokens: number
  /** Settled cached-input cost, or null when stored rows lack an exact breakdown. */
  cacheHitInputCostNanoyuan: string | null
  /** Settled uncached-input cost, or null when stored rows lack an exact breakdown. */
  cacheMissInputCostNanoyuan: string | null
  /** Settled output cost, or null when stored rows lack an exact breakdown. */
  outputCostNanoyuan: string | null
  /** Request-time cost in integer nanoyuan, serialized for JSON safety. */
  costNanoyuan: string
  /** Tokens retained in the ledger but excluded from cost. */
  unpricedTokens: number
}

/** Current-key current-month view returned to the browser. */
export interface UsageAccountingSnapshot {
  /** Monotone process-local revision used to collapse pushed refreshes. */
  revision: number
  /** Current Beijing month in `YYYY-MM` form. */
  month: string
  /** Current Beijing date in `YYYY-MM-DD` form. */
  today: string
  /** First date this installation started recording usage. */
  trackingSince: string
  /** Whether the configured official provider currently has a resolvable key. */
  keyConfigured: boolean
  /** Current-key rows for this month; old-key rows remain stored but hidden. */
  days: UsageAccountingDay[]
  /** Current-key monthly total. */
  total: UsageAccountingDay
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A durable local usage record committed; clients should refresh the snapshot.
     * @param revision - process-local committed revision.
     * @mode emit
     */
    'usage-accounting/updated'(revision: number): void
  }
}
