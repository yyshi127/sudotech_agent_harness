---
kind: upgrade-guide
description: Xiaojing replaces the default Edge-only browser tool and its pairing settings with native Edge and Chrome connections.
---

# Xiaojing native browser connections

English | [中文](guide.zh.md)

## Change

The Xiaojing Web and Desktop composition disables the legacy `browser_control` Host and replaces its pairing page with Chrome and Edge permission switches. The `@deepseek-ai/dsh-xiaojing-browser-control/native` entry provides `browser_connect` followed by the selected native MCP tools. Edge remains the default; explicitly requested Chrome is supported. Enabling a browser prefers its existing tabs; otherwise an omitted surface uses a dedicated browser. The official DSH composition is unchanged.

Existing Xiaojing Edge extension pairing does not authorize the official Playwright extension. Saved legacy configuration, credentials, business data, and browser profiles are retained. The native-settings status response adds required `canOpenSettings`; custom Clients must consume the matching Host version. The service adds `openSettingsTimeoutMs`, defaulting to 30000 milliseconds, for fixed settings-page navigation; existing native connection timeouts are unchanged.

## Migration

1. Update prompts or automation that call `browser_control` to call `browser_connect`, then use its returned tool prefix. Select `browser: "chrome"` only when requested and `surface: "existing"` for already-open tabs.
2. Update custom settings status parsers to accept `canOpenSettings`, and ship the Host and Client together. For existing tabs, enable the requested browser in Browser Control settings. Manage displays instructions; on Windows, click Open settings to open the correct inspect page in a new normal window. Other platforms retain a copyable address. Allow remote debugging and approve the browser's connection request yourself. The application does not enable debugging or navigate existing windows. Permission switches initially remain off; disabling disconnects access without closing the browser. Explicit deployments retain CDP and official Playwright extension routes. See the [connection prerequisites](../../../../packages/xiaojing/xiaojing-browser-control/README.md#connecting-already-open-tabs).
3. Confirm `browser_connect` returns the intended browser and tab list. A failed connection requires an explicit reconnect and never falls back to another browser.
