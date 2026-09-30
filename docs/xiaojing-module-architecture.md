# Xiaojing Accounting 0.3.1 module and source architecture

English | [中文](xiaojing-module-architecture.zh.md)

This page maps Xiaojing Accounting 0.3.1 across the repository. It identifies what original DeepSeek Harness code owns, where Xiaojing additions live, and which extension point installs or removes each capability. Source code, package READMEs, and the [product development baseline](xiaojing-product-development.md) remain authoritative for behavior.

## Baseline and conclusion

| Item | Current value | Source of truth |
|---|---|---|
| Desktop version | `0.3.1` | [`apps/desktop/package.json`](../apps/desktop/package.json) |
| Harness baseline | `dsh-v0.1.7-rc.1` / `46a7f68...` | [`packages/client/xiaojing-product/product.json`](../packages/client/xiaojing-product/product.json) |
| Runtime composition | Cordis profiles, bundles, and configuration rows | [`packages/boot/app-boot/src/profile.ts`](../packages/boot/app-boot/src/profile.ts), [`packages/bundle/web-app/cordis.patch.yml`](../packages/bundle/web-app/cordis.patch.yml) |
| Xiaojing Client selector | `DSH_CLIENT_BUILD_PROFILE=xiaojing` | [`scripts/client-build-environment.ts`](../scripts/client-build-environment.ts) |

The main architecture is extensible: brand, accounting, Weixin, Edge, Windows control, the desktop companion, and Visualize use separate packages, and none embeds its implementation in `agent-loop`. Three areas remain integration layers rather than single-row plugins: product rows currently live in the shared `web-app` bundle, file upload depends on an external package plus a pnpm patch, and the desktop companion's native window and tray must be implemented by Electron.

## Runtime module architecture

A desktop request normally flows from Electron into the assembled Web Client. Client plugins render through slots and call the Host through Remote or RPC. Host feature plugins attach through tools, events, or the LLM waterfall, while the upstream Agent Loop remains the driver. A Weixin task enters through the channel Host plugin and uses the normal `sessions.prompt()` path, so it shares session, tool, approval, and log semantics with desktop work.

## Layer ownership

| Layer | Owns | Must not own |
|---|---|---|
| Original Harness core | Agent, Agent Loop, Session Log, tool execution, LLM, settings, credentials, attachments, and API gateway | Xiaojing copy, Sudotech theme, Weixin protocol, or the desktop companion |
| Neutral extension points | UI slot declarations, tool registration, events, Remote/RPC, and fallback UI | Product-specific behavior or assets |
| Xiaojing Host plugins | Accounting, Weixin, browser, Windows, companion state, and visualization tools | React rendering or Electron BrowserWindows |
| Xiaojing Client plugins | Brand, settings sections, sidebar summaries, cards, and Host projections | API keys, Weixin tokens, filesystem access, or arbitrary Node access |
| Electron shell | Main window, tray, companion window, restricted preload, bundled runtime, and installer | Agent behavior, accounting rules, or Web automation policy |
| Profile and bundle | Which plugins load and in what order | Business algorithms inside assembly files |

## Feature insertion map

