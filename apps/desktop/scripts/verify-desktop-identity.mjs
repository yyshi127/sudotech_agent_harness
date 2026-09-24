import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const identity = JSON.parse(await readFile(join(appRoot, 'identity.json'), 'utf8'))
const integration = JSON.parse(await readFile(join(appRoot, 'integration-patches.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
const installer = await readFile(join(appRoot, 'build', 'installer.nsh'), 'utf8')
const shortcutInstaller = await readFile(join(appRoot, 'build', 'installer-shortcuts.nsh'), 'utf8')
const installerProductLogo = await readFile(join(appRoot, 'build', 'installer-product-logo.bmp'))
const installerProductLogoSmall = await readFile(join(appRoot, 'build', 'installer-product-logo-small.bmp'))
const installerCompanyLogo = await readFile(join(appRoot, 'build', 'installer-company-logo.bmp'))
const installerCancelHelper = await readFile(join(appRoot, 'build', 'installer-cancel-helper.ps1'), 'utf8')
const installerShutdownHelper = await readFile(join(appRoot, 'build', 'installer-shutdown-helper.ps1'), 'utf8')
const main = await readFile(join(appRoot, 'main.mjs'), 'utf8')
const buildResourceNames = await readdir(join(appRoot, 'build'))

const expected = Object.freeze({
  packageName: '@sudotech/xiaojing-accounting-desktop',
  appId: 'com.sudotech.xiaojing-accounting',
  nsisGuid: '1f6e3c2a-13e7-5ab1-a2d7-10b68c1b911a',
  installDirectoryName: 'xiaojing-agent-desktop',
  executableName: '小兢会计',
  productName: '小兢会计-您的AI办公搭子',
  installScope: 'currentUser',
  shortcutName: '小兢会计',
  userDataSegments: ['@sudotech', 'xiaojing-accounting-desktop'],
})

function assertWhiteBmpBorder(buffer, name) {
  const pixelOffset = buffer.readUInt32LE(10)
  const width = buffer.readInt32LE(18)
  const signedHeight = buffer.readInt32LE(22)
  const bitsPerPixel = buffer.readUInt16LE(28)
  if (width <= 0 || signedHeight === 0 || bitsPerPixel !== 24) {
    throw new Error(`${name} must remain a 24-bit BMP with positive dimensions`)
  }
  const height = Math.abs(signedHeight)
  const rowStride = Math.ceil(width * 3 / 4) * 4
  const isWhite = (x, y) => {
    const sourceY = signedHeight > 0 ? height - 1 - y : y
    const index = pixelOffset + sourceY * rowStride + x * 3
    return buffer[index] === 255 && buffer[index + 1] === 255 && buffer[index + 2] === 255
  }
  for (let x = 0; x < width; x += 1) {
    if (!isWhite(x, 0) || !isWhite(x, height - 1)) {
      throw new Error(`${name} must have a pure-white outer border`)
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (!isWhite(0, y) || !isWhite(width - 1, y)) {
      throw new Error(`${name} must have a pure-white outer border`)
    }
  }
}

const expectedPatchIds = [
  'desktop-api-key-environment-isolation',
  'profile-runtime-shadow-protection',
  'file-upload-composer-repair',
]

for (const [field, value] of Object.entries(expected)) {
  if (JSON.stringify(identity[field]) !== JSON.stringify(value)) {
    throw new Error(`desktop identity field ${field} changed; an in-place upgrade would no longer be safe`)
  }
}

if (integration.schemaVersion !== 1
  || JSON.stringify(integration.patches?.map(patch => patch.id)) !== JSON.stringify(expectedPatchIds)) {
  throw new Error('desktop integration patch inventory changed without an explicit compatibility update')
}
for (const patch of integration.patches) {
  if (!Array.isArray(patch.paths) || patch.paths.length === 0) {
    throw new Error(`desktop integration patch ${patch.id} has no owned paths`)
  }
  for (const path of patch.paths) await readFile(resolve(appRoot, '..', '..', path))
}

const checks = [
  ['package name', manifest.name, identity.packageName],
  ['app id', manifest.build?.appId, identity.appId],
  ['NSIS GUID', manifest.build?.nsis?.guid, identity.nsisGuid],
  ['installer icon', manifest.build?.nsis?.installerIcon, 'build/installer-runtime-icon.ico'],
  ['product name', manifest.build?.productName, identity.productName],
  ['executable name', manifest.build?.win?.executableName, identity.executableName],
  ['shortcut name', manifest.build?.nsis?.shortcutName, identity.shortcutName],
  ['per-user install', manifest.build?.nsis?.perMachine, false],
  ['uninstall data retention', manifest.build?.nsis?.deleteAppDataOnUninstall, false],
]

for (const [label, actual, wanted] of checks) {
  if (actual !== wanted) throw new Error(`${label} must remain ${JSON.stringify(wanted)}`)
}

const packagedFiles = new Set(manifest.build?.files ?? [])
for (const match of main.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
  const importedFile = match[1]
  if (!packagedFiles.has(importedFile)) {
    throw new Error(`Electron main-process import ${importedFile} must be included in build.files`)
  }
}

const version = String(manifest.version).split('.').map(Number)
if (version.length !== 3 || version.some(part => !Number.isInteger(part) || part < 0)) {
  throw new Error('desktop version must be a three-part numeric semver')
}
if (version[0] === 0 && version[1] === 1 && version[2] <= 7) {
  throw new Error('the next upgrade installer must be newer than 0.1.7')
}

if (!installer.includes(`!define APP_FILENAME "${identity.installDirectoryName}"`)) {
  throw new Error('installer directory identity no longer matches identity.json')
}
if (!installer.includes('${isUpdated}')) {
  throw new Error('installer must skip directory selection during an in-place update')
}
if (!installer.includes('!include "${BUILD_RESOURCES_DIR}\\installer-shortcuts.nsh"')
  || !/!macro customInstall\s+[\s\S]*!insertmacro xiaojingRefreshShortcutIcons[\s\S]*Call xiaojingFinalizeInstallSection/.test(installer)
  || !shortcutInstaller.includes('${StdUtils.HashFile} $R0 "SHA2-256"')
  || !shortcutInstaller.includes('!insertmacro xiaojingRefreshShortcut "$newDesktopLink" "$R1"')
  || !shortcutInstaller.includes('!insertmacro xiaojingRefreshShortcut "$newStartMenuLink" "$R1"')
  || !shortcutInstaller.includes('WinShell::SetLnkAUMI')
  || !shortcutInstaller.includes('SHChangeNotify(i 0x2000, i 0x1005')) {
  throw new Error('installer must refresh both shortcut icons and notify Windows before reporting success')
}
if (!(await readFile(join(appRoot, 'build', 'app-icon.png'))).equals(await readFile(join(appRoot, 'assets', 'windows-icon.png')))) {
  throw new Error('Windows executable and window icons differ; run prepare:icons')
}
if (!installer.includes('!macro customWelcomePage')
  || !installer.includes('StrCpy $isForceCurrentInstall "1"')
  || !installer.includes('!macro customFinishPage')
  || !installer.includes('SetCtlColors $xiaojingWelcomeInstallButton "FFFFFF" "12A489"')) {
  throw new Error('installer must retain the two-stage Xiaojing setup flow and SUDO green action')
}
if (!installer.includes('Var /GLOBAL xiaojingSelectedInstallDirectory')
  || !installer.includes('StrCpy $xiaojingSelectedInstallDirectory "$INSTDIR"')
  || !installer.includes('!define MUI_PAGE_CUSTOMFUNCTION_PRE xiaojingRestoreSelectedInstallDirectory')
  || !installer.includes('Function xiaojingRestoreSelectedInstallDirectory')
  || !installer.includes('StrCpy $INSTDIR "$xiaojingSelectedInstallDirectory"')) {
  throw new Error('installer must restore the selected directory after current-user install mode initialization')
}
const autoDiscoveredLicenseFiles = buildResourceNames.filter(name => /^(?:license|eula)(?:[_.]|$)/i.test(name))
if (manifest.build?.nsis?.license != null || autoDiscoveredLicenseFiles.length > 0) {
  throw new Error('installer must not generate a separate electron-builder license page')
}
if (!manifest.build?.extraResources?.some(resource => resource.from === 'build/internal-use-notice.txt'
  && resource.to === 'legal/Xiaojing-Internal-Use-Notice.txt')) {
  throw new Error('installer internal-use notice must remain available under resources/legal')
}
if (!installer.includes('installer-product-logo.bmp')
  || installerProductLogo.subarray(0, 2).toString('ascii') !== 'BM'
  || installerProductLogoSmall.subarray(0, 2).toString('ascii') !== 'BM'
  || installerCompanyLogo.subarray(0, 2).toString('ascii') !== 'BM') {
  throw new Error('installer brand bitmaps are missing or invalid')
}
if (installerProductLogo.readUInt32LE(18) !== 480
  || installerProductLogo.readUInt32LE(22) !== 400
  || installerProductLogoSmall.readUInt32LE(18) !== 72
  || installerProductLogoSmall.readUInt32LE(22) !== 72
  || installerCompanyLogo.readUInt32LE(18) !== 110
  || installerCompanyLogo.readUInt32LE(22) !== 28) {
  throw new Error('installer artwork, cancellation, and company bitmaps must match their presentation sizes')
}
assertWhiteBmpBorder(installerCompanyLogo, 'installer company logo')
if (!installer.includes('!define MUI_CUSTOMFUNCTION_ABORT xiaojingInstallerAbortRequested')
  || !installer.includes('!macro customInstall')
  || !installer.includes('确定取消安装？')
  || !installer.includes('更新开始后无法取消')
  || !installer.includes('为保护原版本，请等待本次更新完成。')
  || !installer.includes('${ifNot} ${isUpdated}')
  || !installer.includes('IfFileExists "$INSTDIR" xiaojingPrepareCancellationDone')
  || !installer.includes('xiaojingStartFreshCancel')
  || !installer.includes('installer-cancel-helper.ps1')
  || !installer.includes('SetErrorLevel 1602')
  || !installer.includes('Call muiPageLoadFullWindow')
  || !installer.includes('ShowWindow $mui.InstFilesPage.Log ${SW_HIDE}')
  || !installer.includes('正在安装小兢会计，请稍候…')
  || !installer.includes('xiaojing-company-logo.bmp')
  || !installer.includes('${NSD_SetStretchedImage} $xiaojingProgressProductControl')
  || !/CreateWindowExW\([^\n]+p \$mui\.InstFilesPage[^\n]+\) p \.r0'[\s\S]+StrCpy \$xiaojingProgressProductControl \$0/.test(installer)
  || !installer.includes('StrCpy $R4 820')
  || !installer.includes('StrCpy $R5 680')
  || installer.includes('Function xiaojingRestoreNativeInstallerWindow')
  || installer.includes('USER32::GetMessageW')
  || installer.includes('xiaojingCancelMessageLoop')
  || !installerCancelHelper.includes("-cne 'xiaojing-agent-desktop'")
  || !installerCancelHelper.includes('Wait-Process -Timeout 30')) {
  throw new Error('installer must retain the branded progress layout, use native cancellation prompts, and prevent cancellation after an update starts')
}
if (installer.includes('xiaojingScheduleRollback')
  || installer.includes('APP_INSTALLER_STORE_FILE')
  || installer.includes('/S /currentuser /D=$INSTDIR')) {
  throw new Error('installer must not use the failed previous-installer rollback path')
}
if (!installer.includes('!macro customCheckAppRunning')
  || !installer.includes('ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation')
  || !installer.includes('installer-shutdown-helper.ps1')
  || !installerShutdownHelper.includes("$expectedDirectoryName = 'xiaojing-agent-desktop'")
  || !installerShutdownHelper.includes('Get-CimInstance -ClassName Win32_Process')
  || !installerShutdownHelper.includes('$_.ExecutablePath')
  || !installerShutdownHelper.includes('Remove-OverlongLegacyInstallEntries')
  || !installerShutdownHelper.includes('$maximumLegacyPathLength = 259')
  || !installerShutdownHelper.includes("$shutdownArgument = '--xiaojing-shutdown-for-update'")
  || !main.includes("const UPDATE_SHUTDOWN_ARGUMENT = '--xiaojing-shutdown-for-update'")) {
  throw new Error('installer must stop only owned processes and remove legacy overlong program paths before replacement')
}
if (!main.includes("app.setPath('userData'")) {
  throw new Error('Electron userData must be pinned before startup')
}
if (!main.includes("const previewRoot = !app.isPackaged ? process.env.DSH_DESKTOP_PREVIEW_ROOT?.trim() : undefined")
  || !main.includes("app.setPath('appData', appData)")
  || !main.includes("app.setPath('documents', documents)")) {
  throw new Error('source Electron previews must isolate application data and Documents workspaces')
}
if (!main.includes("[paths.cli, 'web', '--port', '0', '--no-open']")) {
  throw new Error('Electron must prevent the embedded Host from opening an external browser')
}
if (!main.includes("DSH_CLIENT_BUILD_PROFILE: 'xiaojing'")) {
  throw new Error('Electron must activate Xiaojing-only Host plugins at runtime')
}
if (!main.includes('app.setAppUserModelId(identity.appId)')) {
  throw new Error('Electron AppUserModelId must come from identity.json')
}

console.log(`desktop identity verified for ${manifest.name} ${manifest.version}`)
