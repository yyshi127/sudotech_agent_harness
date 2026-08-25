# Agent Note: Xiaojing desktop companion and tray lifecycle

Status: implemented

English | [中文](2026-08-25-xiaojing-desktop-companion-and-tray.zh.md)

## Problem

Xiaojing task progress was visible only inside the main window. Hiding or closing that window gave no ambient indication that an Agent task was thinking, using a tool, waiting for approval, or finished. The previous Electron lifecycle also treated the main window as the application lifetime, which conflicted with long-running desktop tasks and the Weixin channel: closing the window could stop background work instead of leaving Xiaojing available from the system tray.

The desktop character must not receive task text or become another task executor. Its animation state must remain removable from Harness core, expose no session content, and continue to work when the main window is hidden. Tucking the character and exiting the application also require distinct behavior and terminology.

## Decision

`@deepseek-ai/dsh-xiaojing-desktop-companion` is a Xiaojing-only Cordis Host plugin that observes logged session lifecycle, approval, and sanitized Weixin status events. A pure tracker maintains per-session open-turn, unfinished-tool, unresolved-approval, and recent terminal-state counters. It reduces them with fixed global priority: approval, failure, execution, thinking, success, then idle. Completed turns retain success for 2.5 seconds; failed, blocked, max-token, and interrupted turns retain failure for 5 seconds. User-aborted turns return to idle without being presented as failures.

The Host publishes only `state`, `activeTaskCount`, `approvalCount`, `weixinOnline`, and `revision` through loopback-only snapshot and Server-Sent Events endpoints. Session titles, prompts, file names, tool arguments, model replies, credentials, and message contents never enter the tracker or transport. The plugin does not change `agent-loop`, tools, model requests, or session persistence.

`@deepseek-ai/dsh-client-ui-desktop-companion` registers the Xiaojing-only `desktop-companion` Settings section at order 1000. The product layer registers “About Xiaojing” at order 1010, so Desktop Xiaojing remains directly above the final product-information page. The renderer receives eight restricted Electron preload methods: a read-only application-version query plus state, wake, tuck, reset, visual scale, main-window display, and subscription. Every returned companion state is validated at the preload boundary. An ordinary browser has no preload bridge and renders only a Windows-desktop availability notice.

Electron owns the native lifecycle. It creates a transparent, frameless, focusless, always-on-top companion BrowserWindow that skips the taskbar, accepts pointer interaction only over the character surface, supports drag and double-click restoration, and exposes a right-click menu without an ambiguous exit command. The character defaults to 50% of its original visual size and accepts a persisted 30%–100% scale; the status bubble follows the scaled head while retaining readable text. A missing saved position and Reset position both place the full companion window inside the main Xiaojing window's bottom-right corner with a fixed inset; a remembered user drag remains authoritative. The startup-created companion receives a renderer-only query flag, waits for the main application interface to load, then waits three seconds and presents one five-second introduction while idle; the first task state cancels it, and manually recreated windows receive no flag. The window maps sanitized states to seven generated transparent character poses and uses CSS motion for breathing, blinking, thinking, execution, approval, success, and failure. After three continuous idle minutes, the renderer randomly reuses two different thinking, approval, or executing poses for three seconds each, restores the default pose, and waits for the next interval. The idle cycle does not change the sanitized Host state or show a task-status bubble; task activity cancels it and Windows reduced-motion preference disables it. Tucking destroys this BrowserWindow and its renderer while the Host and tasks continue.

The Electron main process creates a tray when the application becomes ready. Closing the main window hides it to the tray and shows one local notice; minimizing continues to use the taskbar. A second process invocation restores the existing main window through the single-instance lock. Only the tray command “Exit Xiaojing Accounting” stops the Host and application, and it requires confirmation when active tasks, Weixin connectivity, or unreadable state indicate interruption risk.

Companion visibility, visual scale, one-time tray notice state, and clamped display coordinates are stored atomically in `%APPDATA%\@sudotech\xiaojing-accounting-desktop\desktop-companion\preferences-v1.json`. Missing preferences default to visible at 50% scale. Saved coordinates are recovered into the nearest available work area after monitor, resolution, or scaling changes. The path is part of the desktop user-data protection inventory.

## Alternatives considered

- **Render the companion inside the main Web page.** Rejected because it disappears when the main window is hidden and cannot provide an independent desktop surface or tray lifecycle.
- **Use Live2D, video, or frame-by-frame animation.** Rejected because the first release needs bounded assets and low idle CPU. Seven transparent key poses plus CSS motion preserve the character identity with a small runtime footprint.
- **Keep the close button as application exit.** Rejected because it interrupts desktop tasks and disconnects Weixin when the user only intends to clear the main window from the desktop.
- **Keep the companion BrowserWindow alive while tucked.** Rejected because hidden animation still consumes a Chromium renderer. Tuck explicitly destroys the window and recreates it from the latest global state.
- **Expose generic IPC, Node, or BrowserWindow access to renderers.** Rejected because native integration needs only eight fixed read/control operations and a content-free state subscription.
- **Infer state from assistant text or tool names.** Rejected because text inspection can leak task content and is less reliable than authoritative lifecycle and approval events.

## Verification

Pure tracker tests cover state priority, concurrent turns, tools, approvals, terminal timers, user aborts, Weixin connectivity, and content-free snapshots. Client tests cover settings registration, ordinary-browser fallback, bridge validation, immediate wake/tuck/reset/scale state changes, and disposal. Electron helper tests cover the 50% preference default, accepted scale range, clamped saved positions, main-window-interior initial and reset placement, removed displays, and negative coordinates. Product and user-data gates require both composition rows, the protected preference path, tray lifecycle markers, product-version parity, and unchanged upgrade-fixture bytes.

Electron development preview remains the required native check for focus behavior, pointer passthrough, drag, multi-display placement, renderer release after tuck, close-to-tray, tray restoration, second-instance restoration, six visual states, and risk-confirmed true exit.

## Consequences

Xiaojing can remain available as a low-content desktop status surface while the main application window is hidden. Users can tuck or wake the character independently of task execution and can exit the whole application only through an explicit tray command. The state feature remains isolated in Xiaojing Host and Client plugins, while Windows-specific windows, animation, tray, and persistence remain in the Electron product layer. Future character art can change without changing task-state aggregation, and future Harness upgrades need to adapt only event registration when lifecycle APIs change.
