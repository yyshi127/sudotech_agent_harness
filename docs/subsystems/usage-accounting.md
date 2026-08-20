# Usage Accounting

English | [中文](usage-accounting.zh.md)

`@deepseek-ai/dsh-usage-accounting` stores locally observed DeepSeek usage as immutable request settlements and exposes only the configured API key's current Beijing month. Cost is fixed from the versioned built-in tariff at request start; the snapshot is a local estimate rather than a provider bill.

Source: [`packages/llm/usage-accounting/src/types.ts`](../../packages/llm/usage-accounting/src/types.ts)

## `UsageAccountingDay`

```ts type-equiv
/** One Beijing calendar day's locally observed DeepSeek usage. */
interface UsageAccountingDay {
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
```

The three provider-priced buckets remain disjoint. Their category costs are exact settled values when available and `null` when a legacy row cannot be verified against its historical tariff. `totalTokens` also includes unpriced cache-write tokens, while `costNanoyuan` sums the immutable per-request costs saved on that date.

## `UsageAccountingSnapshot`

```ts type-equiv
/** Current-key current-month view returned to the browser. */
interface UsageAccountingSnapshot {
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
```

`revision` is process-local and advances only after an atomic ledger commit. `trackingSince` distinguishes pre-installation dates from tracked zero-usage dates. The Host never sends an API key or its SHA-256 fingerprint to the browser.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxusageaccounting--usageaccountingservice"></a>

### `ctx.usageAccounting` — `UsageAccountingService`

Host service owning the ledger, built-in pricing, Remote, and stream observer.

```ts cordis-catalog
/**
 * Return only the current API key's current-month usage.
 * @returns current Beijing-month snapshot without credential material.
 */
@Remote('snapshot') async snapshot(): Promise<UsageAccountingSnapshot>
```

Source: [`packages/llm/usage-accounting/src/index.ts:35`](../../packages/llm/usage-accounting/src/index.ts)

<a id="usage-accounting-events"></a>

### `usage-accounting/*` events

<a id="usage-accountingupdated--emit"></a>

#### `usage-accounting/updated` — emit

A durable local usage record committed; clients should refresh the snapshot.

```ts cordis-catalog
/**
 * A durable local usage record committed; clients should refresh the snapshot.
 * @param revision - process-local committed revision.
 * @mode emit
 */
'usage-accounting/updated'(revision: number): void
```

Source: [`packages/llm/usage-accounting/src/types.ts:52`](../../packages/llm/usage-accounting/src/types.ts)
<!-- END GENERATED cordis-surface -->
