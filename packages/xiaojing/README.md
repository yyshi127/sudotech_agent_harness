---
description: "Xiaojing finance, document, desktop and automation capabilities."
kind: "package-group"
---

# xiaojing/ — Xiaojing product capabilities

English | [中文](README.zh.md)

## Summary

This group contains optional Xiaojing product capabilities. Each package is a normal Cordis plugin and can be removed from a development composition without changing Harness core packages.

The [product service reference](../../docs/subsystems/xiaojing.md) documents this group's services and request/result types.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`xiaojing-finance-domain/`](xiaojing-finance-domain/README.md) | Local Finance client records, dedicated Workspaces, and immutable session context | `ctx.xiaojingFinanceDomain` |
| [`xiaojing-finance-calculations/`](xiaojing-finance-calculations/README.md) | Versioned deterministic VAT, surcharge, EIT, and salary-IIT trial calculations | `ctx.xiaojingFinanceCalculations` |
| [`xiaojing-finance-documents/`](xiaojing-finance-documents/README.md) | Shared deterministic text extraction and bounded document visuals, including scanned PDF pages, for Finance and ordinary Xiaojing sessions | `ctx.xiaojingFinanceDocuments` |
| [`xiaojing-finance-evidence/`](xiaojing-finance-evidence/README.md) | Date-aware official finance-tax evidence retrieval | `ctx.xiaojingFinanceEvidence` |
| [`xiaojing-browser-control/`](xiaojing-browser-control/README.md) | Microsoft Edge semantic browser automation | `ctx.xiaojingBrowserControl` |
| [`xiaojing-computer-control/`](xiaojing-computer-control/README.md) | Semantic Windows UI Automation control | `ctx.xiaojingComputerControl` |
| [`xiaojing-desktop-companion/`](xiaojing-desktop-companion/README.md) | Sanitized desktop-companion task state and loopback SSE | `ctx.xiaojingDesktopCompanion` |
| [`xiaojing-weixin-channel/`](xiaojing-weixin-channel/README.md) | Tencent iLink pairing, text task delivery, and durable Weixin Agent session | none |
| [`xiaojing-visualize/`](xiaojing-visualize/README.md) | Removable visualization tool, skill, and sandboxed card | none |


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Finance extension packages

Finance Host packages use `@deepseek-ai/dsh-xiaojing-finance-*` with `xiaojing-finance-*` rows; Client packages use `@deepseek-ai/dsh-client-ui-xiaojing-finance-*` with `ui-xiaojing-finance-*` rows. `xiaojing-finance-domain` owns local taxpayer records, dedicated Finance Workspaces, immutable session binding, a generated Remote, and controlled files. `xiaojing-finance-calculations` owns versioned pure trial calculations and reads only the immutable taxpayer-type snapshot. `xiaojing-finance-documents` owns one deterministic parser core; its Finance adapter preserves customer import isolation, while its ordinary-session adapter authorizes only durable human uploads from the current session. `xiaojing-finance-evidence` adds official-source research without changing the client domain. Rc-specific imports stay in compatibility adapters; durable Finance records, normalized-document caches, and bounded evidence caches stay below the protected `$DSH_HOME/finance` root, while user-visible customer files stay below the separately configured Finance workspace root. Trial calculations add no separate persistence file and remain reconstructable from session tool events.

<a id="dev-note"></a>
### Dev Note

None.