| Feature | Host owner | Client owner | Extension point | Persistence owner | Complete removal |
|---|---|---|---|---|---|
| Brand and deployment persona | [`packages/client/xiaojing-product/`](../packages/client/xiaojing-product/) | The same package's `src/client/` | `system-prompt/assemble`, five brand slots, and `settings.section` | User personas remain owned by Harness settings and presets | Remove the `xiaojing-product` row and build the official Client profile |
| Finance mode | Declarative [`agent.cordis.yml`](../apps/cli/config/xiaojing-agent-presets/finance/agent.cordis.yml) plus the Finance Host packages inventoried by the product manifest | Finance display provider in [`xiaojing-product`](../packages/client/xiaojing-product/) and [`ui-xiaojing-finance-clients`](../packages/client/ui-xiaojing-finance-clients/) | `preset-finance` through `@deepseek-ai/dsh-agent-preset`, `AgentPresetDisplayRegistry`, scoped Finance service and tool rows, and the product-manifest verifier | Package-owned schema-versioned data under the protected `harness/finance` root | Remove the Finance patch, display registration, its five skill entries and directories, the Finance Host/Client composition rows and package inventories, and focused checks; upstream preset declarations remain unchanged |
| Local usage | [`packages/llm/usage-accounting/`](../packages/llm/usage-accounting/) | [`packages/client/ui-usage-accounting/`](../packages/client/ui-usage-accounting/) | `llm/stream`, Typert Remote, `usage-accounting/updated`, sidebar and settings slots | `$DSH_HOME/usage-accounting/usage-v1.json` | Remove both Host and Client rows; the historical ledger may remain |
| File and image upload | `dsh-file-uploads` bundle and native attachment services | External plugin Client plus generic `conversation.addImages()` | Profile bundle, native image intake, and composer slot | `$DSH_HOME/uploads`, `$DSH_HOME/attachments/v1` | Remove the profile bundle, application dependency, and pnpm patch; this is not a pure one-row plugin |
| Weixin channel | [`packages/xiaojing/xiaojing-weixin-channel/`](../packages/xiaojing/xiaojing-weixin-channel/) | [`packages/client/ui-weixin-channel/`](../packages/client/ui-weixin-channel/) | `sessions.prompt()`, Agent/Session/Approval events, and loopback RPC | Credential service, `$DSH_HOME/weixin-channel`, shared attachment roots | Remove both Host and Client rows |
| Edge browser control | [`packages/xiaojing/xiaojing-browser-control/`](../packages/xiaojing/xiaojing-browser-control/) | [`packages/client/ui-xiaojing-browser-control/`](../packages/client/ui-xiaojing-browser-control/) | `ctx.tools`, Session events, loopback RPC, Playwright and extension bridge | `$DSH_HOME/browser-control/profile` and bridge credentials | Remove both Host and Client rows; the bundled extension resource can then be deleted |
| Windows computer control | [`packages/xiaojing/xiaojing-computer-control/`](../packages/xiaojing/xiaojing-computer-control/) | No separate settings page | `ctx.tools`, approval service, and controlled PowerShell helper | No business ledger | Remove the Host row |
| Desktop companion | [`packages/xiaojing/xiaojing-desktop-companion/`](../packages/xiaojing/xiaojing-desktop-companion/) | [`packages/client/ui-desktop-companion/`](../packages/client/ui-desktop-companion/) | Session and Weixin events, loopback SSE, and restricted preload | `desktop-companion/preferences-v1.json` | Removing Host and Client rows removes state and settings only; complete removal also deletes Electron window, tray, and asset wiring |
| Visualize | [`packages/xiaojing/xiaojing-visualize/`](../packages/xiaojing/xiaojing-visualize/) | The same package's `src/client/` | `ctx.tools`, skill provider, and tool-result renderer | Session tool results and workspace copies | Remove the single `xiaojing-visualize` row and its package dependency |

## Source structure and plug points

```text
E:/Projects/sudo agent/
├─ packages/
│  ├─ core/
│  ├─ llm/
│  │  └─ usage-accounting/
│  ├─ attachment/
│  ├─ client/
│  │  ├─ ui-*/
│  │  ├─ xiaojing-product/
│  │  ├─ ui-usage-accounting/
│  │  ├─ ui-weixin-channel/
│  │  ├─ ui-xiaojing-browser-control/
│  │  ├─ ui-xiaojing-finance-clients/
│  │  └─ ui-desktop-companion/
│  ├─ xiaojing/
│  │  ├─ xiaojing-finance-*/
│  │  ├─ xiaojing-browser-control/
│  │  ├─ xiaojing-computer-control/
│  │  ├─ xiaojing-weixin-channel/
│  │  ├─ xiaojing-desktop-companion/
│  │  └─ xiaojing-visualize/
│  ├─ bundle/web-app/presets/*.patch.yml
│  └─ boot/app-boot/
├─ apps/
│  ├─ cli/config/
│  │  └─ xiaojing-agent-presets/finance/
│  ├─ web/
│  └─ desktop/
├─ patches/
│  └─ dsh-file-uploads@1.0.0.patch
└─ scripts/
   └─ verify-xiaojing-product-layer.mjs
```

## Assembly process

1. `PROFILE_TEMPLATES.web` layers `dsh-base`, `dsh-web-app`, and `dsh-file-uploads` in that order.
2. Profile boot inserts `xiaojing-agent-presets/finance/agent.cordis.yml` only when `DSH_CLIENT_BUILD_PROFILE=xiaojing`, after all bundle patches and before profile, home, and command-line overlays.
3. The `dsh-web-app` `cordis.patch.yml` inserts Host rows and Client rows carrying `dsh.client` declarations.
4. `client-modules` scans the Client roster and creates `window.__DSH_BOOT__`; browser-side Cordis then installs that roster.
5. The Xiaojing build profile lets product Client plugins register brand, active-locale Finance display copy, and product-only settings; the declarative Finance row retains fallback metadata, while the official build keeps neutral fallbacks.
6. Electron starts the same Web profile, pins the user-data root, and exposes only enumerated desktop operations through preload.

