# @deepseek-ai/dsh-xiaojing-computer-control

English | [中文](README.zh.md)

Semantic Windows computer control for Xiaojing. One Cordis plugin provides `ctx.xiaojingComputerControl`, registers the `computer_control` consumer, and maintains a bounded newline-delimited helper process over Windows PowerShell 5.1, the Windows Start application catalog, and the operating system's `System.Windows.Automation` API.

The helper searches installed Start applications, launches a selected catalog entry, and returns bounded application, top-level window, and UI Automation control lists. Application, window, and target IDs are held only in memory, scoped to one owning agent session, expire, and are replaced after state changes. Launch consumes the application listing and returns a fresh window list. The model never receives a Windows application registration ID or executable path. The tool does not accept coordinates, screenshots, OCR input, PowerShell source, or arbitrary shell commands.

Direct file, data, editing, and command tools remain the preferred path when they can complete a task without driving a visible application. `computer_control` handles tasks that require a native application's visible interface; `browser_control` handles websites. Potentially committing keyboard input, high-impact applications, and controls whose names indicate payment, deletion, installation, execution, transfer, publishing, or sending require a one-use decision from `ctx.approval`.

## Configuration

The configuration exposes the PowerShell executable, helper/request deadlines, application, window, and control result limits, launch settling time, tree depth, observation lifetime, wait polling, and protocol line cap. The product composition uses Windows PowerShell included with Windows 10 and Windows 11.

## Model Experience

### `computer_control` schema

#### What the model sees

The [`computer_control` schema](../../../docs/tool-catalog.md#deepseek-aidsh-xiaojing-computer-control) tells the model to use this tool only for a required visible native application. A closed application is resolved through `list_apps` and an opaque `appId`, then opened through `launch_app`. An open application starts at `list_windows`; the model selects a returned `windowId` and calls `observe`. The model may invoke only operations included in a target's `actions`, and every operation returns a fresh observation.

#### Token effect

One stable tool definition appears on every request. Results add a bounded application, window, or UI Automation target list only to the current conversation suffix.

#### KV Cache effect

The schema is stable for the life of the plugin and does not invalidate the cached request prefix between turns. Windows observations appear after that prefix as ordinary tool results.

## Known Limitations and Deferred Work

- Only entries registered in the Windows Start application catalog can be launched. Background and tray-only applications may launch without exposing an operable window.
- The provider cannot cross Windows elevation or desktop boundaries: UAC, sign-in, secure desktop, services, and elevated applications are unavailable from a normal process.
- It cannot operate pixel-only controls, canvas applications, remote desktops, or applications that publish incomplete UI Automation semantics.
- Local OCR and coordinate fallback are deliberately excluded.
