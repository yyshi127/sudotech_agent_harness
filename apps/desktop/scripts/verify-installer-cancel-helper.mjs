import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceHelper = join(appRoot, 'build', 'installer-cancel-helper.ps1')
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

async function runHelper(helper, args) {
  const child = spawn(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', helper,
    ...args,
    '-SuppressUi',
  ], { stdio: 'pipe' })
  const stderr = []
  child.stderr.on('data', chunk => stderr.push(chunk))
  const result = await waitForExit(child)
  return { ...result, stderr: Buffer.concat(stderr).toString('utf8') }
}

const scratch = await mkdtemp(join(tmpdir(), 'xiaojing-installer-cancel-'))
try {
  const helper = join(scratch, 'cancel-helper.ps1')
  const installDirectory = join(scratch, 'xiaojing-agent-desktop')
  await copyFile(sourceHelper, helper)
  await mkdir(installDirectory)
  await writeFile(join(installDirectory, 'partial-file.txt'), 'partial')

  const blocker = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 800)'], { stdio: 'ignore' })
  const completedLog = join(tmpdir(), `xiaojing-installer-cancel-${blocker.pid}.log`)
  const startedAt = Date.now()
  const completed = await runHelper(helper, [
    '-InstallerProcessId', String(blocker.pid),
    '-InstallDirectory', installDirectory,
  ])
  if (completed.code !== 0 || completed.signal !== null || completed.stderr !== '') {
    throw new Error(`fresh-install cancellation helper failed: ${JSON.stringify(completed)}`)
  }
  if (Date.now() - startedAt < 600) {
    throw new Error('fresh-install cancellation helper did not wait for the installer process')
  }
  try {
    await readFile(helper)
    throw new Error('fresh-install cancellation helper did not remove its temporary script')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    await readFile(join(installDirectory, 'partial-file.txt'))
    throw new Error('fresh-install cancellation helper retained the partial installation')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const unsafeHelper = join(scratch, 'unsafe-helper.ps1')
  const unsafeDirectory = join(scratch, 'must-not-delete')
  await copyFile(sourceHelper, unsafeHelper)
  await mkdir(unsafeDirectory)
  await writeFile(join(unsafeDirectory, 'keep.txt'), 'keep')
  const rejected = await runHelper(unsafeHelper, [
    '-InstallerProcessId', '2147483646',
    '-InstallDirectory', unsafeDirectory,
  ])
  if (rejected.code === 0 || await readFile(join(unsafeDirectory, 'keep.txt'), 'utf8') !== 'keep') {
    throw new Error('fresh-install cancellation helper accepted an unsafe cleanup directory')
  }
  await rm(completedLog, { force: true })
  await rm(join(tmpdir(), 'xiaojing-installer-cancel-2147483646.log'), { force: true })
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log('fresh-install immediate cancellation helper verified')
