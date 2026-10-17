---
description: "Xiaojing native Edge and Chrome browser control and the optional legacy Edge adapter"
kind: "package-reference"
---

# @deepseek-ai/dsh-xiaojing-browser-control

English | [中文](README.zh.md)

## Summary

Xiaojing's `./native` entry connects Edge or Chrome through the Harness browser MCP providers. Its `./native-settings` service supplies persisted operator permissions to the product settings Client. The product disables the legacy `browser_control` Host; the package root retains that adapter for explicit deployments. These entries do not modify `agent-loop` or browser enterprise policies.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Capabilities

<a id="native-browser-connections"></a>
## Native browser connections

`browser_connect` defaults to `browser: "edge"`. An omitted `surface` uses existing tabs when the operator has enabled that browser in Browser Control settings; otherwise it uses `managed`. The product prompt chooses Chrome only when the user names Chrome or 谷歌浏览器, and chooses `surface: "existing"` for already-open tabs. Ordinary chat opens no browser or MCP process. A successful connection records the native tab list and returns its tool prefix.

Managed browsers, configured CDP endpoints, and native profile discovery use the [Harness Chrome DevTools provider](../../experimental/browser-use-chrome-devtools-mcp/README.md). Explicit deployments can select the [Harness Playwright provider](../../experimental/browser-use-playwright-mcp/README.md) in official extension mode. The selected upstream schemas expose snapshots, scripts, screenshots, forms, tabs, and other native operations.

Managed Edge starts the installed browser visibly with an owned temporary profile and loopback CDP endpoint, retaining the browser sandbox. Native DevTools performs all webpage operations through that endpoint. `managedBrowserTimeoutMs` bounds executable discovery, policy checks, and managed Edge startup and cleanup, and defaults to 30000 milliseconds; failed cleanup retains the profile and its ownership instead of deleting files before process exit. Windows Chrome policies that force `UserDataDir` prevent managed launch; use `existing` to connect to that personal browser.

<a id="connecting-already-open-tabs"></a>
### Connecting already-open tabs

Enable the requested browser in Xiaojing's Browser Control settings. Manage shows instructions and the fixed `chrome://inspect/#remote-debugging` or `edge://inspect/#remote-debugging` address. On Windows, the explicit Open settings button opens and verifies that page in a new normal browser window; the user still enables remote debugging and approves connections. It validates the installation, unique new window, process identity, blank address bar, fixed navigation, and loaded inspect document through Windows UI Automation; it never navigates an existing window. Chromium rejects internal command-line launch URLs, so only `about:blank` is passed at launch. Failed verification reports failure and retains the copy action without closing browser windows. Other platforms use the manual address. Native auto-connect discovers the existing profile. Chrome requires version 144 or later; Edge must support the remote debugging permission page. No extension, port, or token entry is required. New connections can require approval; the product switch does not guarantee permanent approval. Closing the switch disconnects existing-tab control without closing the personal browser.

Profile discovery reads only Windows `UserDataDir` and `RemoteDebuggingAllowed` policy metadata. An explicit absolute directory takes precedence over policy, then the stable LocalAppData directory. Prohibited debugging and failed or invalid policy queries refuse acquisition. The application does not read Preferences or credentials, change policy, automatically enable debugging, or bypass browser approval. Variable-based policy directories require an explicit absolute override.

