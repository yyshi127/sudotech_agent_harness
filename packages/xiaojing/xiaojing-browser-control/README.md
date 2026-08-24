# @deepseek-ai/dsh-xiaojing-browser-control

English | [中文](README.zh.md)

Semantic Microsoft Edge automation for Xiaojing. One removable Cordis plugin provides `ctx.xiaojingBrowserControl`, registers the `browser_control` consumer, and starts Edge with a dedicated persistent profile. The plugin neither attaches to nor changes a person's normal Edge profile.

`open` discovers pages that already exist in the controlled Edge context, including tabs opened there by the user. It reuses an exact destination, then a same-origin page, then a blank page, removes redundant blank tabs, and creates another tab only when none is suitable. Later semantic actions continue on the session's active page.

The model receives bounded page text and opaque targets derived from visible interactive elements. Each target retains the exact observed DOM node, so a replacement or detached node fails and requires a new observation instead of allowing a positional locator to hit another control. Targets expire after an action or tab switch. The tool never accepts model-supplied CSS selectors, JavaScript, CDP commands, browser profile paths, or password values.

Private-network navigation, local file upload, Enter/Delete/Backspace key commits, submit controls, and controls whose labels indicate payment, deletion, transfer, publishing, or sending require a one-use decision from `ctx.approval` before the action runs. Delete-key actions and controls labelled for deletion, removal, or uninstall use mandatory confirmation, so the session's `never` policy cannot suppress the question.

Service Worker traffic is classified without assuming that the request has a frame. Public destinations continue normally. A private destination is allowed only when the worker origin matches an open page that already has approval for that host.

Cancellation and navigation failure close the affected tab and preserve a replacement blank tab when it was Edge's last page. Closing browser control cancels running and queued operations and waits for them to settle before a later request may relaunch Edge. An unexpected Edge exit invalidates queued work from that instance, and unloading the plugin permanently rejects further operations. Edge starts visibly; users may sign in and minimize it while ordinary DOM actions continue through Playwright without moving the physical mouse or typing through the physical keyboard.

## Configuration

- `profileDir` is required and identifies the dedicated Edge profile.
- `executablePath` points at an optional Edge-compatible executable for tests or a controlled deployment. The Xiaojing Windows application leaves it unset.
- `headless`, timeouts, observation lifetime, and page, target, and text result limits are deployment tunables.
- `allowPrivateHosts` exists only for deterministic local tests and must remain false in the product composition.

## Model Experience

### `browser_control` schema

#### What the model sees

The [`browser_control` schema](../../../docs/tool-catalog.md#deepseek-aidsh-xiaojing-browser-control) tells the model that this capability owns the dedicated Microsoft Edge profile, requires existing-page reuse before creating a tab, and accepts only opaque IDs from the latest observation. Every page operation returns a fresh `observationId`, bounded visible `text`, and semantic `targets`. Websites use this tool instead of Windows computer control.

#### Token effect

One stable tool definition appears on every request. Results add bounded page, text, and target metadata only to the current conversation suffix, so observations do not invalidate the cached request prefix between turns.

#### KV Cache effect

The schema remains stable for the life of the plugin. Page observations appear after the cached request prefix as ordinary tool results.

## Known Limitations and Deferred Work

- The implementation uses DOM semantics and visible text; it does not inspect pixels, solve CAPTCHAs, bypass anti-automation controls, attach to a person's existing browser profile, or operate browser chrome outside the controlled page.
- Sites implemented as a single canvas require a separate vision capability.
- Microsoft Edge must be installed and allowed by device policy.
- Native authentication, certificate, UKey, download, and operating-system dialogs are outside DOM automation and may require the user to restore Edge or use `computer_control`.
