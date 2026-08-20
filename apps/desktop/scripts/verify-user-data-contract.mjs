import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(appRoot, 'tests', 'fixtures', '0.1.7')
const contract = JSON.parse(await readFile(join(appRoot, 'user-data-contract.json'), 'utf8'))
const identity = JSON.parse(await readFile(join(appRoot, 'identity.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
const main = await readFile(join(appRoot, 'main.mjs'), 'utf8')
const installer = await readFile(join(appRoot, 'build', 'installer.nsh'), 'utf8')

if (contract.schemaVersion !== 1
  || contract.electronUserData !== '%APPDATA%\\@sudotech\\xiaojing-accounting-desktop'
  || contract.harnessHome !== 'harness'
  || contract.documentsWorkspace !== '小兢会计工作区') {
  throw new Error('desktop user-data paths changed; an explicit migration and previous-version fixture are required')
}
if (JSON.stringify(identity.userDataSegments) !== JSON.stringify(['@sudotech', 'xiaojing-accounting-desktop'])) {
  throw new Error('desktop identity no longer resolves the protected Electron user-data root')
}
if (manifest.build?.nsis?.deleteAppDataOnUninstall !== false) {
  throw new Error('the installer must retain application data on uninstall and in-place update')
}
if (!main.includes("app.setPath('userData', join(app.getPath('appData'), ...identity.userDataSegments))")
  || !main.includes("join(app.getPath('userData'), 'harness')")
  || !main.includes("join(app.getPath('documents'), '小兢会计工作区')")) {
  throw new Error('desktop startup no longer uses the permanent user-data paths')
}
if (/APPDATA|Local Storage|\.credentials|\.agent-presets|usage-accounting/i.test(installer)) {
  throw new Error('custom installer script must never address protected user data')
}

async function filesBelow(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(path))
    else files.push(path)
  }
  return files
}

async function hashes(root) {
  const result = {}
  for (const path of await filesBelow(root)) {
    const key = relative(root, path).replaceAll('\\', '/')
    result[key] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
  return result
}

const fixtureAppData = join(fixtureRoot, 'app-data')
const fixtureFiles = (await filesBelow(fixtureAppData)).map(path => relative(fixtureAppData, path).replaceAll('\\', '/'))
for (const protectedPath of contract.protectedPaths) {
  if (!fixtureFiles.some(path => path === protectedPath || path.startsWith(`${protectedPath}/`))) {
    throw new Error(`0.1.7 upgrade fixture does not cover protected path ${protectedPath}`)
  }
}

const scratch = await mkdtemp(join(tmpdir(), 'xiaojing-upgrade-data-'))
try {
  const appData = join(scratch, 'app-data')
  const documents = join(scratch, 'documents')
  const install = join(scratch, identity.installDirectoryName)
  await cp(fixtureAppData, appData, { recursive: true })
  await cp(join(fixtureRoot, 'documents'), documents, { recursive: true })
  const before = { appData: await hashes(appData), documents: await hashes(documents) }

  await mkdir(install, { recursive: true })
  await writeFile(join(install, 'old-application-file.txt'), '0.1.7')
  await writeFile(join(install, 'new-application-file.txt'), manifest.version)

  const after = { appData: await hashes(appData), documents: await hashes(documents) }
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error('synthetic in-place application replacement changed protected 0.1.7 user data')
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log('desktop 0.1.7 user-data preservation contract verified')
