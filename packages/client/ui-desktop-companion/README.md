# @deepseek-ai/dsh-client-ui-desktop-companion

English | [中文](README.zh.md)

Xiaojing-only settings presentation for the Windows desktop companion. The Client plugin registers the “Desktop Xiaojing” settings section and delegates native actions to the restricted Electron preload bridge. It does not create native windows, read files, or own companion task state.

## Composition and Presentation

The plugin registers `settings.section` with id `desktop-companion` and order `1000` only for the `xiaojing` build profile, placing it last in the Settings navigation. The section shows the character preview, current sanitized state, active task count, a 30%–100% size control, and controls to wake, tuck, or reset the companion. Missing persisted size preferences default to 50% of the original character size.

Wake creates or shows the companion window. Tuck destroys only that window and leaves the application, Host, active tasks, and Weixin channel running. Reset moves the companion to the primary display's lower-right work area and wakes it when necessary. The page updates immediately from the same preload subscription used by the tray and companion window.

When the preload bridge is absent, the page displays that Desktop Xiaojing is available only in the Windows desktop application and renders no inactive native controls. This keeps an ordinary browser preview accurate without emulating desktop behavior.

## Electron Bridge

The renderer can call only `getCompanionState()`, `wakeCompanion()`, `tuckCompanion()`, `resetCompanionPosition()`, `setCompanionScale()`, `showMainWindow()`, and `subscribeCompanionState()`. The Client validates every returned snapshot and receives no Node, filesystem, arbitrary IPC, BrowserWindow, session content, or credential access.

## Model Experience

None, as this browser-only settings plugin renders sanitized desktop state and registers nothing model-facing.

#### KV Cache effect

No direct effect; opening the settings section or controlling the companion does not alter a model request.

## Known Limitations and Deferred Work

- Native controls require the Xiaojing Windows Electron preload bridge.
- The settings page does not provide animation, sound, character customization, autostart, or an input box.
- Closing the whole application removes the settings page as well; the application must be started again before the companion can be awakened.