Explicit deployments can configure an enabled `existingEndpoint` or select `existingConnection: "extension"` and install the [official Playwright browser extension](https://github.com/microsoft/playwright-mcp#browser-extension). Its connection requires approval and tab selection. The old Xiaojing Edge extension and its pairing code cannot establish this connection.

Connection failure revokes the Session's selection. It never selects another browser, opens a replacement window, or replays completed actions. Diagnostics identify the selected browser; a native HTTP 403 reports connection rejection without claiming its cause. Explicitly reconnect before using browser tools. Managed connections belong to one live Agent; existing-browser connections have one owner until release. Calls queue per connection and re-check their selected route before execution. Disposal waits for in-flight work, closes owned managed browsers, and disconnects existing browsers without closing their tabs.

Native connections require `workingDirectory`. Each MCP server starts in the Session's validated current working directory and keeps that launch directory until its connection is released. A later connection uses the then-current directory; the immutable Session header does not select the process directory.

### Native configuration and approvals

The product explicitly adopts the three upstream experimental native-browser packages under the [exact source and installed-dependency policy](../../../.agents/notes/implemented/process/2026-10-03-xiaojing-native-browser-adoption.md); their API status and isolation from other consumers remain unchanged.

The package publishes three independent Host bundles: `lib/index.js`, `lib/native.js`, and `lib/native-settings.js`, plus their declarations. It carries the legacy pairing extension's runtime files under `extension/` for the optional package-root entry. Native imports do not start browser processes or mount the legacy adapter; connections begin with `browser_connect`. Settings imports do not establish a browser connection.

`NativeBrowser` identifies `edge` or `chrome`. The Host-only `NativeBrowserSettingsRuntime` registration supplies installation inspection, observed connection state, and revocation callbacks to the settings service; its disposer removes only that runtime's registration. These declarations are owned by `src/native-settings-types.ts` rather than the generic subsystems type catalog.

`edge` and `chrome` accept optional `executablePath`, `existingEndpoint`, `existingConnection`, absolute `userDataDir`, and secret `extensionToken`. An omitted `existingConnection` preserves the explicit extension deployment; Xiaojing sets `auto-connect`. Its `requireUserSettings` refuses existing access when the permission service is unavailable or the browser is disabled. `./native-settings` persists its live `edge` and `chrome` booleans in the profile, initially false. Its `openSettingsTimeoutMs` defaults to 30000 milliseconds and bounds fixed settings-page navigation; overlapping open requests are refused, and disposal cancels and joins the pending operation. Status includes the required `canOpenSettings` boolean, true only on Windows; ship the matching Host and Client together. The authenticated `open-settings` RPC accepts only a browser brand and does not establish a native connection or grant permission. Settings reports installation and setup readiness separately from a successful native connection; reading status does not acquire browser resources. Failed installation inspection reports an unknown installation state without blocking the other browser or revocation. Disabling saves the permission before releasing connections; repeating an already-disabled request does not release again. Enabling saves intent without launching a browser or enabling debugging.

`connectTimeoutMs` defaults to 600000 milliseconds for the connection probe, including browser approval; `toolCallTimeoutMs` defaults to 60000 milliseconds for subsequent native calls. The product composition accepts `XIAOJING_NATIVE_EDGE_EXECUTABLE`, `XIAOJING_CHROME_EXECUTABLE`, `XIAOJING_EDGE_CDP_ENDPOINT`, `XIAOJING_CHROME_CDP_ENDPOINT`, and the corresponding `XIAOJING_EDGE_PLAYWRIGHT_EXTENSION_TOKEN` / `XIAOJING_CHROME_PLAYWRIGHT_EXTENSION_TOKEN`. `allowPrivateHosts` remains false in production.

Actions are classified from native observations rather than model-written element descriptions. Uploads, browser code, coordinate actions, unverified targets, and external-impact or deletion controls require mandatory approval. Password entry remains manual. Private destinations require approval; this application-level check does not isolate every request made by scripts or redirects. Browser-policy restrictions and stale references report failure rather than falling back to desktop clicking.

A mandatory control approval offers session authorization only when the current native snapshot uniquely identifies each control and the observed page has an HTTP(S) origin. Authorization covers the same browser, managed or existing route, origin, complete control labels, and operation category; refreshed native references retain that classification. Scripts and coordinate tools also offer “Always allow”: their displayed scope covers the entire connected browser for that operation class, not one website. Browser brand, managed or existing route, script or coordinate class, and Session remain distinct. Each protected call still invokes the approval service and the exact execution-token guard. Uploads, unverified destinations or targets, duplicate labels, and unfocused keyboard actions remain one-shot. Approval explanations follow the interface language without changing logged model-facing reasons.

## Legacy Edge entry

The following sections describe the optional package-root entry, disabled in the current product composition.

The personal Edge settings RPC registers a Web route through Connection, so the Host plugin requires both `connection` and `webServer` at startup.

## Edge routes

The dedicated route is the default and works without setup. It starts installed Microsoft Edge visibly with a persistent profile at the configured `profileDir`. Users may sign in, minimize the window, and let Playwright continue ordinary DOM operations without moving the physical mouse or typing through the physical keyboard. Only `disposition: "new_window"` creates another top-level window.

The optional personal route controls ordinary HTTP(S) tabs that a user opened in their everyday Edge. Its Manifest V3 extension is shipped in [`extension/`](extension/) as an unpacked directory. The user enables Edge developer mode, loads that directory once, and pairs it with an eight-character code from Xiaojing settings. The extension attaches `chrome.debugger` only to the leased target tab and detaches on turn end, failure, cancellation, or plugin shutdown. Edge's extension-debugging banner is expected. InPrivate, `edge://`, extension, file, and other protected pages are rejected.

`open` applies one routing order across both adapters:

1. A matching page already active for the requesting session.
2. The active matching personal Edge page.
3. Any exact URL match.
4. An existing same-origin page when the request is the website home.
5. A same-origin or blank dedicated Edge page.
6. A newly started dedicated Edge page.

An explicit `surface: "managed"` or `surface: "personal"` restricts discovery to that route. The product prompt permits this override only when the user explicitly names the route. The automatic route never navigates an unrelated personal tab, never silently changes browser routes after partial execution, and never repeatedly launches windows when the optional extension is offline.

## Semantic execution

Each frame is scanned once per observation, including iframes and open Shadow DOM. The bounded projection records accessible role, name, state, input type, and dialog, table-row, form, or region context. Native and ARIA controls enter directly; compact visible `div`, `span`, and `li` controls with pointer interaction enter as buttons without inherited child duplicates. Opaque target IDs remain scoped to the requesting Agent session. A semantic descriptor can relocate the same control after a React or SPA re-render; a missing, ambiguous, or context-changed control stops the action instead of clicking the same screen coordinates.

`act` executes a bounded sequence of click, fill, type, select, check, uncheck, hover, press, scroll, upload, and event-driven wait steps. Playwright or the fixed extension protocol performs automatic actionability waits. Each field value, selected value, checked state, requested URL, or requested text is verified before the next step. The first failure stops the sequence and reports `completedSteps` and `failedStep`; completed steps are never replayed. Single-step actions remain available.

Normal results are compact, while `open`, `observe`, `show`, and completed batches return a fresh bounded observation. File choosers, JavaScript dialogs, popups, and new tabs participate in the same action lifecycle. The plugin does not accept model-provided JavaScript, CSS selectors, CDP commands, profile paths, password values, screenshot coordinates, or UI Automation commands. `computer_control` is not an automatic webpage fallback.

The page registry is process-global, so a new session can discover a page left by an older session. A page lease belongs to one Agent turn and is released at `turn/end`, cancellation, failure, close, or disposal. Desktop and Weixin tasks cannot operate the same tab concurrently. Page and window IDs remain session-local aliases even though discovery is global.

## Approval and network policy

When an office session explicitly enables No approvals, the approval service automatically grants the tool approvals described below, including mandatory confirmations; browser connection permission and Windows elevation remain controlled by those platforms.

Reading, opening public pages, normal menu clicks, and ordinary field edits do not require approval. Local file upload and actions labelled as saving, approving, sending, publishing, paying, transferring, purchasing, signing, or submitting require one approval before execution, including under a `never` approval policy. A batch receives one decision before its first protected step. Delete keys and controls labelled for deletion, removal, uninstall, erase, or clearing always use mandatory confirmation, including under Full access or the `never` policy. Protected requests made directly through the Host service fail closed; only the registered `browser_control` tool can complete the approval path.

Private and loopback destinations require approval unless `allowPrivateHosts` is enabled in deterministic tests. Service Worker traffic is classified without assuming a frame and may reach a private host only when its origin belongs to an open page that already has approval for that host.

## Personal Edge bridge security

The extension probes only `127.0.0.1:53170–53179`. Pairing codes expire after two minutes and become invalid after five failed attempts. Successful pairing creates a random long-term secret stored by the Harness credential service and `chrome.storage.local`; the settings Client receives only sanitized state, extension ID, version, and pairing expiry. Secrets, CDP payloads, page content, and target data do not enter the browser settings Client or logs.

The Host validates the fixed extension ID and protocol version, then both sides prove possession of the stored secret through nonce-bound HMAC values before any browser command is accepted; a routine reconnect never sends the secret itself. The extension accepts requests only after that handshake and only within the package-owned semantic command vocabulary. It does not accept arbitrary JavaScript, selectors, or CDP methods. Removing the Host Cordis plugin and the Client settings plugin removes the capability without changing Harness core.

## Configuration

- `profileDir` is required and identifies the dedicated Edge profile.
- `executablePath` points at an optional Edge-compatible executable for tests or controlled deployment. The Xiaojing Windows application leaves it unset.
- `headless`, action and navigation timeouts, observation lifetime, result limits, and maximum batch length are deployment tunables.
- `allowPrivateHosts` exists only for deterministic local tests and must remain false in the product composition.

## Model Experience

### Native browser tool discovery

#### What the model sees

Before connection, the model sees `browser_connect`. Acquiring a connection adds its native MCP catalog and instructions to the owning Agent; the connection result records the tab list. Inactive routes contribute no MCP instructions and cannot execute tools. Results and approval events use the normal tool and Session logging paths. Native tool presentation excludes inactive route schemas. PTC's generated SDK can retain previously acquired route names; calls through them still fail the selected-route check.

#### Token effect

Connection adds the selected upstream tool schemas and instructions. Snapshots add upstream content to the conversation.

#### KV Cache effect

Changing the connection changes MCP instructions and available schemas, which may change the request prefix.

### `browser_control` schema

#### What the model sees

The `browser_control` schema tells the model to reuse matching pages before creating one, batch forms and menus with `act`, and keep webpage work on DOM semantics. Results identify `managed` or `personal` surface, opaque session-local page and window IDs, and bounded semantic observations. The model cannot install the extension or bypass its pairing state. The generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-xiaojing-browser-control) records this schema.

#### Token effect

One stable tool definition appears on every request. Normal actions return compact status; explicit observations and final batch results add bounded text and target metadata only to the current conversation suffix.

#### KV Cache effect

The schema remains stable for the plugin lifetime. Page observations appear after the cached request prefix as ordinary tool results.

## Known Limitations and Deferred Work

- Finance reports are not a browser-control capability. D01–D06 require supported supplier APIs; the rejected browser route is recorded in the [browser-report decision](../../../.agents/notes/rejected/architecture/2026-09-14-native-finance-reports.md).

- Microsoft Edge must be installed and allowed by device policy; the application does not bundle a browser runtime.
- Native existing-tab control requires the browser's remote debugging permission and connection approval; explicit deployments can instead use an enabled CDP endpoint or the official extension. The legacy adapter requires its separate unpacked extension and pairing.
- Closed Shadow DOM, canvas-only pages, CAPTCHAs, UKey and certificate prompts, secure browser surfaces, and operating-system dialogs require user handling.
- A browser or another DevTools client may deny `chrome.debugger` attachment. The plugin reports that failure and does not switch routes or repeat already completed actions.
- The legacy adapter excludes pixel interaction. Native coordinate and browser-code tools remain available with mandatory approval.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
