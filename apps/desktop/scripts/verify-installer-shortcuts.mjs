/** Exercise native shortcut upgrades without touching the installed app or real Desktop. */
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { getMakeNsisPath, getNsisPluginsPath } from 'app-builder-lib/out/toolsets/windows.js'

const require = createRequire(import.meta.url)
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|^PSModulePath$/i.test(key)))
const compiler = await getMakeNsisPath()
const plugins = await getNsisPluginsPath()
const { stdout } = await promisify(execFile)('powershell.exe', [
  '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', fileURLToPath(new URL('./smoke-installer-shortcuts.ps1', import.meta.url)),
  '-Makensis', compiler.path,
  '-BuilderInclude', join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/include'),
  '-PluginDirectory', join(plugins, 'x86-unicode'),
], { env: { ...env, ...compiler.env }, windowsHide: true, timeout: 60_000 })
process.stdout.write(stdout)
