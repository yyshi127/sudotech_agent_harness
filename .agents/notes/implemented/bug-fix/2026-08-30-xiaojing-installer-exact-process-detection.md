# Agent Note: Xiaojing installer upgrade preflight

Status: implemented

English | [中文](2026-08-30-xiaojing-installer-exact-process-detection.zh.md)

## Problem

The Windows installer must replace application files while the tray-resident desktop and bundled Host may still be running. The inherited NSIS application check identifies processes by testing whether their executable path starts with `$INSTDIR`; a missing or stale value can therefore treat an unrelated process as Xiaojing.

The update path has a second failure with the same visible message. Electron-builder retries any nonzero result from the installed uninstaller and eventually displays `appCannotBeClosed`, even when the failure is unrelated to a process. Xiaojing 0.2.2 contains unpacked dependency paths longer than the legacy Win32 259-character file-path limit. Its uninstaller cannot atomically move those files and returns a failure while no Xiaojing process is running.

## Decision

The Xiaojing installer replaces the inherited process check through `customCheckAppRunning`. It reads `InstallLocation` from the fixed current-user installation record and delegates process handling to a bundled PowerShell helper. The helper accepts only a path whose final directory is `xiaojing-agent-desktop`, rejects installation trees containing reparse points, enumerates `Win32_Process.ExecutablePath`, and considers a process owned by the installation only when its normalized executable path is inside that exact root.

When an owned process exists, the helper first launches `小兢会计.exe --xiaojing-shutdown-for-update`. A current desktop instance receives the argument through Electron's single-instance channel and exits normally. Releases that do not understand the argument use a bounded exact-path fallback that terminates only remaining processes inside the same installation root. Installer and helper process ids are excluded.

After the installation root has no running executable, the helper deletes only legacy program files whose absolute paths exceed 259 characters and removes only overlong program directories that the inherited uninstaller cannot enumerate. It uses extended Windows paths, verifies that every target remains inside the fixed installation root, and fails before replacement if an unsafe path remains. The standard electron-builder uninstaller then removes the remaining old application, shortcuts, and registry records before the new files are installed.

The helper never addresses `%APPDATA%`, the Documents workspace, credentials, sessions, Finance data, or any other protected user data. A validation, shutdown, or compatibility-cleanup failure stops installation instead of replacing a partially prepared application.

## Alternatives considered

**Match `小兢会计.exe` by process name.** This misses the bundled Node Host and can affect another installation or Windows user that uses the same executable name.

**Bypass the installed uninstaller and remove the complete installation tree.** This duplicates electron-builder's shortcut and registry lifecycle, increases the deletion scope, and makes future installer changes easier to miss.

**Require users to close the application manually.** Closing the main window hides the tray-resident application, and it cannot resolve a long-path failure when no process exists.

## Consequences

An in-place upgrade proceeds when the installed application root has no owned process, regardless of unrelated desktop, browser, or development processes. Legacy overlong program files no longer block the installed uninstaller or produce a false close-process diagnosis. Update cancellation remains disabled after replacement preparation begins, so the cleanup and standard uninstall/install sequence cannot be interrupted through the installer UI.

Desktop identity verification requires the custom check, fixed registry lookup, exact-path helper, upgrade shutdown argument, and long-path cleanup. The helper test covers an empty installation, an unrelated process, an installed runtime process, an overlong legacy program path, retained normal program files, and rejection of a directory with the wrong product identity.
