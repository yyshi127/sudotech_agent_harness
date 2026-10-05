# Xiaojing Accounting Windows desktop

English | [中文](README.zh.md)

The private Electron deployment for “小兢会计-您的AI办公搭子”. It is distributed through the Windows installer rather than npm, starts the bundled Node runtime and Web profile, keeps the renderer isolated from Node, and presents the local Host in one Windows desktop window.

The application document, bundled assets, and top-level PNG, SVG, ICO, and Web manifest files are served from the packaged frontend before the Host starts. API requests, plugin bundles, and event streams are forwarded only after the authenticated Host is ready; they return 503 before readiness and are never treated as those static resources.

The main window displays the local Xiaojing startup page alongside the companion before Host preparation begins. The startup page remains in the same application document until the client renders its first interface; no extra delay or navigation is added. Saved companion visibility is respected. Closing or minimizing the startup window remains effective when initialization completes, and an explicit open restores it during startup.

A new Desktop profile enables the experimental Automation tasks bundle by default. The built-in plugin switch can disable it; subsequent launches and upgrades preserve the existing profile selection. Enabling the bundle does not create or run a task by itself.

## Permanent installer identity

`identity.json` is the source manifest and `verify-desktop-identity.mjs` locks these compatibility identifiers:

| Field | Value |
|---|---|
| Package name | `@deepseek-ai/dsh-desktop` |
| App ID / AppUserModelId | `com.sudotech.xiaojing-accounting` |
| NSIS GUID | `1f6e3c2a-13e7-5ab1-a2d7-10b68c1b911a` |
| Installation directory | `xiaojing-agent-desktop` |
| Executable | `小兢会计.exe` |
| Product name | `小兢会计-您的AI办公搭子` |
| Installation scope | Current Windows user |
| Shortcut | `小兢会计` |

The “Manage dsh Command” menu registers the installed `resources/runtime/cli/bin` command directory after confirmation. Packaging derives the Windows executable name from `identity.json.executableName` and the macOS executable from `identity.json.productName`. The ASCII Windows batch command uses the bundled primary Node runtime to forward arguments and inherited standard streams to Electron Node mode without changing the console code page; it waits for the CLI's console-interrupt shutdown and preserves its exit status. The CLI joins its parent's console only when unattached; a missing parent console does not prevent background commands.

A fresh installation uses a two-stage branded setup flow. The welcome page presents the Xiaojing mark, a SUDO-green install action, and an optional inline parent-directory picker that appends `xiaojing-agent-desktop`; the installation page keeps the Xiaojing artwork, hides the stock NSIS details area, shows the real file progress, and then launches the application without a separate finish page. The welcome page carries the installation consent notice, while the internal-use notice, complete upstream license, and third-party notices remain bundled under `resources/legal`. During a fresh installation into a target directory that did not previously exist, closing or cancelling the progress page opens the native confirmation prompt. Confirming cancellation starts an external cleanup helper and exits with code `1602`; after the installer process stops, the helper validates the fixed installation-directory name and removes only the partial application, current-user installer records, and shortcuts. Cancellation is disabled when the target directory already existed. During an in-place upgrade, the welcome page can still be closed before replacement starts, but cancellation is disabled once file installation begins to protect the previous installation. User-data paths are never part of cleanup. An installer with the same identity reads the exact `InstallLocation` from the fixed current-user GUID, hides path selection, asks that installed application to exit for the update, and handles only processes whose executable is inside that exact installation root. Before invoking an earlier uninstaller, the same fixed-root helper removes only legacy program entries whose absolute paths exceed the old Win32 limit, preventing deep unpacked dependencies from being misreported as an application-close failure. The standard updater then replaces application files and refreshes shortcuts and uninstall metadata. Unrelated processes and protected user data are never scanned, terminated, or removed. Moving an installation still requires uninstalling and reinstalling.

