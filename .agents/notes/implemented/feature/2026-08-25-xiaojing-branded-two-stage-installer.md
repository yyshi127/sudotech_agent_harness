# Agent Note: Xiaojing branded two-stage Windows installer

Status: implemented

English | [中文](2026-08-25-xiaojing-branded-two-stage-installer.zh.md)

## Problem

The stock assisted NSIS flow separates license, install-scope, directory, file-progress, and finish pages. That sequence does not match the Xiaojing product presentation, but replacing it must not change the permanent installer identity, current-user scope, custom installation directory, in-place upgrade behavior, or user-data exclusions.

## Decision

The desktop remains an electron-builder assisted NSIS target and customizes it through `apps/desktop/build/installer.nsh`. A full-window welcome page owns the Xiaojing mark, product name, SUDO-green install action, installation consent notice, and optional inline parent-directory picker. The picker normalizes every fresh-install selection to the fixed `xiaojing-agent-desktop` child directory. Existing installations retain their recorded `InstallLocation` and do not expose path selection.

The installer forces the fixed current-user mode, so the generic install-scope page aborts without changing registry ownership. The internal-use notice has the neutral build-resource name `internal-use-notice.txt` because electron-builder automatically creates a license page for every `license*` or `eula*` resource. The identity gate rejects those reserved names and any explicit NSIS license page. The welcome page states consent, while the internal-use notice, complete DeepSeek Harness license, and third-party notices remain in the installed `resources/legal` directory.

The built-in NSIS InstallFiles page remains the installation engine and the source of progress. Its presentation places the Xiaojing mark and product name above the real progress bar and a compact `110×28` SUDO logo below it. It does not display fabricated download speed, transferred bytes, or remaining time. A non-visible finish callback launches the installed application and exits, leaving two visible setup pages.

The window close command remains enabled during file installation and opens a branded confirmation card. In a fresh installation whose target directory did not exist at start, Continue releases the completion barrier and resumes the ordinary flow. Cancel starts a copied PowerShell cleanup helper and exits immediately with Windows cancellation code `1602`; the helper waits for the installer process, requires the exact `xiaojing-agent-desktop` directory basename, and then removes the partial application, current-user installer registry keys, and shortcuts. A pre-existing target directory disables cancellation so cleanup cannot remove files the installer does not own. In an in-place upgrade, the welcome page remains safely closable before replacement starts, but the progress-page confirmation exposes only Continue after replacement begins. This avoids interrupting electron-builder after it has removed the previous program files. Neither path addresses the permanent user-data directories.

`verify-desktop-identity.mjs` pins the current-user override, two-stage page macros, SUDO-green action, absence of auto-discovered license pages, packaged legal notices, compact bitmap dimensions, the company logo's pure-white outer pixels, fresh-install cleanup helper, cancellation exit code, and update no-cancel message alongside the permanent installer identity. The user-data contract rejects every AppData or protected-data reference in both the custom installer and its cleanup helper.

## Alternatives considered

**Use electron-builder one-click installation.** This removes the extra pages but also removes the required custom installation location, so it cannot satisfy the product installation behavior.

**Maintain a complete custom NSIS script.** This offers unrestricted layout control but forks electron-builder's extraction, upgrade, shortcut, uninstall, and application-running logic. The maintenance and upgrade risk outweigh the visual benefit.

**Keep the stock assisted pages and only replace header images.** This preserves the implementation with minimal code but leaves the fragmented page sequence and cannot produce the approved welcome and progress presentation.

**Show simulated network progress details.** The installer is an offline package, so download speed, byte transfer, and countdown values would be false. The design uses only the actual file-installation progress.

**Restore a canceled update by silently rerunning a cached previous installer.** The cache is not an authoritative rollback image, and a second installer process cannot guarantee restoration after electron-builder has already removed the prior application. The update flow therefore stops offering cancellation once replacement begins.

## Consequences

The custom include retains electron-builder's installation section and upgrade behavior while owning page composition and cancellation policy. It depends on the Modern UI InstallFiles control identifiers and custom-page hooks used by electron-builder 26.15.3, so an electron-builder upgrade must compile the installer and manually inspect both pages before release. Fresh-install cancellation uses an external helper so cleanup happens only after the installer process exits. In-place updates cannot be canceled after replacement begins; closing the progress page presents an explanation and a single Continue action. The compact consent treatment gives up a separate click-through license page; the full license and notices remain installed and accessible. Installation relocation still requires uninstalling and reinstalling, while ordinary upgrades continue to preserve the existing path and protected user data.

## Verification

Release verification compiles the NSIS installer, runs the desktop identity, cancellation-helper, and user-data checks, and inspects a fresh installation plus an in-place upgrade. The fresh flow must expose parent-directory selection and append the fixed child directory; the upgrade flow must hide path selection and retain `InstallLocation`; both flows must show real progress and launch the application after completion. Cancellation verification proves that the helper waits for the installer before deleting an allowed partial directory, rejects any other directory basename, and never references protected user data. The in-place upgrade check must prove that the welcome page can exit before replacement and that the progress-page confirmation offers no cancellation after replacement begins.
