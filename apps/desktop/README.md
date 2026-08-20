# Xiaojing Accounting Windows desktop

English | [中文](README.zh.md)

The Electron wrapper for “小兢会计-您的AI办公搭子”. It starts the bundled Node runtime and Web profile, keeps the browser isolated from Node, and presents the local Host in one Windows desktop window.

## Permanent installer identity

`identity.json` is the source manifest and `verify-desktop-identity.mjs` locks these compatibility identifiers:

| Field | Value |
|---|---|
| Package name | `@sudotech/xiaojing-accounting-desktop` |
| App ID / AppUserModelId | `com.sudotech.xiaojing-accounting` |
| NSIS GUID | `1f6e3c2a-13e7-5ab1-a2d7-10b68c1b911a` |
| Installation directory | `xiaojing-agent-desktop` |
| Executable | `小兢会计.exe` |
| Product name | `小兢会计-您的AI办公搭子` |
| Installation scope | Current Windows user |
| Shortcut | `小兢会计` |

A fresh installation shows the custom parent-directory picker and appends `xiaojing-agent-desktop`. An installer with the same identity detects an existing installation, retains its `InstallLocation`, skips the directory page, replaces application files, and refreshes shortcuts and uninstall metadata. Moving an installation still requires uninstalling and reinstalling.

## Permanent user-data paths

Electron pins `userData` before the single-instance lock to `%APPDATA%\@sudotech\xiaojing-accounting-desktop`. The bundled Host uses its `harness` child as `DSH_HOME`, while the user workspace is `%USERPROFILE%\Documents\小兢会计工作区`.

`user-data-contract.json` protects sessions, settings, credentials, agent presets, profiles, storage, uploads, usage accounting, Electron Local Storage, and the Documents workspace. The installer has `deleteAppDataOnUninstall: false` and never addresses those paths. `verify-user-data-contract.mjs` compares a synthetic 0.1.7 data set byte-for-byte across an application-file replacement; a release that changes a durable format must add an atomic migration and a previous-release fixture before this check may change.

## Independent integration patches

`integration-patches.json` inventories the post-launch API-key configuration, profile runtime-shadow protection, and file-upload composer repair separately from the product brand plugin. The desktop identity check fails if an inventory entry disappears or its owned path is absent. This keeps upstream conflict review focused without pretending these patches are official Harness behavior.

## Release checks

Run the identity, user-data, and product-layer verifiers before preparing the bundled runtime. A release also requires a fresh Windows install and an in-place upgrade from the previous installer on both default and custom paths. The installed application must retain sessions, credentials, presets, plugins, attachments, workspaces, and accounting data before an installer is published.

## Known limitations

- Updates are delivered by downloading and running a newer installer; there is no in-app automatic updater.
- The installer is not Authenticode-signed, so Windows may show an unknown-publisher or SmartScreen warning.
- In-place upgrades apply only to the same Windows user and cannot move the installation directory.
