---
description: "Xiaojing semantic browser automation over Microsoft Edge"
kind: "package-reference"
---

# @deepseek-ai/dsh-xiaojing-browser-control

English | [中文](README.zh.md)

## Summary

DOM-first Microsoft Edge automation for Xiaojing. One removable Cordis plugin owns the `browser_control` tool, a global page registry, per-turn page leases, a dedicated Playwright Edge adapter, and an optional personal Edge extension adapter. It does not modify `agent-loop`, official UI packages, or a person's Edge profile.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Capabilities

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
- Personal Edge takeover requires one manual unpacked-extension installation and pairing. Silent installation on an unmanaged Windows device is not supported.
- Closed Shadow DOM, canvas-only pages, CAPTCHAs, UKey and certificate prompts, secure browser surfaces, and operating-system dialogs require user handling.
- A browser or another DevTools client may deny `chrome.debugger` attachment. The plugin reports that failure and does not switch routes or repeat already completed actions.
- Pixel interpretation is not part of browser control. The model's vision capability may explain a user-provided image, but it does not authorize coordinate clicks.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
