import { spawn } from 'node:child_process'
import { access, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import * as LocalProcesses from '@deepseek-ai/dsh-subprocess-local'
import { launchManagedEdge, type ManagedEdgeProcess } from '../src/native-edge-launch.ts'

const fixture = vi.hoisted(() => ({ mode: 'ready', source: '' }))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn((command: string, args: readonly string[], options: import('node:child_process').SpawnOptions) => {
    if (command.endsWith('fixture-edge.exe')) return actual.spawn(process.execPath, [fixture.source, fixture.mode, ...args], options)
    return actual.spawn(command, [...args], options)
  }) }
})

const browsers: ManagedEdgeProcess[] = []
afterEach(async () => {
  await Promise.all(browsers.splice(0).map(browser => browser.close()))
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function start(mode = 'ready', headless = false, timeoutMs = 5_000, signal = new AbortController().signal) {
  Object.assign(fixture, { mode, source: fileURLToPath(new URL('./fixtures/native-edge-process.mjs', import.meta.url)) })
  const browser = await launchManagedEdge({ executablePath: resolve('fixture-edge.exe'), headless, timeoutMs }, signal)
  browsers.push(browser)
  return browser
}

it.each([false, true])('starts an isolated loopback Edge with sandbox enabled (headless=%s)', async (headless) => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-secret')
  const browser = await start('ready', headless)
  await expect(browser.endpoint).resolves.toBe('ws://127.0.0.1:43210/devtools/browser/fixture-edge')
  const [, args, options] = vi.mocked(spawn).mock.calls[0] ?? []
  expect(args).toContain(`--user-data-dir=${browser.profileDir}`)
  expect(args).toContain('--remote-debugging-address=127.0.0.1')
  expect(args).toContain('--remote-debugging-port=0')
  expect(args).not.toContain('--no-sandbox')
  expect(args?.includes('--headless=new')).toBe(headless)
  expect(options).toMatchObject({ windowsHide: false, stdio: 'ignore' })
  expect(options?.env).not.toHaveProperty('DEEPSEEK_API_KEY')
})

it('awaits only its real process tree and removes its profile after concurrent close', async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  try {
    const browser = await start()
    await browser.endpoint
    const pids = JSON.parse(await readFile(join(browser.profileDir, 'fixture-pids.json'), 'utf8')) as { root: number; descendant: number }
    const first = browser.close()
    expect(browser.close()).toBe(first)
    await first
    expect(() => process.kill(pids.root, 0)).toThrow()
    expect(() => process.kill(pids.descendant, 0)).toThrow()
    expect(() => process.kill(unrelated.pid ?? 0, 0)).not.toThrow()
    await expect(access(browser.profileDir)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    const closed = new Promise<void>((resolveClose) => { unrelated.once('close', () => { resolveClose() }) })
    unrelated.kill('SIGKILL')
    await closed
  }
})

it.each(['wait', 'malformed'])('cleans up a %s startup when its deadline expires', async (mode) => {
  const browser = await start(mode, false, 2_000)
  await expect(browser.endpoint).rejects.toThrow()
  await expect(access(browser.profileDir)).rejects.toMatchObject({ code: 'ENOENT' })
}, 10_000)

it('cleans up a canceled startup before rejecting readiness', async () => {
  const controller = new AbortController()
  const browser = await start('wait', false, 5_000, controller.signal)
  const failure = expect(browser.endpoint).rejects.toThrow()
  await vi.waitFor(async () => { await access(join(browser.profileDir, 'fixture-pids.json')) })
  controller.abort(new Error('Fixture canceled'))
  await failure
  await expect(access(browser.profileDir)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('cleans up a failed spawn without reporting readiness', async () => {
  const browser = await launchManagedEdge({ executablePath: resolve('missing-native-edge.exe'), headless: false, timeoutMs: 5_000 }, new AbortController().signal)
  browsers.push(browser)
  await expect(browser.endpoint).rejects.toThrow(/ENOENT/u)
  await expect(access(browser.profileDir)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('retains the profile when its owned process identities do not stop by the cleanup deadline', async () => {
  const inspector = LocalProcesses.createProcessInspector()
  vi.spyOn(LocalProcesses, 'createProcessInspector').mockReturnValue({
    snapshot: () => inspector.snapshot(), isAlive: identity => inspector.isAlive(identity),
    foregroundPgid: pid => inspector.foregroundPgid(pid),
    isStdinWaiting: (pgid, pid) => inspector.isStdinWaiting(pgid, pid),
    signalGroup: () => {}, signalProcess: () => {},
  })
  const browser = await start('ready', false, 350)
  browsers.pop()
  await browser.endpoint
  const pids = JSON.parse(await readFile(join(browser.profileDir, 'fixture-pids.json'), 'utf8')) as { root: number; descendant: number }
  const owned = inspector.snapshot().tree(pids.root)
  try {
    await expect(browser.close()).rejects.toThrow('did not stop')
    await expect(access(browser.profileDir)).resolves.toBeUndefined()
    expect(inspector.isAlive(owned.find(identity => identity.pid === pids.root) ?? { pid: pids.root, started: '' })).toBe(true)
  } finally {
    for (const identity of owned) inspector.signalProcess(identity, 'SIGKILL')
    await vi.waitFor(() => { expect(owned.some(identity => inspector.isAlive(identity))).toBe(false) })
    expect(dirname(browser.profileDir)).toBe(resolve(tmpdir()))
    await rm(browser.profileDir, { recursive: true, force: true })
  }
})

it('fails before allocating a browser for canceled or relative executable requests', async () => {
  await expect(launchManagedEdge({ executablePath: 'relative-edge.exe', headless: false, timeoutMs: 5_000 }, new AbortController().signal)).rejects.toThrow('absolute')
  const controller = new AbortController()
  controller.abort(new Error('Already canceled'))
  await expect(launchManagedEdge({ executablePath: resolve('fixture-edge.exe'), headless: false, timeoutMs: 5_000 }, controller.signal)).rejects.toThrow('Already canceled')
  expect(spawn).not.toHaveBeenCalled()
})
