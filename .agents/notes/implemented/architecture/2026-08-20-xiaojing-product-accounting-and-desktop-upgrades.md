# Agent Note: Xiaojing product isolation, local accounting, and desktop upgrades

Status: implemented

English | [中文](2026-08-20-xiaojing-product-accounting-and-desktop-upgrades.zh.md)

## Problem

Xiaojing Accounting changes product identity, first-use guidance, desktop packaging, and internal plugins on top of an official DeepSeek Harness baseline. Direct brand edits in official UI packages make an upstream merge indistinguishable from a product redesign, while dynamically installed plugins can shadow the bundled profile. Desktop releases also need one stable installer identity and user-data root, otherwise a routine source upgrade can create a second installation or orphan sessions and credentials.

Local cost display has a separate accuracy problem. The DeepSeek adapter reports disjoint cached input, uncached input, and output usage after each request, while public V4 prices vary by model and Beijing peak window. Aggregating messages or estimating tokens cannot reproduce that billable request stream.

## Decision

### Product layer

Official UI owners expose only `sidebar.brand`, `conversation.hero.brand`, and `onboarding.content`. [`@deepseek-ai/dsh-client-xiaojing-product`](../../../../packages/client/xiaojing-product/README.md) fills those slots, applies the palette, and fills an empty deployment persona without replacing a selected agent persona. Before plugins activate, generic metadata in the static Web app selects an inventoried product logo while the shell retains its neutral fallback. `product.json` pins the upstream rc.5 tag and commit and inventories product assets and desktop manifests. `scripts/verify-xiaojing-product-layer.mjs` rejects Xiaojing marks in the official UI source roots and verifies the slot and composition references.

Post-launch API-key configuration, profile runtime-shadow protection, and the file-upload composer repair remain independent integration patches listed in [`apps/desktop/integration-patches.json`](../../../../apps/desktop/integration-patches.json). Their paths are machine-checked separately from brand isolation.

### Usage settlement and pricing

[`@deepseek-ai/dsh-usage-accounting`](../../../../packages/llm/usage-accounting/README.md) observes `deepseek-official` through `llm/stream`. One rc.5 compatibility file owns every import of the stream, usage, settings, and credential APIs. The first provider `usage` chunk of each actual stream settles once, so conversation, compaction, title, and retry calls remain separate billable requests without changing the agent loop.

Records retain only a SHA-256 API-key fingerprint and expose the current key's Beijing current month. Each settlement stores its tariff version and integer-nanoyuan total and category costs. Peak windows are 09:00–12:00 and 14:00–18:00 Beijing time; the built-in Flash and Pro peak rates and half-price off-peak rates mirror the public tariff. Unknown models, cache-write tokens, and custom endpoints remain visible as unpriced tokens. The built-in table is the only runtime tariff source, so price updates require a client release and startup performs no pricing network request. Historical records are never repriced. Older schema-v1 rows without category costs recover their breakdown only when the matching built-in tariff recomputes the exact stored total and unpriced count; otherwise the breakdown remains unavailable.

### Desktop identity and data

[`apps/desktop/identity.json`](../../../../apps/desktop/identity.json) fixes the package name, AppUserModelId, NSIS GUID, directory name, executable, product name, per-user scope, and shortcut. Electron pins `%APPDATA%\@sudotech\xiaojing-accounting-desktop` before obtaining the single-instance lock. The bundled Host uses its `harness` child as `DSH_HOME` and keeps the Documents workspace outside the installation directory.

The NSIS update path reuses the registered `InstallLocation` and skips path selection. [`user-data-contract.json`](../../../../apps/desktop/user-data-contract.json) enumerates protected data, and its verifier applies an application-file replacement to a synthetic 0.1.7 fixture while requiring every protected byte to remain unchanged. An incompatible future durable format therefore requires an atomic migration and an updated previous-release fixture before release.

### Upstream integration

The upstream baseline remains explicit instead of being inferred from current file contents. An upgrade branch merges a verified official tag or commit and confines adaptation to generic slots, the rc compatibility adapter, independent integration patches, and required data migration. Product assets, accounting rules, and desktop identity do not move merely because official packages do.

## Verification

Host tests pin cache buckets, exact category settlement, strict legacy-row recovery, one-settlement behavior, key isolation, invalid-ledger refusal, immutable tariff versions, and every peak boundary. Client tests pin the clickable detail panel, sidebar summary, monthly-total placement, Monday-first calendar, pre-tracking and unpriced states, and stale-response suppression. Product tests pin slot copy, default-persona precedence, and accurate origin disclosure. Identity, product-layer, and synthetic 0.1.7 data checks run before any desktop distribution command; assembled browser replay verifies the real loaded composition.

## Alternatives considered

- **Keep branding as direct edits in official components.** This minimizes the first diff but makes every upstream UI conflict carry product copy, assets, and palette changes. Generic slots plus one product plugin make the official fallback executable and keep product behavior unloadable.
- **Read the DeepSeek Platform account bill.** The API key used for inference does not provide a supported per-key billing Remote in this application. Local settlement from provider usage is available immediately and auditable, while the UI explicitly avoids presenting it as an official bill or balance.
- **Count inside the agent loop.** This couples accounting to one loop implementation and misses auxiliary direct LLM consumers. Observing `llm/stream` counts the actual provider calls and confines rc changes to one adapter.
- **Require uninstall before every desktop update.** Uninstall/reinstall complicates custom paths and increases the chance of deleting or orphaning user data. A stable NSIS identity and immutable user-data root support ordinary in-place replacement.

## Consequences

Official source upgrades still require review when a generic owner or rc API changes, but product logic does not need to be recreated. The cost ledger grows by one immutable row per observed request and intentionally has no historical reconstruction, cloud sync, balance, chart, or multi-provider abstraction. Built-in-only pricing removes startup network and cache failure paths, while tariff changes require a client release. Desktop release work carries a mandatory previous-version upgrade test and cannot change compatibility identifiers without an explicit migration decision.
