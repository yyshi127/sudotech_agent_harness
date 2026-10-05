/** Forward the installed Windows dsh command without changing console encoding. */

import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const executableName = '__DSH_DESKTOP_EXECUTABLE__'
const resources = resolve(import.meta.dirname, '../..')

// Windows broadcasts console interrupts to both processes; the CLI owns shutdown.
process.on('SIGINT', () => {})
process.on('SIGBREAK', () => {})

const child = spawn(join(resources, '..', executableName), [
  '--expose-internals',
  join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
  ...process.argv.slice(2),
], { stdio: 'inherit', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })

child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('close', code => { if (process.exitCode === undefined) process.exitCode = code ?? 1 })
