# @deepseek-ai/dsh-client-ui-usage-accounting

English | [中文](README.zh.md)

Browser presentation for the local usage-accounting Remote. It adds a current-day summary to `sidebar.footer.action` and a current-month calendar to `settings.section` without owning billing data or credential values.

## Composition

The plugin requires the generic sidebar and settings slots, locale, the generated `remote.usageAccounting` client, and forwarded Host events. Both entries share one observable controller. The slot renderer binds that observable to `useUsage`; components receive only the framework hook, a refresh callback, and localized copy.

The controller refreshes on `usage-accounting/updated`, `credentials/updated`, and connection reset. A newer request generation wins when responses arrive out of order.

## Presentation

The wide sidebar displays `今日已使用 <token> token · ¥<费用>` with the token count and cost emphasized, and the collapsed rail keeps the same accessible label. Clicking either control opens a small anchored panel with exact cached-input, uncached-input, and output token and cost rows, plus the daily total and unpriced count. The settings navigation includes “用量”. Its page places the monthly total directly below the local-accounting explanation, then shows the Beijing current month as a Monday-first calendar with daily token and cost, pre-tracking days as “未统计”, and retained unpriced tokens as “未计价”.

The UI rounds exact integer nanoyuan values half up to fen and always displays two decimal places without floating-point arithmetic; stored totals retain nanoyuan precision. Old rows recover category costs only after the Host verifies an exact matching historical tariff and total; otherwise they show “明细未统计”. The browser never applies today's tariff itself. Token abbreviations affect display only and never change stored totals.

## Model Experience

None, as this browser-only plugin renders local accounting data and registers nothing model-facing.

#### KV Cache effect

No direct effect; opening or refreshing either view does not alter a model request.

## Known Limitations and Deferred Work

- The page intentionally exposes only the current month and current API key; it has no month navigation, chart, export, balance, or cloud synchronization.
- A disconnected or failed Remote shows an unavailable state and keeps no independent browser-side billing ledger.
