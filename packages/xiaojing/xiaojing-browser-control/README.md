# @deepseek-ai/dsh-xiaojing-browser-control

English | [中文](README.zh.md)

Semantic browser automation for Xiaojing. One Cordis plugin provides `ctx.xiaojingBrowserControl`, registers the `browser_control` consumer, and starts Microsoft Edge with a dedicated persistent profile. An explicit Chromium executable remains available for tests or a controlled deployment, but the Xiaojing Windows package does not bundle Chrome for Testing.

The model receives bounded page text and opaque targets derived from visible interactive elements. Targets expire and are invalidated after an action or tab switch. The tool never accepts model-supplied CSS selectors, JavaScript, CDP commands, or browser profile paths.

Private-network navigation, local file upload, Enter/Delete/Backspace key commits, submit controls, and controls whose labels indicate payment, deletion, transfer, publishing, or sending require a one-use decision from `ctx.approval` before the action runs.

Service Worker traffic is classified without assuming that the request has a frame. Public destinations continue normally. A private destination is allowed only when the worker origin matches an open page that already has approval for that host.

Cancellation and navigation failure close the affected tab and preserve a replacement blank tab when it was the browser's last page. A later request can therefore reuse the same Edge process instead of leaving the tool stalled or closing the visible browser window.

## Configuration

- `profileDir` is required and must identify a dedicated browser profile.
- `executablePath` points at an optional deployment-controlled Chromium executable. Edge is still attempted first, and the Xiaojing Windows application leaves this unset.
- `headless`, timeouts, observation lifetime, and page, target, and text result limits are deployment tunables.
- `allowPrivateHosts` exists only for deterministic local tests and must remain false in the product composition.

## Model Experience

### `browser_control` schema

#### What the model sees

The [`browser_control` schema](../../../docs/tool-catalog.md#deepseek-aidsh-xiaojing-browser-control), which instructs the model to use `open`, then operate only opaque IDs from the latest observation. Every page operation returns a fresh `observationId`, bounded visible `text`, and semantic `targets`; subsequent target actions must use IDs from that exact observation. Websites use this tool instead of Windows computer control.

#### Token effect

One stable tool definition appears on every request. Results add bounded page, text, and target metadata only to the current conversation suffix; configured result limits cap that variable output.

#### KV Cache effect

The schema is stable for the life of the plugin and does not invalidate the cached request prefix between turns. Browser observations appear after that prefix as ordinary tool results.

## Known Limitations and Deferred Work

- The first release uses DOM semantics and visible text; it does not inspect pixels, solve CAPTCHAs, bypass anti-automation controls, attach to a person's existing browser profile, or operate browser chrome outside the controlled page.
- Sites implemented as a single canvas require a future vision capability.
- The Windows product requires Microsoft Edge; if Edge is removed or blocked by device policy, browser automation fails with an explicit diagnostic.
