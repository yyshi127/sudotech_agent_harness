# 用量统计

[English](usage-accounting.md) | 中文

`@deepseek-ai/dsh-usage-accounting` 将本机观察到的 DeepSeek 用量保存为不可变的逐请求结算记录，并且只公开当前所配 API Key 按北京时间计算的本月数据。费用按请求开始时生效的版本化内置价格固定；该快照是本机估算，不是提供方账单。

来源：[`packages/llm/usage-accounting/src/types.ts`](../../packages/llm/usage-accounting/src/types.ts)

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

提供方计价的三个 bucket 保持互不重叠。分类费用在可用时是准确结算值；旧记录无法通过历史价格核验时为 `null`。`totalTokens` 还包含未计价的缓存写入 token，`costNanoyuan` 则汇总当天保存的不可变逐请求费用。

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

`revision` 只在原子账本提交成功后递增，且仅在当前进程内单调。`trackingSince` 用于区分安装前日期和已开始统计但用量为零的日期。Host 不会向浏览器发送 API Key 或其 SHA-256 指纹。

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
