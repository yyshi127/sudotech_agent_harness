import { cp, lstat, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'

const PACKAGE_NAME = '@sudotech/xiaojing-accounting-desktop'
const appRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(appRoot, '..', '..')
const deployBase = resolve(repoRoot, 'dist')
const deployRoot = resolve(deployBase, 'desktop-runtime')

assertChild(deployBase, deployRoot)

await requireBuiltArtifact(resolve(repoRoot, 'apps', 'cli', 'lib', 'bin.js'))
await requireBuiltArtifact(resolve(repoRoot, 'apps', 'web', 'dist', 'index.html'))

await rm(deployRoot, { recursive: true, force: true })
await mkdir(deployBase, { recursive: true })

const pnpmEntry = process.env.npm_execpath
if (pnpmEntry === undefined || pnpmEntry.trim() === '') {
  throw new Error('prepare-runtime: npm_execpath is unavailable; run this script through pnpm.')
}

await run(process.execPath, [
  pnpmEntry,
  '--filter',
  PACKAGE_NAME,
  'deploy',
  '--prod',
  '--config.inject-workspace-packages=true',
  '--config.node-linker=hoisted',
  '--config.strict-dep-builds=false',
  deployRoot,
], repoRoot)

await cp(process.execPath, join(deployRoot, 'node.exe'))

await requireBuiltArtifact(join(deployRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
await rejectLinks(join(deployRoot, 'node_modules'))

const bytes = await directorySize(deployRoot)
console.log(`prepare-runtime: staged ${String(bytes)} bytes in ${relative(repoRoot, deployRoot)}`)

async function rejectLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) {
      throw new Error(`prepare-runtime: staged link remains at ${path}`)
    }
    if (metadata.isDirectory()) await rejectLinks(path)
  }
}

async function directorySize(directory) {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) total += await directorySize(path)
    else total += (await stat(path)).size
  }
  return total
}

async function requireBuiltArtifact(path) {
  try {
    await stat(path)
  } catch {
    throw new Error(`prepare-runtime: required build artifact is missing: ${path}`)
  }
}

function assertChild(parent, child) {
  const prefix = `${parent}${sep}`
  if (!child.startsWith(prefix)) {
    throw new Error(`prepare-runtime: refusing to manage path outside ${parent}: ${child}`)
  }
}

async function run(command, args, cwd) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`prepare-runtime: command failed (code=${String(code)}, signal=${String(signal)}): ${command} ${args.join(' ')}`))
    })
  })
}
