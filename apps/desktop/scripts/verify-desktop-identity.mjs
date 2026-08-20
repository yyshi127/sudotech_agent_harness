import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const identity = JSON.parse(await readFile(join(appRoot, 'identity.json'), 'utf8'))
const integration = JSON.parse(await readFile(join(appRoot, 'integration-patches.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
const installer = await readFile(join(appRoot, 'build', 'installer.nsh'), 'utf8')
const main = await readFile(join(appRoot, 'main.mjs'), 'utf8')

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

const expectedPatchIds = [
  'api-key-post-configuration',
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
  ['product name', manifest.build?.productName, identity.productName],
  ['executable name', manifest.build?.win?.executableName, identity.executableName],
  ['shortcut name', manifest.build?.nsis?.shortcutName, identity.shortcutName],
  ['per-user install', manifest.build?.nsis?.perMachine, false],
  ['uninstall data retention', manifest.build?.nsis?.deleteAppDataOnUninstall, false],
]

for (const [label, actual, wanted] of checks) {
  if (actual !== wanted) throw new Error(`${label} must remain ${JSON.stringify(wanted)}`)
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
if (!main.includes("app.setPath('userData'")) {
  throw new Error('Electron userData must be pinned before startup')
}
if (!main.includes('app.setAppUserModelId(identity.appId)')) {
  throw new Error('Electron AppUserModelId must come from identity.json')
}

console.log(`desktop identity verified for ${manifest.name} ${manifest.version}`)
