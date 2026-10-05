---
description: "Xiaojing settings for controlling existing Chrome and Edge tabs"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-xiaojing-browser-control

English | [中文](README.zh.md)

## Summary

Local Chrome and Edge settings for Xiaojing. The plugin contributes one removable `settings.section` when `DSH_CLIENT_BUILD_PROFILE=xiaojing` and the Client connection is loopback; its Node entry has no runtime behavior.

## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Capabilities

Each browser row displays installation, operator permission, and the Host's observed connection state. Failed discovery is shown as unknown, retains its row error, and does not block the other browser. A switch permits control of already-open tabs; enabling it does not establish a connection. Existing permission can be revoked even if installation discovery fails or the browser was uninstalled. Revocation leaves the user's browser open. Dedicated Xiaojing browsers remain available.

Manage shows the selected browser's fixed remote-debugging address, a copy control, and an explicit Open settings button on Windows. Clicking Open asks the Host to open a new normal browser window and verify its actual inspect page before showing success. The user still allows remote debugging and approves connection requests when tasks connect. Failure retains manual setup and an explicit retry; overlapping opens are disabled, and a closed guide's result cannot update a different browser's guide. Other platforms retain copying instructions. Instructions also appear after a confirmed enable response reports incomplete setup; dismissing them does not change permission, and polling does not reopen them. Manage, enabling permission, and polling alone never launch a browser. This route needs no extension, pairing code, port, or token field.

`BrowserControlController` uses authenticated Connection RPC at `/xiaojing-native-browser-control` with `status`, `set-enabled`, and fixed-brand `open-settings`. Status requires `canOpenSettings` and one row per browser; the parser removes fields outside the Client-safe status. Ship the matching Host and Client together. Installation paths and credentials do not enter the view. Refreshes retain existing content, failed operations retain confirmed permissions, stale reads cannot replace newer operator requests, and unmounting clears polling.

## Verification

Focused Client tests and owner-local instruction snapshots cover both browsers' controls, fixed addresses, verified-open feedback, opening failures and explicit retry, unsupported platforms, dismissal during opening, copy failures, setup and connected states, missing installations, disabling, stale responses, malformed JSON, polling disposal, and profile/loopback registration. Host process identity and actual settings navigation belong to `@deepseek-ai/dsh-xiaojing-browser-control`. The UI uses shared controls and semantic theme tokens.

## Model Experience

None, as this Client package contributes no model-visible input or tool.

#### KV Cache effect

None; the Host native browser plugin owns `browser_connect` and its native tool results.

## Known Limitations and Deferred Work

- Browser settings and connection approval require the user. This page does not approve requests, inspect tabs, or initiate a browser connection; the owning task does so. Removing this page does not change persisted Host permission.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because the owning registry and Host services enforce these relationships directly; this package has no independent observation to compare.
