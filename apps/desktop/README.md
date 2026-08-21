# Xiaojing Accounting Windows desktop

English | [中文](README.zh.md)

The private Electron deployment for “小兢会计-您的AI办公搭子”. It is distributed through the Windows installer rather than npm, starts the bundled Node runtime and Web profile, keeps the renderer isolated from Node, and presents the local Host in one Windows desktop window.

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

`user-data-contract.json` protects sessions, settings, credentials, agent presets, profiles, storage, uploads, usage accounting, the dedicated browser-control profile, Electron Local Storage, and the Documents workspace. The installer has `deleteAppDataOnUninstall: false` and never addresses those paths. `verify-user-data-contract.mjs` exercises a synthetic 0.1.9 data set through application replacement and rc.8 readers. It requires protected bytes to remain unchanged except for the exact installation-owned Web profile migration that removes ModLens, and it verifies session, credential, preset, settings, upload, storage, and accounting compatibility. A release that changes another durable format must add an atomic migration and a previous-release fixture before this check may change.

## Built-in automation runtimes

Browser automation starts the installed Microsoft Edge with a dedicated profile at `harness/browser-control/profile`; the application does not bundle Chrome for Testing or reuse the user's normal Edge profile. Windows application control uses Windows PowerShell 5.1 and the operating system's `System.Windows.Automation` API. End users do not install Node, a browser driver, PowerShell module, or a separate automation service.

Both capabilities are independent Cordis rows. A development overlay can disable either row, while the Xiaojing product composition enables both and tells every new agent session when they are available. Browser and Windows observations use session-owned opaque identifiers and expire after state changes. Private-network browser navigation, file uploads, submissions, payments, deletions, sends, and comparable native actions require one-use approval.

## Independent integration patches

`integration-patches.json` inventories desktop API-key environment isolation, profile runtime-shadow protection, and file-upload composer repair separately from the product brand plugin. rc.8 owns the writable credential UI; the desktop patch only removes inherited `DEEPSEEK_API_KEY` values before Host startup. The desktop identity check fails if an inventory entry disappears or its owned path is absent. This keeps upstream conflict review focused without pretending these patches are official Harness behavior.

## Release checks

Run the identity, user-data, and product-layer verifiers plus real Edge and Windows UI Automation tests before preparing the bundled runtime. A release also requires a fresh Windows install and an in-place upgrade from the previous installer on both default and custom paths. The installed application must retain sessions, credentials, presets, plugins, attachments, workspaces, accounting data, and the dedicated browser profile before an installer is published.

## Known limitations

- Updates are delivered by downloading and running a newer installer; there is no in-app automatic updater.
- The installer is not Authenticode-signed, so Windows may show an unknown-publisher or SmartScreen warning.
- In-place upgrades apply only to the same Windows user and cannot move the installation directory.
- Browser automation requires Microsoft Edge. It reports an explicit startup error if Edge is removed or blocked by device policy.
- The built-in automation is semantic, not visual: it cannot operate pixel-only controls, CAPTCHAs, UAC, the secure desktop, or elevated applications.
