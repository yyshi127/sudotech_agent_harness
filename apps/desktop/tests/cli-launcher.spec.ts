/** Installed launcher scripts preserve terminal invocation through a minimal runtime fixture. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { prepareDesktopCli } from '../scripts/prepare-cli.ts'
import { XIAOJING_IDENTITY } from '../src/xiaojing-product.ts'

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-cli-launcher-')))
  const children: ChildProcessWithoutNullStreams[] = []
  const exits: Promise<unknown>[] = []
  onTestFinished(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    await Promise.allSettled(exits)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  const application = join(root, 'Application 中文 with spaces.app')
  const platform = process.platform === 'win32' ? 'win32' : 'darwin'
  const resources = join(application, ...platform === 'darwin' ? ['Contents', 'Resources'] : ['resources'])
  const cli = join(resources, 'runtime', 'cli')
  prepareDesktopCli(cli, platform)
  if (platform === 'win32') {
    const primaryNode = join(resources, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe')
    mkdirSync(dirname(primaryNode), { recursive: true })
    copyFileSync(process.execPath, primaryNode)
  }
  const electron = join(application, ...platform === 'darwin'
    ? ['Contents', 'MacOS', XIAOJING_IDENTITY.productName] : [`${XIAOJING_IDENTITY.executableName}.exe`])
  mkdirSync(dirname(electron), { recursive: true })
  if (platform === 'win32') copyFileSync(process.execPath, electron)
  else symlinkSync(process.execPath, electron)
  const entry = join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(join(dirname(entry), 'package.json'), '{"type":"module"}\n')
  writeFileSync(entry, [
    'const chunks = []',
    'for await (const chunk of process.stdin) chunks.push(chunk)',
    "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), value: process.env.DSH_CLI_TEST_VALUE, nodeMode: process.env.ELECTRON_RUN_AS_NODE, input: Buffer.concat(chunks).toString('hex') }))",
    "process.stderr.write('separate stderr\\n')",
    'process.exitCode = 23',
    '',
  ].join('\n'))
  const command = join(cli, 'bin', platform === 'win32' ? 'dsh.cmd' : 'dsh')
  function start(args: string[], executable = command) {
    // cmd fixture inputs contain no metacharacters; POSIX cases exercise literal expansion characters separately.
    const child = platform === 'win32'
      ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${executable}" ${args.map(value =>
        `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`).join(' ')}"`], {
        cwd: root, env: { ...process.env, DSH_CLI_TEST_VALUE: 'kept' }, stdio: 'pipe', windowsVerbatimArguments: true,
      })
      : spawn(executable, args, { cwd: root, env: { ...process.env, DSH_CLI_TEST_VALUE: 'kept' }, stdio: 'pipe' })
    children.push(child)
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    exits.push(closed)
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text })
    child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text })
    return { child, closed, stdout: () => stdout, stderr: () => stderr }
  }
  return { root, command, electron, start }
}

it('prepares both platform commands with the packaged product identity', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-cli-identity-')))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  for (const platform of ['win32', 'darwin'] as const) {
    const destination = join(root, platform)
    prepareDesktopCli(destination, platform)
    const command = readFileSync(join(destination, 'bin', platform === 'win32' ? 'dsh.cmd' : 'dsh'), 'utf8')
    expect(command).not.toContain('DeepSeek Harness')
    expect(command).not.toContain('__DSH_DESKTOP_EXECUTABLE__')
    if (platform === 'win32') {
      expect(command).toMatch(/^[\x00-\x7f]*$/u)
      expect(command).not.toContain('chcp')
      expect(readFileSync(join(destination, 'launch.mjs'), 'utf8'))
        .toContain(JSON.stringify(`${XIAOJING_IDENTITY.executableName}.exe`))
    } else expect(command).toContain(XIAOJING_IDENTITY.productName)
  }
})

it('preserves common arguments, cwd, environment, binary input, stderr and exit status', async () => {
  const f = fixture()
  const args = ['plugin', '--profile', 'desktop', 'hello world', '中文 🚀', '']
  const run = f.start(args)
  const input = Buffer.from([0, 1, 10, 255])
  run.child.stdin.end(input)
  expect(await run.closed, run.stderr()).toBe(23)
  expect(JSON.parse(run.stdout())).toEqual({ args, cwd: f.root, value: 'kept', nodeMode: '1', input: input.toString('hex') })
  expect(run.stderr()).toBe('separate stderr\n')
})

it.skipIf(process.platform !== 'win32')('preserves embedded quotes and trailing backslashes through the Windows bridge', async () => {
  const f = fixture()
  const args = ['quote"inside', 'trailing\\', 'space and "quotes"', '中文 "参数"', '']
  const run = f.start(args)
  run.child.stdin.end()
  expect(await run.closed, run.stderr()).toBe(23)
  expect(JSON.parse(run.stdout())).toMatchObject({ args })
})

it.skipIf(process.platform !== 'win32')('reports a missing product executable without using a legacy executable', async () => {
  const f = fixture()
  await rm(f.electron)
  copyFileSync(process.execPath, join(dirname(f.electron), 'DeepSeek Harness.exe'))
  const run = f.start([])
  run.child.stdin.end()
  expect(await run.closed).toBe(1)
  expect(run.stderr()).toContain('ENOENT')
  expect(run.stderr()).toContain(`${XIAOJING_IDENTITY.executableName}.exe`)
})

it.skipIf(process.platform === 'win32')('resolves chained command symlinks without expanding argument contents', async () => {
  const f = fixture()
  const link = join(f.root, 'command-link')
  const command = join(f.root, 'dsh')
  symlinkSync(relative(f.root, f.command), link)
  symlinkSync(link, command)
  const args = ['quote"inside', 'trailing\\', '%PATH%', '$HOME', '`literal`', '']
  const run = f.start(args, command)
  run.child.stdin.end()
  expect(await run.closed, run.stderr()).toBe(23)
  expect(JSON.parse(run.stdout())).toMatchObject({ args, cwd: f.root, nodeMode: '1' })
})
