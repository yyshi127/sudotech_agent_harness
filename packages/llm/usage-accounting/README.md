---
description: "Local DeepSeek token and request-time cost accounting, including conservative price recovery for qualifying default Messages records."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-accounting

English | [中文](README.zh.md)

## Summary

Local, current-key DeepSeek token and request-time cost accounting. The plugin observes provider-reported `usage` chunks through the rc.2 `llm/stream` waterfall and does not modify the agent loop or model requests.

## Table of Contents

- [Configuration](#configuration)
- [Observation and settlement](#observation-and-settlement)
- [Pricing](#pricing)
- [Persistence and Remote API](#persistence-and-remote-api)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | resolved Harness home | Root whose `usage-accounting/` child stores the ledger. |

The built-in official table is the sole tariff source. The plugin performs no pricing network request and does not read a tariff cache. Updating the tariff requires a client release. An incompatible usage ledger fails startup because silently discarding or partially rewriting usage would violate the persistence contract.

<a id="observation-and-settlement"></a>
## Observation and settlement

The rc.2 compatibility adapter is the only file that imports `llm/stream`, `TokenUsage`, DeepSeek settings, and credential resolution. It records the first `usage` chunk from every actual `deepseek-official` stream exactly once. Ordinary conversation, compaction, session-title, and retried requests therefore settle independently when the provider reports usage.

Both official DeepSeek roots are priced: the Chat Completions root `https://api.deepseek.com` and the Messages root `https://api.deepseek.com/anthropic`. Other paths and custom origins remain unpriced.

Each record contains cached input, uncached input, output, cache-write tokens, model, Beijing request date, request purpose, tariff version, and the fixed total and per-category costs. The API key is represented only by its SHA-256 fingerprint. A key change retains old records but `snapshot()` returns only the configured key's current month.

<a id="pricing"></a>
## Pricing

The embedded table follows the [DeepSeek public pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) effective on 14 September 2026 for Flash and V4 Pro. `deepseek-flash` and the callable legacy ids `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` use the Flash rates. Peak time is Beijing time 09:00–12:00 and 14:00–18:00; both ranges are half-open. Every other time is off-peak.

| Model and band | Cache hit input / million | Cache miss input / million | Output / million |
|---|---:|---:|---:|
| Flash peak | ¥0.04 | ¥2.00 | ¥8.00 |
| Flash off-peak | ¥0.02 | ¥1.00 | ¥4.00 |
| V4 Pro peak | ¥0.30 | ¥9.00 | ¥27.00 |
| V4 Pro off-peak | ¥0.15 | ¥4.50 | ¥13.50 |

Costs use integer nanoyuan per token. A request keeps the tariff version and exact cost active at its start time, so later tariff changes do not reprice history. Prior built-in tables are retained only to recover category details omitted by early schema-v1 rows; they are never used for new settlement. Vision image consumption comes only from the provider-reported usage; the plugin does not estimate image tokens. Unknown models, cache-write tokens, and non-official endpoints remain in token totals but are marked unpriced.

<a id="persistence-and-remote-api"></a>
## Persistence and Remote API

`$DSH_HOME/usage-accounting/usage-v1.json` is a schema-v1 atomic ledger. `usageAccounting.snapshot()` returns the current key's Beijing current-month rows and aggregate; `usage-accounting/updated` is emitted only after a record commits. Schema-v1 rows written before category costs were added remain readable and keep their settled total. Their breakdown is recovered only when the stored tariff version is built in and recomputation from the stored model, request time, and tokens exactly equals that total; otherwise it remains unavailable.

When the current connection still uses the implicit official Messages endpoint, `snapshot()` recovers the displayed price of affected `deepseek-flash` rows dated from the embedded tariff's effective date without rewriting the ledger. A row qualifies only when its tariff and all category costs are null, its total cost is zero, and every token was stored as unpriced. Rows for explicit endpoints, other models, earlier dates, or different record states are not recovered.

<a id="model-experience"></a>
## Model Experience

None, as this observer reads provider usage after a request and registers no model-facing content.

#### KV Cache effect

No direct effect; the plugin does not change request prefixes, messages, tools, or provider routing.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The displayed amount is a local calculation from provider-reported usage and public tariffs, not the DeepSeek Platform's official bill or account balance.
- Tracking starts when this plugin first creates its ledger; earlier sessions are not reconstructed.
- Only the configured key's current month is exposed; month navigation, export, charts, cloud synchronization, and multi-provider accounting are intentionally absent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
