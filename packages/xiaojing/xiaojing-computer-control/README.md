---
description: "Xiaojing semantic Windows computer control through the built-in UI Automation API"
kind: "package-reference"
---

# @deepseek-ai/dsh-xiaojing-computer-control

English | [中文](README.zh.md)

## Summary

Semantic Windows computer control for Xiaojing. One Cordis plugin provides `ctx.xiaojingComputerControl`, registers the `computer_control` consumer, and maintains a bounded newline-delimited helper process over Windows PowerShell 5.1, the Windows Start application catalog, and the operating system's `System.Windows.Automation` API.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Capabilities

The helper searches installed Start applications, launches a selected catalog entry, and returns bounded application, top-level window, and UI Automation control lists. Application, window, and target IDs are held only in memory, scoped to one owning agent session, expire, and are replaced after state changes. Each helper process adds a unique instance component to its IDs, so stale IDs cannot collide with a newly started helper. Launch consumes the application listing and returns a fresh window list. The model never receives a Windows application registration ID or executable path. The tool does not accept coordinates, screenshots, OCR input, PowerShell source, or arbitrary shell commands.

Direct file, data, editing, and command tools remain the preferred path when they can complete a task without driving a visible application. `computer_control` handles tasks that require a native application's visible interface; the [selected browser connection](../xiaojing-browser-control/README.md#native-browser-connections) handles websites, and application-catalog searches for browser names are rejected. Potentially committing keyboard input, high-impact applications, and controls whose names indicate payment, deletion, installation, execution, transfer, publishing, or sending require a decision from `ctx.approval`. Delete-key actions and applications or controls labelled for deletion, removal, or uninstall use mandatory confirmation under every session policy; other high-impact actions use ordinary approval.

An approval for invoke, toggle, or select can authorize the same uniquely named control for the current Session. The classification includes the listed window, its process and observed title, the control type and name, and the operation. Refreshed observation and target IDs do not widen it. Every protected operation still requests approval and validates the live observation before execution. The approval UI displays the window and control names rather than internal IDs or process numbers. Application launch, keyboard input, ambiguous names, and observations without a verified listed window remain one-shot.

Cancellation during helper startup rejects the operation without dispatching its request. A helper that has started remains reusable by later operations and is closed when the provider is disposed.

The helper requests independent Windows child lifetimes: applications opened through `launch_app` remain running when an operation is cancelled, the helper is closed, or the provider is disposed. Only the helper belongs to its managed Job; enclosing host Job restrictions still apply. A subprocess provider without native local Windows support rejects helper startup.

## Configuration

The configuration exposes the PowerShell executable, helper/request deadlines, application, window, and control result limits, launch settling time, tree depth, observation lifetime, wait polling, and protocol line cap. The product composition uses Windows PowerShell included with Windows 10 and Windows 11.

## Model Experience

### `computer_control` schema

#### What the model sees

The `computer_control` schema tells the model to use this tool only for a required visible native application. A closed application is resolved through `list_apps` and an opaque `appId`, then opened through `launch_app`. An open application starts at `list_windows`; the model selects a returned `windowId` and calls `observe`. The model may invoke only operations included in a target's `actions`, and every operation returns a fresh observation. The generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-xiaojing-computer-control) records this schema.

#### Token effect

One stable tool definition appears on every request. Results add a bounded application, window, or UI Automation target list only to the current conversation suffix.

#### KV Cache effect

The schema is stable for the life of the plugin and does not invalidate the cached request prefix between turns. Windows observations appear after that prefix as ordinary tool results.

## Known Limitations and Deferred Work

Keyboard input and window-state changes can interleave with UI Automation actions. A returned observation describes the state read after the action; it does not lock the application against concurrent input.

- Only entries registered in the Windows Start application catalog can be launched. Background and tray-only applications may launch without exposing an operable window.
- The provider cannot cross Windows elevation or desktop boundaries: UAC, sign-in, secure desktop, services, and elevated applications are unavailable from a normal process.
- It cannot operate pixel-only controls, canvas applications, remote desktops, or applications that publish incomplete UI Automation semantics.
- Local OCR and coordinate fallback are deliberately excluded.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
