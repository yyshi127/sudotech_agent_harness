---
description: "Xiaojing settings page for Microsoft Edge automation"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-xiaojing-browser-control

English | [中文](README.zh.md)

## Summary

Removable Xiaojing Client settings for Microsoft Edge automation. The plugin registers one `settings.section` only when `DSH_CLIENT_BUILD_PROFILE=xiaojing` and the Client connection is loopback. Removing its Web composition entry removes the page without changing the Host tool or official settings owners.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Capabilities

The page presents two routes:

- Dedicated Xiaojing Edge is always available without extension setup and reports whether its lazy Playwright runtime is ready or running.
- Personal Edge is optional and exposes unpacked-extension installation steps, extension ID and version, short-lived pairing, connection status, and authorization revocation.

`BrowserControlController` calls only `/xiaojing-browser-control` loopback RPC endpoints. It validates every status response before updating the observable view. The browser receives no long-term secret, CDP payload, page content, profile path, file path, or browser target. Buttons can open the local Edge extension manager and reveal the packaged extension directory through fixed Host actions; they cannot submit arbitrary commands or paths.

The page uses semantic host theme tokens and contains no product-global style mutation. Its lifecycle owns polling and pairing countdown timers, and unmounting the settings section clears both.

## Verification

Focused Client tests cover Xiaojing and loopback registration guards, managed-route presentation, personal-route setup controls, pairing-code rendering, connected metadata, revocation, malformed wire responses, and slot disposal. Host protocol and real Playwright behavior are tested by `@deepseek-ai/dsh-xiaojing-browser-control`.

## Model Experience

None, as this Client package only configures a separate Host capability and contributes no model-visible prompt, tool, or result.

#### KV Cache effect

None; the Host `browser_control` package owns the model-facing semantic protocol and any resulting provider-request content.

## Known Limitations and Deferred Work

- Personal Edge requires one manual unpacked-extension installation and pairing. An unmanaged Windows installation cannot silently install that extension.
- The page cannot test a real website on the user's behalf. Connection status confirms the authenticated local bridge, while task execution remains observable in the owning conversation.
- Edge Add-ons or enterprise-policy distribution is deferred. Removing the Client package removes only this settings section and does not revoke an already stored Host credential.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
