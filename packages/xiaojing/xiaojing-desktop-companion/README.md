# @deepseek-ai/dsh-xiaojing-desktop-companion

English | [中文](README.zh.md)

Host-side task-state aggregation for the Xiaojing Windows desktop companion. This Cordis plugin observes Harness session, approval, and sanitized Weixin status events and publishes one content-free global snapshot for the Electron desktop. It does not modify the Agent Loop, task execution, model prompts, or user sessions.

## Composition and State

The plugin is loaded only by the Xiaojing product composition. It tracks open turns, unfinished tools, unresolved approvals, recent terminal results, and the sanitized Weixin online flag. The global state priority is approval, failure, execution, thinking, success, then idle. Completed turns retain success for 2.5 seconds, while failed, blocked, max-token, and interrupted turns retain failure for 5 seconds. Concurrent active turns contribute only a count. Tool completion reads the call id from the tool message source, including results with empty content.

The exported `CompanionSnapshot` contains `state`, `activeTaskCount`, `approvalCount`, `weixinOnline`, and `revision`. It never contains session titles, user instructions, file names, tool arguments, model replies, API keys, or Weixin credentials. The tracker retains only lifecycle counters and timestamps per session and discards a session record when the session is disposed.

## Desktop Transport

The Host exposes a loopback-only JSON snapshot endpoint and a loopback-only Server-Sent Events stream under `/xiaojing-desktop-companion`. The Electron main process consumes this stream and owns all native windows, tray menus, persistence, and animation. Ordinary browser clients do not receive a native desktop control channel from this package.

The stream sends an initial snapshot, subsequent revisions, and content-free heartbeat comments. Client disconnection removes the stream listener. The Host schedules one expiry timer for recent success or failure state so the snapshot returns to the next applicable state without polling.

## Model Experience

None, as this plugin only observes lifecycle events after they have been logged and contributes no prompt text, model input, tool schema, or session event.

#### KV Cache effect

No direct effect; companion state and Weixin connectivity never change a model request.

## Known Limitations and Deferred Work

- The Host reports semantic task lifecycle state, not progress percentage or task content.
- Desktop display, animation, drag behavior, and system-tray lifecycle are Windows Electron responsibilities and are not available in an ordinary Web browser.
- A process restart clears transient success and failure timers; active state is rebuilt from new lifecycle events rather than historical animation playback.