The branded welcome page displays the paired robot artwork at up to 480×400 pixels in an 820×680 window. Short screens reduce the window and artwork together, keeping the title, installation controls, and bottom consent notice visible. The installation page retains native NSIS layout and message handling instead of creating custom child windows or a private message loop. Run `powershell -File apps/desktop/scripts/prepare-installer-logo.ps1` from the repository root to regenerate the white-backed welcome and small bitmaps from `build/installer-robot-source.png` without stretching either character. This source matches the transparent paired-robot artwork in the office and Finance chat heroes; the generated installer bitmaps remain separate files.

Run `node apps/desktop/scripts/prepare-installer-icon.mjs` from the repository root to generate Windows icons from `build/installer-icon-source.png`. The generator crops the fixed 1254-pixel source to its 1157-pixel square native region, retaining two pixels beyond the white tile's alpha-128 bounds without resizing its black-and-gold character. The four Desktop PNG aliases use that crop; browser favicon/sidebar and download-page assets retain the complete original source. A changed source requires reviewing the crop before generation. Electron-builder's converter produces the multi-resolution `build/installer-runtime-icon.ico` from the native PNG. The executable and development About panel use `build/app-icon.png`; native windows, taskbar, and tray use `assets/windows-icon.png`. The installer and quit dialogs use the ICO, copied to packaged `resources/tray.ico`. The application opens the Xiaojing workspace directly; its first-use API-key guide is owned by the product plugin. DeepSeek account login, the native authentication welcome window, and account-driven window changes are not exposed.

After installing files, the installer copies its icon to `resources/xiaojing-character-<sha256>.ico`, updates existing Desktop and Start Menu shortcuts to that content-addressed path, retains their AppUserModelId, and sends a path-specific Windows Shell update notification. A changed icon gets a new path even when the application version stays unchanged. This step also runs for silent upgrades and does not recreate links omitted by the upstream shortcut policy. A write failure offers Retry or returns exit code `2` instead of launching the application as a successful installation. It neither restarts Explorer nor deletes the system icon cache. `dist:win` generates icons and runs `verify:installer-shortcuts`, which compiles the production updater against isolated temporary shortcuts and checks changed artwork, repeated installation, omitted Desktop links, and locked-icon failure.

## Permanent user-data paths

Electron pins `userData` before the single-instance lock to `%APPDATA%\@sudotech\xiaojing-accounting-desktop`. The bundled Host uses its `harness` child as `DSH_HOME`. `%USERPROFILE%\Documents\小兢会计工作区` is the common workspace container: the ordinary Host starts in its `办公工作区` child supplied through `XIAOJING_OFFICE_WORKSPACE_ROOT`, while Finance receives the sibling `Finance工作区` through `XIAOJING_FINANCE_WORKSPACE_ROOT`. New ordinary and Finance Workspaces therefore do not nest inside one another by default. The Electron directory dialog uses `办公工作区` when an ordinary add action supplies no initial path; the packaged preload forwards each Finance add action's explicit absolute path, so both client-ledger and consultation creation start in `Finance工作区`. Neither starting directory restricts the user's final selection.

The 0.2.0 RC2 `DesktopHostProcess` owns the loopback Host lifecycle and pins `DSH_CLIENT_BUILD_PROFILE=xiaojing`, so only the Electron shell loads the application and Xiaojing-only Host plugins remain active in packaged builds. The desktop exchanges the authenticated launch token for a Host cookie used by the companion state stream; users do not open a printed URL.

`user-data-contract.json` protects sessions, settings, credentials, agent presets, profiles, storage, legacy uploads, native image attachments, usage accounting, the dedicated browser-control profile, Weixin channel state, desktop-companion preferences, Electron Local Storage, and the Documents workspace. The installer has `deleteAppDataOnUninstall: false` and never addresses those paths. `verify-user-data-contract.mjs` exercises a synthetic 0.1.9 data set through application replacement and the current readers. It requires protected bytes to remain unchanged except for exact installation-owned Web profile migrations from retired file-upload bundle tuples, with or without ModLens, to the current Web template; it verifies the atomic flat-to-version-1 credential migration on a private copy without creating a plaintext backup, and checks session, credential, preset, settings, upload, storage, and accounting compatibility. The V3 session migration accepts the fixture's immediately pre-step user message without rewriting its source; this gate must pass before an upgraded desktop release. A release that changes another durable format must add an atomic migration and a previous-release fixture before this check may change.

