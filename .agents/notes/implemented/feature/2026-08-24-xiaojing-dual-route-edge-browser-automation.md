# Agent Note: Xiaojing dual-route Edge browser automation

Status: implemented

English | [中文](2026-08-24-xiaojing-dual-route-edge-browser-automation.zh.md)

## Problem

The dedicated Playwright Edge route provided reliable DOM automation but could not attach to ordinary tabs in the user's personal Edge profile. Earlier UI Automation and screenshot attempts could discover some windows but were slow, depended on foreground focus, missed Web controls, produced coordinate approvals for ordinary clicks, and could neither guarantee target identity nor preserve partially completed form work. Opening another dedicated page whenever a personal page was unavailable also caused duplicate tabs and made separate desktop and Weixin tasks capable of selecting the same visible page.

## Decision

`@deepseek-ai/dsh-xiaojing-browser-control` remains one removable Cordis capability with two adapters behind one model tool. The managed adapter is the default, starts installed Microsoft Edge with Xiaojing's dedicated persistent profile, and uses Playwright DOM automation. The personal adapter is optional and uses a supplied Manifest V3 extension to attach to ordinary HTTP or HTTPS tabs in the user's personal Edge. The extension is manually sideloaded and paired on unmanaged Windows installations; neither Edge Add-ons publication nor enterprise policy is required for development and internal deployment.

The coordinator owns a process-wide page registry and leases one page to one Agent turn. Page selection prefers a matching page already bound to the session, then the active matching personal page, another exact URL, an appropriate same-origin page, and finally a managed blank or new page. It does not navigate an unrelated personal tab, does not create a top-level window unless `disposition: "new_window"` is explicit, and does not replay a partially executed personal task in managed Edge after the extension disconnects. `turn/end`, cancellation, failure, and plugin disposal release leases and detach personal tabs.

One bounded semantic scan runs per frame and traverses nested frames and open shadow roots. Targets contain role, accessible name, state, ordinal, and nearby dialog, table-row, and region context rather than selectors or coordinates. Native and ARIA controls enter directly; compact visible pointer-interactive `div`, `span`, and `li` controls enter as buttons while inherited child duplicates are suppressed. Every action resolves the fingerprint again before execution. Equivalent targets survive React replacement, while changed identity or context fails and requires a fresh observation. The `act` action executes a bounded list of click, fill, type, select, check, uncheck, hover, press, scroll, upload, and wait steps, validates completed state, stops at the first failure, and returns `completedSteps` and `failedStep` without replaying completed steps.

Ordinary browser work remains background DOM automation and never invokes screenshot coordinates, Windows UI Automation, or `computer_control` as an automatic fallback. `show` is the explicit foreground operation. Upload and actions that submit, send, publish, pay, transfer, or otherwise create an external effect require one approval before the affected batch starts; deletion always requires approval even when the session normally never asks. Native dialogs, CAPTCHAs, closed shadow roots, protected Edge pages, InPrivate tabs, local-file pages, and canvas-only controls remain user-handled.

The personal bridge listens only on `127.0.0.1` within ports `53170–53179`. Pairing uses an eight-character one-time code valid for two minutes with at most five failed attempts. Successful pairing creates a random long-term secret stored in the Harness credential service and extension local storage. The bridge checks the fixed extension ID and protocol version, then both sides prove possession of that secret through nonce-bound HMAC values before a routine reconnect accepts commands; the secret itself is not retransmitted. Secrets, raw CDP traffic, and page content do not enter the settings UI or logs. The model receives only fixed semantic actions and cannot provide JavaScript, CSS selectors, or arbitrary CDP commands. The extension attaches only for a task and detaches on completion, failure, cancellation, or disconnect.

`@deepseek-ai/dsh-client-ui-xiaojing-browser-control` remains independently removable and owns the loopback-only settings section. It reports managed Edge readiness, reveals the packaged extension directory, opens `edge://extensions`, starts or cancels pairing, shows a sanitized extension version and connection state, and revokes authorization. Removing the Host and Client composition rows removes the complete browser feature without modifying Harness core, the Xiaojing product layer, or durable data owned by other plugins.

This decision supersedes the statement in [Xiaojing Edge-only browser automation](2026-08-24-xiaojing-edge-only-browser-automation.md) that attaching to a personal browser is deferred. That note continues to own the removal of Chrome and the non-destructive treatment of its retired profile. [Xiaojing semantic browser and Windows automation](2026-08-21-xiaojing-semantic-automation.md) continues to own capability separation and Windows-native automation.

## Alternatives considered

- **Use UI Automation for personal Edge.** Rejected because it requires focus for many operations, exposes an incomplete accessibility tree, and cannot provide DOM-grade target identity or reliable background form work.
- **Use screenshots and coordinate clicks after DOM failure.** Rejected because coordinates are not stable target identities, can affect the wrong control after layout changes, and caused unnecessary approval prompts for ordinary navigation.
- **Start personal Edge with a remote-debugging port.** Rejected because it requires a special startup profile, cannot safely attach to an already running ordinary profile, and changes the user's browser lifecycle.
- **Make the extension the only route.** Rejected because unmanaged Windows cannot silently install or authorize it. Dedicated Edge must remain an immediately available and independently reliable route.
- **Retry a disconnected personal task in managed Edge.** Rejected because external effects completed before disconnection could be submitted twice.

## Verification

Managed-route tests cover repeated and cross-session page reuse, one hundred reuse cycles without duplicate tabs, per-turn lease isolation, nested frames, open shadow roots, repeated labels with context, delegated pointer tabs, React replacement, SPA navigation, select and checkbox state, bounded multi-step form execution, partial failure without replay, protected deletion, interrupted navigation, relaunch, and disposal. Bridge tests cover the shipped extension scanner and click path, pairing success, expiry, five failed attempts, wrong extension identity, wrong protocol, wrong secret, attach/detach, cancellation, disconnect, and credential revocation. Client tests cover the loopback guard, managed state, extension installation actions, pairing states, sanitized status, disconnect, and slot disposal. Type, build, lint, hygiene, documentation, product-layer, assembled-preview, and focused regressions remain required before release.

## Consequences

Xiaojing has one stable Edge tool with an immediately available managed route and an explicit enhancement for personal tabs. Existing pages are reused before new tabs, browser tasks cannot share a leased page, multi-field work can complete with fewer model round trips, and ordinary browser operations do not steal the user's mouse or trigger coordinate approvals. Personal Edge requires a one-time manual extension sideload and displays Edge's normal debugger notice while attached; removing or disconnecting the extension leaves managed Edge available.
