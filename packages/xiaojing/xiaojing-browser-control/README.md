# @deepseek-ai/dsh-xiaojing-browser-control

English | [中文](README.zh.md)

Semantic browser automation for Xiaojing. One Cordis plugin provides `ctx.xiaojingBrowserControl`, registers the `browser_control` consumer, and starts Microsoft Edge or Google Chrome with a browser-specific dedicated profile. The `xiaojing-browser-control` setting defaults to Edge and applies when a task does not name a browser. An explicit Chrome or Edge request overrides that task without changing the saved default; both controlled contexts may remain available, and neither silently falls back to the other browser. On Windows, Chrome startup first checks whether the mandatory `UserDataDir` policy would redirect the isolated launch into the live personal profile; that case fails before spawning Chrome instead of opening stray tabs in the personal window. An explicit executable remains available for tests or a controlled deployment, but the Xiaojing Windows package does not bundle Chrome for Testing.

`open` discovers pages that already exist in the requested controlled context, including tabs opened there by the user. It reuses an exact destination, then a same-origin page, then a blank page, closes redundant blank tabs owned by that controlled context, and creates a tab only when none is suitable. Later semantic actions continue on the session's active page. The product prompt prefers this capability for websites but does not intercept or block separate shell, PowerShell, or CDP operations. A selected-browser startup failure is reported without retrying another browser unless the user explicitly asks for one.

The model receives bounded page text and opaque targets derived from visible interactive elements. Each target retains the exact observed DOM node, so a replacement or detached node fails and requires a new observation instead of allowing a positional locator to hit a different control. Targets expire and are invalidated after an action or tab switch. The tool never accepts model-supplied CSS selectors, JavaScript, CDP commands, or browser profile paths.

Private-network navigation, local file upload, Enter/Delete/Backspace key commits, submit controls, and controls whose labels indicate payment, deletion, transfer, publishing, or sending require a one-use decision from `ctx.approval` before the action runs. Delete-key actions and controls labelled for deletion, removal, or uninstall use mandatory confirmation, so the session's `never` policy cannot suppress the question; the other listed actions retain ordinary approval behavior.

Service Worker traffic is classified without assuming that the request has a frame. Public destinations continue normally. A private destination is allowed only when the worker origin matches an open page that already has approval for that host.

Cancellation and navigation failure close the affected tab and preserve a replacement blank tab when it was the browser's last page. Closing browser control cancels both running and queued operations and waits for them to settle before a later request may relaunch the selected browser. An unexpected browser exit invalidates queued work from that instance, and unloading the plugin permanently rejects further operations. The product launches a visible browser; users may sign in and minimize it, while ordinary DOM actions continue through Playwright without moving the physical mouse or typing through the physical keyboard.

## Configuration

- `profileDir` is required and identifies the dedicated Edge profile.
- `chromeProfileDir` identifies the dedicated Chrome profile and defaults to a sibling of `profileDir`.
- `browser` is the default used when `open` or `tabs` omits its per-task browser override; the product default is `edge`.
- `executablePath` points at an optional deployment-controlled executable for the selected browser. It exists for tests and controlled deployments; the Xiaojing Windows application leaves it unset.
- `headless`, timeouts, observation lifetime, and page, target, and text result limits are deployment tunables.
- `allowPrivateHosts` exists only for deterministic local tests and must remain false in the product composition.

## Model Experience

### `browser_control` schema

#### What the model sees

The [`browser_control` schema](../../../docs/tool-catalog.md#deepseek-aidsh-xiaojing-browser-control) instructs the model to pass an explicitly requested browser on `open` or `tabs`, or omit it to use the saved default, report startup failure without choosing a different browser, reuse an existing suitable page, and then operate only opaque IDs from the latest observation. Every page operation returns a fresh `observationId`, bounded visible `text`, and semantic `targets`; subsequent target actions must use IDs from that exact observation. Websites use this tool instead of Windows computer control.

#### Token effect

One stable tool definition appears on every request. Results add bounded page, text, and target metadata only to the current conversation suffix; configured result limits cap that variable output.

#### KV Cache effect

The schema is stable for the life of the plugin and does not invalidate the cached request prefix between turns. Browser observations appear after that prefix as ordinary tool results.

## Known Limitations and Deferred Work

- The implementation uses DOM semantics and visible text; it does not inspect pixels, solve CAPTCHAs, bypass anti-automation controls, attach to a person's existing browser profile, or operate browser chrome outside the controlled page.
- Sites implemented as a single canvas require a future vision capability.
- The selected browser must be installed and allowed by device policy. Chrome cannot use this Playwright path when a mandatory Windows `UserDataDir` policy forces every launch into the live personal profile; the plugin reports that condition before opening a browser. A missing or blocked selected browser never launches the other browser automatically.
- Native authentication, certificate, UKey, download, and operating-system dialogs are outside DOM automation and may require the user to restore the browser or use `computer_control`.