Cordis registrations return disposers, while `ctx.effect()` and `ctx.on()` unwind their registrations when a plugin unloads. Plugins therefore must not bypass Cordis with permanent module-level global side effects. Host and Client packages communicate through public Remote, RPC, SSE, or event interfaces rather than importing each other's internal implementations.

## Removal levels

### Pure Cordis features

Visualize and Windows control can be disabled through one Host row. Accounting, Weixin, and Edge consist of Host/Client row pairs and should be disabled together so no empty settings page or unreachable Host service remains.

### Product UI

The `xiaojing-product` row contributes the brand, but the build environment also determines which bytes enter the Client artifact. A removal check must build the official Client profile and prove that neutral fallbacks work independently.

Finance removal is narrower than removing the whole product UI but wider than deleting one preset file: remove the declarative patch, Finance display registration, all five skill entries and directories, the Finance Host/Client composition rows and package inventories, and focused checks together. No runtime preset root, directory discovery, or `preset.yml` sidecar participates.

### Native desktop behavior

The companion's state aggregation and settings are Cordis plugins, while its transparent window, tray, and animation belong to Electron. Complete removal is one controlled change across all three integration points; deleting only the UI component would leave native lifecycle code behind.

### Third-party integration patches

`dsh-file-uploads` ships through the profile, application dependency, and pnpm patch. It has an explicit inventory and focused tests, but it is not an upstream-zero-touch plugin. Every Harness upgrade must revalidate that patch.

## Rules that prevent architectural erosion

1. **Do not change Agent Loop.** Use tools, events, waterfalls, Remote, or UI slots; if a seam is missing, add only a neutral minimal interface to its upstream owner.
2. **Give each behavior one owner.** Accounting calculation belongs to the Host, its rendering belongs to the Client, and native windows belong to Electron; do not copy business decisions between packages.
3. **Connect Host and Client through stable interfaces.** Client code does not import Host internals, Host code does not depend on React, and credentials or sensitive paths do not enter browser snapshots.
4. **Concentrate version drift.** LLM changes enter `usage-accounting/src/compat.ts`, product layout changes enter neutral slots, and external-package differences enter the `integration-patches.json` inventory.
5. **Give each persisted file one owner.** Persisted data carries a schema version, migration is atomic, and the installer never confuses the application directory with the user-data directory.
6. **Every feature must be independently disabled and tested.** Tests cover enabled, disabled, restart recovery, data retention, and absence of regressions after removal.
7. **Forbid hidden cross-plugin coupling.** Shared data becomes a typed service, event, or Remote; one plugin never collaborates by reading another plugin's private JSON or DOM.
8. **Keep assembly declarative.** `cordis.patch.yml` lists plugins, order, and configuration; it does not implement business algorithms.

## Recommended architecture convergence

The highest-value next cleanup is to move all product-specific configuration rows out of the shared [`packages/bundle/web-app/cordis.patch.yml`](../packages/bundle/web-app/cordis.patch.yml) and into a dedicated `packages/bundle/xiaojing-app/cordis.patch.yml`. The target composition is `dsh-base → dsh-web-app → dsh-file-uploads → xiaojing-app`. Future upstream upgrades would then compare the original `web-app` directly, while Xiaojing feature changes would remain in the product bundle and the official profile could prove that it loads no Xiaojing Host tools.

Finance already establishes this pattern in the product manifest: `agentPresets` records the declarative composition path and display identity, while `financeExtension` inventories the five skills, package and composition-row prefixes, compatibility-adapter rule, protected data root, and exact Host/Client packages. The verifier checks them together. After the dedicated product bundle exists, extend the same manifest-driven inventory to other features so a partial removal or missing release-protection entry fails automatically. Do not add a shared feature superclass or another framework until a second real consumer requires it.

## New feature directory template

```text
packages/xiaojing/xiaojing-<feature>/
├─ src/index.ts
├─ src/types.ts
├─ src/compat.ts
├─ tests/
└─ README.md / README.zh.md

packages/client/ui-xiaojing-<feature>/
├─ src/client/index.ts
├─ src/client/*.tsx
├─ tests/
└─ README.md / README.zh.md
```

Finance capability packages use the narrower `xiaojing-finance-<capability>` and `ui-xiaojing-finance-<capability>` names declared by the product manifest. Do not create either package until one complete Service Definition, provider, and consumer path is ready to ship.

Before implementing a new feature, name its Host owner, Client owner, extension point, persistence path, sensitive-data rule, configuration rows, complete removal procedure, and focused verification. If one item cannot be named, the module boundary is not ready for implementation.
