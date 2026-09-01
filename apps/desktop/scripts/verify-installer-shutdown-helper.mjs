import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const helper = join(appRoot, 'build', 'installer-shutdown-helper.ps1')
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

async function spawnReadyProcess(executable) {
  const child = spawn(executable, [
    '-e',
    "process.stdout.write('ready'); setInterval(() => {}, 1000)",
  ], { stdio: ['ignore', 'pipe', 'ignore'] })
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'error').then(([error]) => Promise.reject(error)),
  ])
  return child
}

async function runHelper(installDirectory) {
  const child = spawn(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', helper,
    '-InstallDirectory', installDirectory,
    '-InstallerProcessId', String(process.pid),
    '-GracefulTimeoutSeconds', '1',
  ], { stdio: 'pipe' })
  const stderr = []
  child.stderr.on('data', chunk => stderr.push(chunk))
  return { ...await waitForExit(child), stderr: Buffer.concat(stderr).toString('utf8') }
}

const scratch = await mkdtemp(join(tmpdir(), 'xiaojing-installer-shutdown-'))
let unrelated
try {
  const installDirectory = join(scratch, 'xiaojing-agent-desktop')
  const runtimeDirectory = join(installDirectory, 'resources', 'runtime')
  await mkdir(runtimeDirectory, { recursive: true })

  const legacyDirectory = join(installDirectory, 'resources', 'app.asar.unpacked', 'node_modules', 'legacy-package')
  const overlongLegacyFile = join(legacyDirectory, `${'x'.repeat(260 - legacyDirectory.length)}.js`)
  const retainedProgramFile = join(installDirectory, 'retained-program-file.txt')
  await mkdir(legacyDirectory, { recursive: true })
  await writeFile(overlongLegacyFile, 'legacy')
  await writeFile(retainedProgramFile, 'retained')

  const idle = await runHelper(installDirectory)
  if (idle.code !== 0 || idle.signal !== null || idle.stderr !== '') {
    throw new Error(`empty installation directory was reported as running: ${JSON.stringify(idle)}`)
  }
  try {
    await access(overlongLegacyFile)
    throw new Error('overlong legacy program file was not removed before invoking the old uninstaller')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await access(retainedProgramFile)

  unrelated = await spawnReadyProcess(process.execPath)
  const withUnrelatedProcess = await runHelper(installDirectory)
  if (withUnrelatedProcess.code !== 0 || unrelated.exitCode !== null) {
    throw new Error('an unrelated process was treated as part of the Xiaojing installation')
  }

  const packagedNode = join(runtimeDirectory, basename(process.execPath))
  await copyFile(process.execPath, packagedNode)
  const packagedBackend = await spawnReadyProcess(packagedNode)
  const packagedExit = waitForExit(packagedBackend)
  const stopped = await runHelper(installDirectory)
  if (stopped.code !== 0 || stopped.signal !== null || stopped.stderr !== '') {
    throw new Error(`installed runtime shutdown failed: ${JSON.stringify(stopped)}`)
  }
  await packagedExit

  const unsafeDirectory = join(scratch, 'not-the-product-directory')
  await mkdir(unsafeDirectory)
  const rejected = await runHelper(unsafeDirectory)
  if (rejected.code === 0) {
    throw new Error('shutdown helper accepted an installation directory with the wrong identity')
  }
} finally {
  if (unrelated?.exitCode === null) unrelated.kill()
  await rm(scratch, { recursive: true, force: true })
}

console.log('installer exact-path shutdown and legacy long-path preflight verified')
