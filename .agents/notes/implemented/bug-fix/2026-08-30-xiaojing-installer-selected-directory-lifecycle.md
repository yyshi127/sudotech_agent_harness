# Agent Note: Xiaojing installer selected-directory lifecycle

Status: implemented

English | [中文](2026-08-30-xiaojing-installer-selected-directory-lifecycle.zh.md)

## Problem

The Xiaojing welcome page collects a custom installation directory before electron-builder's forced current-user install-mode page runs. The welcome-page leave callback assigned the normalized value to `$INSTDIR`, but `setInstallModePerUser` subsequently replaced it with the registered installation directory or the default per-user Programs directory. A fresh installation therefore ignored the directory shown to the user.

The same ordering made a missing installation record especially confusing: the installer treated an unregistered application tree as a fresh installation and reset its destination to the default path even when the user selected the existing location.

## Decision

The custom welcome page records its normalized destination in the dedicated `xiaojingSelectedInstallDirectory` NSIS variable. The install-files pre-callback runs after install-mode initialization and restores that value to `$INSTDIR` immediately before extraction and registry writes begin.

An identified in-place update continues to obtain the destination from electron-builder's fixed-GUID installation record and hides directory selection. A missing record remains a fresh installation; the user may choose the existing directory, but the installer does not scan arbitrary drives for orphaned application trees.

Desktop identity verification requires the selected-directory variable, the post-install-mode restore callback, and the assignment that persists the normalized welcome-page value.

## Alternatives considered

**Use electron-builder's standard directory page.** It places directory selection after install-mode initialization, but it replaces the approved Xiaojing two-stage installer interface.

**Restart the installer with an NSIS `/D` argument.** This adds another process lifecycle and quoting path solely to transport a value already available in the running installer.

**Patch electron-builder's NSIS templates.** The defect is limited to Xiaojing's custom page ordering; modifying a package-manager dependency increases upgrade and verification scope.

## Consequences

Fresh installations honor the normalized directory selected in the Xiaojing interface, including a custom drive. Registered upgrades continue in the recorded directory without exposing relocation controls. An orphaned installation without its fixed-GUID record cannot be discovered automatically and requires explicit directory selection.
