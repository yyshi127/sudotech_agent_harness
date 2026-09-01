/** Verify the generated Electron archive and boot its packaged Xiaojing Host. */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const resourcesPath = join(appRoot, 'dist', 'installer', 'win-unpacked', 'resources')
const archivePath = join(resourcesPath, 'app.asar')
if (!existsSync(archivePath)) {
  throw new Error(`packaged Electron archive is missing: ${archivePath}`)
}

const localRequire = createRequire(import.meta.url)
const builderRequire = createRequire(localRequire.resolve('electron-builder/package.json'))
const asar = builderRequire('@electron/asar')
const archiveEntries = new Set(asar.listPackage(archivePath).map(entry => entry.replaceAll('\\', '/')))
const packagedMain = asar.extractFile(archivePath, 'main.mjs').toString('utf8')

for (const match of packagedMain.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
  const importedFile = match[1]
  if (!archiveEntries.has(`/${importedFile}`)) {
    throw new Error(`packaged Electron archive is missing main-process import: ${importedFile}`)
  }
}

await verifyPackagedHostBoot(resourcesPath)

console.log('packaged Electron main-process imports and Xiaojing Host boot verified')

async function verifyPackagedHostBoot(resourcesRoot) {
  const nodePath = join(resourcesRoot, 'runtime', 'node.exe')
  const cliPath = join(
    resourcesRoot,
    'app.asar.unpacked',
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  )
  for (const requiredPath of [nodePath, cliPath]) {
    if (!existsSync(requiredPath)) throw new Error(`packaged backend runtime is missing: ${requiredPath}`)
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'xiaojing-packaged-runtime-'))
  const workspacePath = join(temporaryRoot, 'workspace')
  mkdirSync(workspacePath, { recursive: true })
  const environment = {
    ...process.env,
    DSH_CLIENT_BUILD_PROFILE: 'xiaojing',
    DSH_HOME: join(temporaryRoot, 'dsh-home'),
    XIAOJING_FINANCE_WORKSPACE_ROOT: join(temporaryRoot, 'finance-workspaces'),
    XIAOJING_EDGE_EXTENSION_DIR: join(resourcesRoot, 'xiaojing-edge-extension'),
    DSH_TELEMETRY_DISABLED: '1',
    NO_COLOR: '1',
  }
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === 'DEEPSEEK_API_KEY') delete environment[name]
  }

  const child = spawn(nodePath, [cliPath, 'web', '--port', '0', '--no-open'], {
    cwd: workspacePath,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-32_768)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  try {
    await new Promise((resolveBoot, rejectBoot) => {
      const timeout = setTimeout(() => {
        rejectBoot(new Error(`packaged Xiaojing Host did not become ready within 60 seconds:\n${output}`))
      }, 60_000)
      const finish = (callback) => {
        clearTimeout(timeout)
        callback()
      }
      child.stdout.on('data', () => {
        if (/dsh web:\s+http:\/\/127\.0\.0\.1:\d+/.test(output)) finish(resolveBoot)
      })
      child.once('error', error => finish(() => rejectBoot(error)))
      child.once('exit', (code, signal) => {
        finish(() => rejectBoot(new Error(
          `packaged Xiaojing Host exited before readiness (code=${String(code)}, signal=${String(signal)}):\n${output}`,
        )))
      })
    })
  } finally {
    terminateProcessTree(child)
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3 })
  }
}

function terminateProcessTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }
  child.kill('SIGTERM')
}