## Development preview isolation

Source-only Electron previews may set `DSH_DESKTOP_PREVIEW_ROOT` to an empty temporary directory before starting the desktop package. Unpackaged runs then place both Electron application data and the Documents workspace below that root; packaged builds ignore the variable and retain the permanent paths above. This keeps development previews from reading or writing an installed user's data. Before creating a development window, the desktop verifies that the shared Client artifacts came from a complete Xiaojing build; a missing or incompatible record stops with an instruction to run `pnpm run build:xiaojing` instead of showing an official or incomplete interface.

## Desktop companion and tray lifecycle

The main-window preload enables the Web layout's 40px Windows caption row before the application renders. Conversation and plugin controls stay below the native window buttons; the transparent companion does not reserve a caption. Drag regions belong to the layout, without an injected overlay over interactive content. Companion drag coordinates are rounded to signed 32-bit integers with negative zero normalized to zero; out-of-range coordinates are ignored before reaching the native window.

The desktop creates a transparent, focusless Xiaojing companion window and a system tray when Electron becomes ready. The companion uses the `screen-saver` topmost level and restores its stacking order on show and once per second while visible, except during dragging or pending placement. It reapplies the topmost flag only when the flag is lost. Raising it does not activate it or take keyboard focus; closing it releases the refresh timer. Windows secure desktops such as UAC and the lock screen remain outside this behavior. The Host-side companion plugin reduces session, approval, and sanitized Weixin lifecycle events to a content-free global state; Electron maps that state to the bundled idle, thinking, executing, approval, success, and failure assets without exposing task content to either renderer.

The companion can be dragged across displays, defaults to 50% of the original character size, and exposes a 30%–100% size control in Settings. Every application launch and Reset position action center the character between the measured composer right edge and the main-window content right edge. The main preload reports CSS layout coordinates; Electron converts them to screen coordinates. During native main-window dragging or resizing, the companion stays still; after the interaction ends and geometry updates stop for 150 ms, it uses the latest layout once. Renderer zoom follows the same settling rule. While the main window is minimized, the companion keeps its screen position; restoring the main window resumes automatic placement. A manual companion drag disables following until Reset or the next launch. When the gutter cannot contain the visible character with padding, it moves above the composer. Before a composer mounts, the startup window uses a bottom-right fallback. A drag position is retained only during the current application run, including tucking and waking; a new launch ignores the previous run's position. When a visible companion is created during desktop startup, it waits until the main application interface has loaded, waits another three seconds, and then shows the two-line introduction “你好，我是小兢会计， / 您的AI办公搭子！” once for five seconds; an active task cancels or replaces the introduction immediately, and a later manual wake does not replay it. After three continuous idle minutes, it shows exactly two different three-second poses selected from neutral thinking, presenting, and energetic artwork, then returns to the default pose and waits for the next idle interval. This idle cycle does not change the Host task state or display a task-status bubble; task activity cancels it immediately, and Windows reduced-motion preference disables it. Its scale and clamped work-area position are stored in `%APPDATA%\@sudotech\xiaojing-accounting-desktop\desktop-companion\preferences-v1.json`; the status bubble follows the scaled character instead of remaining at the top of the transparent window. The companion returns to the main window's display when a saved monitor is unavailable. Tucking it destroys only its BrowserWindow, while the Host, active tasks, and Weixin channel continue running and the Settings page or tray can wake it again.

Closing the main window hides it to the tray instead of exiting. The minimize button keeps its normal taskbar behavior, a second application launch restores the existing main window, and the application and tray quit commands use the shared quit controller. It confirms interruption when active tasks, Weixin connectivity, or scheduled tasks indicate risk, then destroys the main window before stopping the Host so renderer event streams cannot reconnect during shutdown. Companion and Platform cleanup and Host exit are awaited before the application exits. The first background transition uses the shared notification controller; the companion owns the sole system tray. The renderer receives the eight product methods plus two narrow bridges declared by `src/preload-app.ts` (compiled as `lib/preload-app.cjs`): one chooses a directory and one opens an existing absolute workspace directory through Electron's OS shell. The main process validates the owning renderer and path before either operation; the renderer receives no Node, filesystem, arbitrary IPC, or BrowserWindow access.

