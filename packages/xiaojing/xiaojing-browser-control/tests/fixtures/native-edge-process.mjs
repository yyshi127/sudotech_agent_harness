/** Owned local process replacing only the installed Edge executable in lifecycle tests. */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv.includes('--fixture-descendant')) {
  setInterval(() => {}, 1000)
} else {
  const mode = process.argv[2]
  const profile = process.argv.find(value => value.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
  if (profile === undefined) throw new Error('Owned Edge fixture requires a profile')
  const descendant = spawn(process.execPath, [import.meta.filename, '--fixture-descendant'], { stdio: 'ignore', windowsHide: true })
  writeFileSync(join(profile, 'fixture-pids.json'), JSON.stringify({ root: process.pid, descendant: descendant.pid }))
  if (mode === 'early-exit') {
    descendant.kill('SIGKILL')
    descendant.once('close', () => process.exit(2))
  } else {
    if (mode !== 'wait') setTimeout(() => {
      writeFileSync(join(profile, 'DevToolsActivePort'), mode === 'malformed' ? 'not-a-port\n/invalid\n' : '43210\n/devtools/browser/fixture-edge\n')
    }, 50)
    setInterval(() => {}, 1000)
  }
}
