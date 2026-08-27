# xiaojing/ — Xiaojing product capabilities

English | [中文](README.zh.md)

This group contains optional Xiaojing product capabilities. Each package is a normal Cordis plugin and can be removed from a development composition without changing Harness core packages.

| Package | Role | ctx key |
|---|---|---|
| [`xiaojing-browser-control/`](xiaojing-browser-control/README.md) | Microsoft Edge semantic browser automation | `ctx.xiaojingBrowserControl` |
| [`xiaojing-computer-control/`](xiaojing-computer-control/README.md) | Semantic Windows UI Automation control | `ctx.xiaojingComputerControl` |
| [`xiaojing-desktop-companion/`](xiaojing-desktop-companion/README.md) | Sanitized desktop-companion task state and loopback SSE | `ctx.xiaojingDesktopCompanion` |
| [`xiaojing-weixin-channel/`](xiaojing-weixin-channel/README.md) | Tencent iLink pairing, text task delivery, and durable Weixin Agent session | none |
| [`xiaojing-visualize/`](xiaojing-visualize/README.md) | Removable visualization tool, skill, and sandboxed card | none |

## Finance extension packages

Finance has no Host or Client service package. Its instruction-only official-source tax research skill travels with the product preset and is inventoried in `packages/client/xiaojing-product/product.json`; it does not justify a placeholder service package. Create a package only when a complete capability seam has a Service Definition, provider, consumer, composition row, persistence contract, and focused verification. Host packages use `@deepseek-ai/dsh-xiaojing-finance-*` with `xiaojing-finance-*` rows; Client packages use `@deepseek-ai/dsh-client-ui-xiaojing-finance-*` with `ui-xiaojing-finance-*` rows. Rc-specific imports stay in `src/compat.ts`, and durable Finance data stays below the protected `$DSH_HOME/finance` root.