## Built-in automation runtimes

Browser automation uses the [native Edge and Chrome connections](../../packages/xiaojing/xiaojing-browser-control/README.md#native-browser-connections). Edge is the default; an explicit Chrome request selects Chrome. Browser Control settings enable already-open tabs through the browser's remote debugging permission and connection approval, without extension pairing, port entry, or token entry. Managed connections provide separate browser profiles when the requested browser and device policy permit them. Windows application control uses Windows PowerShell 5.1 and the operating system's `System.Windows.Automation` API. End users do not install Node, a browser driver, PowerShell module, or a separate automation service.

Both capabilities are independent Cordis rows. A development overlay can disable either row, while the Xiaojing product composition enables both and tells every new agent session when they are available. Browser and Windows observations use session-owned opaque identifiers and expire after state changes. Protected actions request approval; explicit session authorization applies only to eligible observed operation and target classifications, while unclassified actions remain one-shot.

## Independent integration patches

`integration-patches.json` inventories desktop API-key environment isolation, profile runtime-shadow protection, and file-upload composer repair separately from the product brand plugin. rc.2 owns the writable credential UI; the desktop patch only removes inherited `DEEPSEEK_API_KEY` values before Host startup. The desktop identity check fails if an inventory entry disappears or its owned path is absent. This keeps upstream conflict review focused without pretending these patches are official Harness behavior.

## Release checks

The desktop package target builds the Xiaojing client profile and passes `--client-profile xiaojing` to DSH tarball packing. The packer checks both the exact public build values and the artifact digest; ordinary npm packing and publishing retain the official profile requirement.

Run the identity, user-data, and product-layer verifiers plus desktop-companion, real Edge, and Windows UI Automation tests before preparing the bundled runtime. A release also requires a fresh Windows install and an in-place upgrade from the previous installer on both default and custom paths. The installed application must retain sessions, credentials, presets, plugins, attachments, workspaces, accounting data, the dedicated browser profile, Weixin channel state, and desktop-companion preferences before an installer is published.

The 0.2.0 RC2 package target runs `smoke-packaged-runtime.ts` against the assembled application before it writes the release record. The smoke verifies the prepared DSH tree, the packaged executable and primary runtime, including native Office conversion outside ASAR.

## Known limitations

- Signed release packaging uses the 0.2.0 RC2 updater and Windows signing pipeline; the explicit unsigned package command remains for local qualification only.
- In-place upgrades apply only to the same Windows user and cannot move the installation directory.
- The requested Edge or Chrome browser must be installed and permitted by device policy. Existing-tab access additionally requires its native remote debugging permission and connection approval; failures do not switch browsers.
- The built-in automation is semantic, not visual: it cannot operate pixel-only controls, CAPTCHAs, UAC, the secure desktop, or elevated applications.

<a id="bundled-workspace-dependencies"></a>
### Bundled workspace dependencies

Desktop main bundles inline workspace dependencies after the Host build; `desktop-bundle-imports.mjs` checks unresolved imports before packaging.

<a id="release-versions"></a>
### Release versions

`identity.json.productVersion` owns the Xiaojing application version; workspace package versions identify the Harness engine. Unpackaged previews display the identity's product version in About and the product renderer; packaged applications display their packaged version. `DSH_DESKTOP_BUILD_VERSION` must extend the application version through the validated test prerelease format.

<a id="upload-updates"></a>
### Upload updates

Update upload requires a completed package record and explicitly configured release storage credentials; the supervised uploader records each PUT and final outcome locally. Uploading and public CDN readback are separate release operations.

<a id="windows-ev-signing"></a>
### Windows EV signing

Signed packaging requires the configured EV certificate, signing toolchain and signature-cache ownership checks. Unsigned local qualification does not perform hardware signing or authorize publishing a release.
