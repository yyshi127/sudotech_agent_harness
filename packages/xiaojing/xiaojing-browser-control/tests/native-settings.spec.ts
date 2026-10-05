/** Operator RPC and native revocation through real profiles, Settings, and loopback Connection. */
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { Server, type IncomingMessage } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import BrowserUse from '@deepseek-ai/dsh-browser-use'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Llm, { ToolCallId } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Projections from '@deepseek-ai/dsh-session-projection'
import Approval from '@deepseek-ai/dsh-user-approval'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import NativeSettings from '../src/native-settings.ts'
import * as Native from '../src/native.ts'
import * as SettingsOpening from '../src/native-settings-open.ts'
import { findWindowsChromeExecutable } from '../src/native-chrome-executable.ts'
import { findWindowsEdgeExecutable } from '../src/managed-edge.ts'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'

const fixture = vi.hoisted(() => ({ root: '', browserCli: '', managerCli: '', edge: '', chrome: '', mode: '' }))
const childProcess = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process')
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); syncBuiltinESMExports() })

async function mounted(options: { openSettingsTimeoutMs?: number } = {}) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'xiaojing-native-settings-')))
  const contexts: Awaited<ReturnType<typeof boot>>[] = []
  onTestFinished(async () => {
    await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
    await rm(home, { recursive: true, force: true })
  })
  Object.assign(fixture, {
    root: home, mode: '', edge: join(home, 'fixture-edge.exe'), chrome: join(home, 'fixture-chrome.exe'),
    browserCli: fileURLToPath(new URL('./fixtures/native-browser.mjs', import.meta.url)),
    managerCli: fileURLToPath(new URL('./fixtures/native-manager.mjs', import.meta.url)),
  })
  const originalSpawn = childProcess.spawn
  vi.spyOn(childProcess, 'spawn').mockImplementation((command, args, options) => {
    if (Array.isArray(args)) {
      if (command === process.execPath && args.some((arg: string) => arg.replaceAll('\\', '/').endsWith('/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'))) {
        const browser = args.includes('http://127.0.0.1:9223') ? 'chrome' : 'edge'
        return originalSpawn(command, [fixture.browserCli, fixture.root, `xiaojing-${browser}-existing`, fixture.mode, 'devtools'], options)
      }
    }
    return originalSpawn(command, args, options)
  })
  syncBuiltinESMExports()
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  const modules = { editor: ConfigEditor, settings: Settings, web: WebServer, credentials: Credentials, connection: Connection,
    browserUse: BrowserUse, prompt: SystemPrompt, tools: Tools, llm: Llm, sessions: Sessions, agents: Agents, loop: AgentLoop,
    projections: Projections, approval: Approval, permissions: NativeSettings, native: Native }
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: Object.keys(modules).map(id => ({ id, name: `cordis:${id}`,
    config: id === 'web' ? { host: '127.0.0.1', port: 0 } : id === 'credentials' ? { path: join(home, 'credentials.yml'), dshHome: home, watch: false }
      : id === 'loop' ? { agents: [] } : id === 'native' ? { allowPrivateHosts: true, requireUserSettings: true,
        edge: { executablePath: fixture.edge, existingEndpoint: 'http://127.0.0.1:9222' },
        chrome: { executablePath: fixture.chrome, existingEndpoint: 'http://127.0.0.1:9223' } } : id === 'permissions' ? options : {},
  })) }]))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  const registrations = vi.spyOn(NativeSettings.prototype, 'registerRuntime')
  const start = async () => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (root) => {
      root.provide('profileContext', profile)
      Object.assign(root.loader.builtins, modules)
    })
    contexts.push(ctx)
    const runtime = registrations.mock.calls.at(-1)?.[0]
    if (runtime === undefined) throw new Error('Native runtime did not register')
    const inspect = vi.spyOn(runtime, 'inspect')
      .mockImplementation(async browser => ({ installed: true, setupReady: true, executablePath: fixture[browser] }))
    const revoke = vi.spyOn(runtime, 'revoke')
    const base = `http://127.0.0.1:${ctx.webServer.port}`
    // The real index authorization exchanges its own process token for a Cookie.
    let cookie = ''
    ctx.connection.authorizeIndex({ method: 'GET', url: ctx.connection.authenticatedUrl(base), headers: new Headers({ host: new URL(base).host }) }, {
      writeHead(_status, headers) { cookie = headers?.['set-cookie']?.split(';', 1)[0] ?? '' }, end() {},
    })
    if (cookie === '') throw new Error('Settings fixture token exchange failed')
    const rpc = async (method: string, payload: unknown = {}) => {
      const response = await fetch(`${base}/xiaojing-native-browser-control/${method}`, { method: 'POST',
        headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-settings', method, payload }) })
      expect(response.status).toBe(200)
      return Connection.serverResponseSchema.parse(await response.json()).result
    }
    return { ctx, inspect, revoke, rpc }
  }
  return { ...await start(), home, profile, start }
}

async function nativeEvents(root: string): Promise<{ event: string; name?: string; pid: number }[]> {
  try { return (await readFile(join(root, 'events.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string; name?: string; pid: number }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

it('persists browser permissions in the real profile without remounting and restores them after restart', async () => {
  const { ctx, revoke, rpc, profile, start } = await mounted()
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'permissions')!
  const fiber = entry.fiber
  expect(await rpc('status')).toMatchObject({ ok: true, value: { browsers: [
    { browser: 'chrome', enabled: false, state: 'disabled' }, { browser: 'edge', enabled: false, state: 'disabled' },
  ] } })
  expect(await rpc('set-enabled', { browser: 'edge', enabled: true })).toMatchObject({ ok: true })
  expect(await rpc('set-enabled', { browser: 'chrome', enabled: true })).toMatchObject({ ok: true })
  expect(entry.fiber).toBe(fiber)
  expect(revoke).not.toHaveBeenCalled()
  expect(await readFile(profile.patchPath, 'utf8')).toContain('edge: true')
  expect(await readFile(profile.patchPath, 'utf8')).toContain('chrome: true')
  await ctx.fiber.dispose()
  const restored = await start()
  expect(restored.ctx.xiaojingNativeBrowserSettings.enabled('edge')).toBe(true)
  expect(restored.ctx.xiaojingNativeBrowserSettings.enabled('chrome')).toBe(true)
  expect(await nativeEvents(profile.home)).toEqual([])
})

it('revokes actual native access once after persisting false and leaves an external browser alive', async () => {
  const { ctx, revoke, rpc, home, profile } = await mounted()
  const external = spawn(process.execPath, [fixture.managerCli, home, 'personal'], { stdio: ['pipe', 'pipe', 'ignore'] })
  onTestFinished(async () => { const exited = once(external, 'exit'); external.stdin?.end(); await exited })
  await once(external.stdout, 'data')
  expect(await rpc('set-enabled', { browser: 'edge', enabled: true })).toMatchObject({ ok: true })
  const owner = await ctx.agents.create({ sessionId: SessionId('settings-native-owner') })
  expect((await ctx.tools.execute({ name: 'browser_connect', agent: owner.agent, arguments: { surface: 'existing' },
    callId: ToolCallId('settings-connect'), signal: new AbortController().signal })).isError).toBe(false)
  expect(await rpc('status')).toMatchObject({ ok: true, value: { browsers: [expect.anything(), { browser: 'edge', state: 'connected' }] } })
  const pids = (await nativeEvents(home)).filter(event => event.event === 'start').map(event => event.pid)
  expect(await rpc('set-enabled', { browser: 'edge', enabled: false })).toMatchObject({ ok: true })
  expect(revoke).toHaveBeenCalledExactlyOnceWith('edge')
  expect(await rpc('set-enabled', { browser: 'edge', enabled: false })).toMatchObject({ ok: true })
  expect(revoke).toHaveBeenCalledOnce()
  expect(await readFile(profile.patchPath, 'utf8')).not.toContain('edge: true')
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  expect(() => process.kill(external.pid!, 0)).not.toThrow()
  const forbidden = await ctx.tools.execute({ name: 'mcp__xiaojing-edge-existing__take_snapshot', agent: owner.agent,
    arguments: { pageId: 1 }, callId: ToolCallId('settings-revoked-read'), signal: new AbortController().signal })
  expect(forbidden.isError).toBe(true)
})

it('keeps previously enabled access when the real profile write is rejected', async () => {
  const { ctx, revoke, rpc, profile } = await mounted()
  expect(await rpc('set-enabled', { browser: 'edge', enabled: true })).toMatchObject({ ok: true })
  await writeFile(profile.patchPath, '{}\n')
  expect(await rpc('set-enabled', { browser: 'edge', enabled: false })).toMatchObject({ ok: false })
  expect(ctx.xiaojingNativeBrowserSettings.enabled('edge')).toBe(true)
  expect(revoke).not.toHaveBeenCalled()
})

it('persists and revokes disabled access before inspecting an uninstalled browser', async () => {
  const { ctx, inspect, revoke, rpc, profile } = await mounted()
  expect(await rpc('set-enabled', { browser: 'edge', enabled: true })).toMatchObject({ ok: true })
  inspect.mockClear()
  inspect.mockImplementation(async () => {
    expect(ctx.xiaojingNativeBrowserSettings.enabled('edge')).toBe(false)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('edge')
    expect(await readFile(profile.patchPath, 'utf8')).not.toContain('edge: true')
    return { installed: false, setupReady: false }
  })
  expect(await rpc('set-enabled', { browser: 'edge', enabled: false })).toMatchObject({ ok: true, value: { browsers: [
    expect.anything(), { browser: 'edge', installed: false, enabled: false, state: 'disabled' },
  ] } })
  expect(inspect).toHaveBeenCalledTimes(2)
})

it('reports a successful revocation and the other browser when one installation inspection fails', async () => {
  const { ctx, inspect, revoke, rpc, profile } = await mounted()
  expect(await rpc('set-enabled', { browser: 'edge', enabled: true })).toMatchObject({ ok: true })
  inspect.mockImplementation(async (browser) => {
    if (browser === 'edge') throw new Error('Remote debugging is disabled by policy')
    return { installed: true, setupReady: true, executablePath: fixture[browser] }
  })
  expect(await rpc('status')).toMatchObject({ ok: true, value: { browsers: [
    { browser: 'chrome', installed: true, state: 'disabled' },
    { browser: 'edge', installed: null, enabled: true, state: 'disconnected', error: 'Remote debugging is disabled by policy' },
  ] } })
  expect(await rpc('set-enabled', { browser: 'edge', enabled: false })).toMatchObject({ ok: true, value: { browsers: [
    { browser: 'chrome', installed: true },
    { browser: 'edge', installed: null, enabled: false, state: 'disabled', error: 'Remote debugging is disabled by policy' },
  ] } })
  expect(ctx.xiaojingNativeBrowserSettings.enabled('edge')).toBe(false)
  expect(revoke).toHaveBeenCalledExactlyOnceWith('edge')
  expect(await readFile(profile.patchPath, 'utf8')).not.toContain('edge: true')
})

it('persists enabled intent and reports required setup without launching a browser', async () => {
  const { ctx, inspect, rpc, profile } = await mounted()
  inspect.mockImplementation(async browser => ({ installed: true, setupReady: false, executablePath: fixture[browser] }))
  const response = await rpc('set-enabled', { browser: 'chrome', enabled: true })
  expect(response).toMatchObject({ ok: true, value: { browsers: [
    { browser: 'chrome', enabled: true, setupReady: false, state: 'setup-required' }, expect.anything(),
  ] } })
  expect(JSON.stringify(response)).not.toContain(profile.home)
  expect(ctx.xiaojingNativeBrowserSettings.enabled('chrome')).toBe(true)
  expect(await readFile(profile.patchPath, 'utf8')).toContain('chrome: true')
  expect(vi.mocked(spawn)).not.toHaveBeenCalled()
})

it('serializes overlapping permission edits for one browser and saves the last request', async () => {
  const { ctx, inspect, revoke, rpc } = await mounted()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  let held = false
  inspect.mockImplementation(async (browser) => {
    if (browser === 'edge' && !held) { held = true; entered.resolve(undefined); await release.promise }
    return { installed: true, setupReady: true, executablePath: fixture[browser] }
  })
  const opening = rpc('set-enabled', { browser: 'edge', enabled: true })
  await entered.promise
  const server: unknown = Reflect.get(ctx.webServer, 'server')
  if (!(server instanceof Server)) throw new Error('Settings fixture did not own an HTTP server')
  const received = new Promise<void>(resolve => server.once('request', (request: IncomingMessage) => {
    request.once('end', () => { resolve() })
  }))
  const closing = rpc('set-enabled', { browser: 'edge', enabled: false })
  await received
  await new Promise<void>(resolve => setImmediate(resolve))
  release.resolve(undefined)
  expect(await opening).toMatchObject({ ok: true })
  expect(await closing).toMatchObject({ ok: true })
  expect(ctx.xiaojingNativeBrowserSettings.enabled('edge')).toBe(false)
  expect(revoke).toHaveBeenCalledExactlyOnceWith('edge')
})

it('refuses the removed manager operation without inspecting installations or launching a browser', async () => {
  const { ctx, inspect, rpc, home } = await mounted()
  expect(await rpc('open-manager', { browser: 'chrome' })).toMatchObject({ ok: false, error: { message: 'Unknown browser settings operation' } })
  expect(ctx.xiaojingNativeBrowserSettings.enabled('chrome')).toBe(false)
  expect(inspect).not.toHaveBeenCalled()
  expect(vi.mocked(spawn)).not.toHaveBeenCalled()
  expect(await nativeEvents(home)).toEqual([])
})

it.each(['chrome', 'edge'] as const)('opens only the operator-selected %s settings page without enabling control or connecting to tabs', async (browser) => {
  const { ctx, inspect, revoke, rpc, profile, home } = await mounted()
  const before = await readFile(profile.patchPath, 'utf8')
  const open = vi.spyOn(SettingsOpening, 'openNativeBrowserSettings').mockResolvedValue(undefined)
  inspect.mockImplementation(async brand => ({ installed: true, setupReady: false, executablePath: fixture[brand] }))
  expect(await rpc('open-settings', { browser })).toMatchObject({ ok: true, value: { browsers: [
    { browser: 'chrome', enabled: false }, { browser: 'edge', enabled: false },
  ] } })
  expect(open).toHaveBeenCalledExactlyOnceWith(browser, fixture[browser], 30_000, expect.any(AbortSignal))
  expect(ctx.xiaojingNativeBrowserSettings.enabled(browser)).toBe(false)
  expect(await readFile(profile.patchPath, 'utf8')).toBe(before)
  expect(revoke).not.toHaveBeenCalled()
  expect(await nativeEvents(home)).toEqual([])
})

it('rejects overlapping settings launches rather than opening a second browser window', async () => {
  const { rpc } = await mounted()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const open = vi.spyOn(SettingsOpening, 'openNativeBrowserSettings').mockImplementation(async () => {
    entered.resolve(undefined); await release.promise
  })
  const first = rpc('open-settings', { browser: 'chrome' })
  await entered.promise
  expect(await rpc('open-settings', { browser: 'edge' })).toMatchObject({ ok: false, error: { message: 'A browser settings page is already opening' } })
  expect(open).toHaveBeenCalledTimes(1)
  release.resolve(undefined)
  expect(await first).toMatchObject({ ok: true })
})

it('does not acknowledge a failed settings navigation and permits a new explicit retry', async () => {
  const { rpc } = await mounted()
  const open = vi.spyOn(SettingsOpening, 'openNativeBrowserSettings')
    .mockRejectedValueOnce(new Error('Could not verify the new browser settings document'))
    .mockResolvedValue(undefined)
  expect(await rpc('open-settings', { browser: 'edge' })).toMatchObject({ ok: false, error: { message: 'Could not verify the new browser settings document' } })
  expect(await rpc('open-settings', { browser: 'edge' })).toMatchObject({ ok: true })
  expect(open).toHaveBeenCalledTimes(2)
})

it('cancels and joins a pending settings launch when the settings service is removed', async () => {
  const { ctx, rpc } = await mounted()
  const entered = Promise.withResolvers<undefined>(), settled = Promise.withResolvers<undefined>()
  vi.spyOn(SettingsOpening, 'openNativeBrowserSettings').mockImplementation(async (_browser, _path, _timeout, signal) => {
    entered.resolve(undefined)
    try {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(signal.reason instanceof Error ? signal.reason : new Error('Settings canceled')) }, { once: true })
      })
    } finally { settled.resolve(undefined) }
  })
  const request = rpc('open-settings', { browser: 'chrome' })
  await entered.promise
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'permissions')!
  await entry.fiber!.dispose()
  await settled.promise
  expect(await request).toMatchObject({ ok: false, error: { message: 'Native browser settings disposed' } })
})

it('does not open settings for an absent browser', async () => {
  const { inspect, rpc } = await mounted()
  const open = vi.spyOn(SettingsOpening, 'openNativeBrowserSettings').mockResolvedValue(undefined)
  inspect.mockResolvedValue({ installed: false, setupReady: false })
  expect(await rpc('open-settings', { browser: 'chrome' })).toMatchObject({ ok: false, error: { message: 'chrome is not installed' } })
  expect(open).not.toHaveBeenCalled()
})

it('bounds pending settings navigation with its configured deadline', async () => {
  const { rpc } = await mounted({ openSettingsTimeoutMs: 100 })
  const canceled = vi.fn()
  vi.spyOn(SettingsOpening, 'openNativeBrowserSettings').mockImplementation(async (_browser, _path, timeout, signal) => {
    expect(timeout).toBe(100)
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        canceled(); reject(signal.reason instanceof Error ? signal.reason : new Error('Settings timed out'))
      }, { once: true })
    })
  })
  const response = await rpc('open-settings', { browser: 'edge' })
  expect(response.ok).toBe(false)
  if (response.ok) throw new Error('Settings deadline unexpectedly succeeded')
  expect(response.error.message).toMatch(/timeout/iu)
  expect(canceled).toHaveBeenCalledOnce()
})

it.skipIf(process.platform !== 'win32' || process.env.XIAOJING_BROWSER_SETTINGS_LIVE !== '1').each(['chrome', 'edge'] as const)(
  'opens and verifies live %s settings through the authenticated operator RPC', async (browser) => {
    const { inspect, rpc, ctx, profile } = await mounted()
    const receipts: unknown[] = []
    const failures: { message: string; stdout?: string; stderr?: string }[] = []
    const realOpen = SettingsOpening.openNativeBrowserSettings
    inspect.mockImplementation(async (brand) => {
      const path = brand === 'chrome' ? await findWindowsChromeExecutable(new AbortController().signal) : await findWindowsEdgeExecutable()
      if (path === undefined) throw new Error(`Live ${brand} installation was not found`)
      return { installed: true, setupReady: false, executablePath: path }
    })
    vi.spyOn(SettingsOpening, 'openNativeBrowserSettings').mockImplementation((brand, path, timeout, signal) =>
      realOpen(brand, path, timeout, signal, 'win32', async (command, args, cancellation, visibility) => {
        const output = await runNativeCommand(command, args, cancellation, visibility).catch((error: unknown) => {
          failures.push({ message: error instanceof Error ? error.message : String(error),
            ...(typeof error === 'object' && error !== null && 'stdout' in error && typeof error.stdout === 'string' ? { stdout: error.stdout } : {}),
            ...(typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string' ? { stderr: error.stderr } : {}),
          })
          throw error
        })
        receipts.push(JSON.parse(output.stdout))
        return output
      }))
    const before = await readFile(profile.patchPath, 'utf8')
    const response = await rpc('open-settings', { browser })
    const evidence = process.env.XIAOJING_BROWSER_SETTINGS_EVIDENCE
    if (evidence !== undefined) {
      await mkdir(evidence, { recursive: true })
      await writeFile(join(evidence, `settings-live-${browser}.json`),
        JSON.stringify({ observedAt: new Date().toISOString(), response, receipts, failures }, null, 2) + '\n')
    }
    expect(response).toMatchObject({ ok: true, value: { canOpenSettings: true } })
    expect(receipts).toEqual([{ browser, url: `${browser}://inspect/#remote-debugging`,
      documentTitle: `Inspect with ${browser === 'chrome' ? 'Chrome' : 'Edge'} Developer Tools`, opened: true }])
    expect(ctx.xiaojingNativeBrowserSettings.enabled(browser)).toBe(false)
    expect(await readFile(profile.patchPath, 'utf8')).toBe(before)
  }, 60_000,
)

it('revokes a pending native connection when the settings service is removed', async () => {
  const { ctx, rpc, home } = await mounted()
  expect(await rpc('set-enabled', { browser: 'edge', enabled: true })).toMatchObject({ ok: true })
  fixture.mode = 'probe-hold'
  const owner = await ctx.agents.create({ sessionId: SessionId('settings-pending-owner') })
  const connect = ctx.tools.execute({ name: 'browser_connect', agent: owner.agent, arguments: { surface: 'existing' },
    callId: ToolCallId('settings-pending-connect'), signal: new AbortController().signal })
  await vi.waitFor(async () => { expect((await nativeEvents(home)).some(event => event.name === 'list_pages')).toBe(true) })
  const pids = (await nativeEvents(home)).filter(event => event.event === 'start').map(event => event.pid)
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'permissions')!
  await entry.fiber!.dispose()
  expect((await connect).isError).toBe(true)
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  expect(ctx.get('xiaojingNativeBrowserSettings')).toBeUndefined()
})

it('cancels and joins pending permission metadata inspection on settings disposal', async () => {
  const { ctx, inspect, rpc } = await mounted()
  const entered = Promise.withResolvers<undefined>()
  inspect.mockImplementation(async (_browser, signal) => {
    entered.resolve(undefined)
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('Metadata inspection canceled', { cause: signal.reason })) }, { once: true })
    })
    throw new Error('Canceled inspection unexpectedly completed')
  })
  const request = rpc('set-enabled', { browser: 'chrome', enabled: true })
  await entered.promise
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'permissions')!
  await entry.fiber!.dispose()
  expect(await request).toMatchObject({ ok: false })
  expect(vi.mocked(spawn)).not.toHaveBeenCalled()
})

it('reports canceled status inspection as a failed request rather than unknown installation metadata', async () => {
  const { ctx, inspect, rpc } = await mounted()
  const entered = Promise.withResolvers<undefined>()
  inspect.mockImplementation(async (_browser, signal) => {
    signal.throwIfAborted()
    entered.resolve(undefined)
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('Metadata inspection canceled', { cause: signal.reason })) }, { once: true })
    })
    throw new Error('Canceled inspection unexpectedly completed')
  })
  const request = rpc('status')
  await entered.promise
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'permissions')!
  await entry.fiber!.dispose()
  expect(await request).toMatchObject({ ok: false, error: { message: 'Native browser settings disposed' } })
})

it.each([['status', { browser: 'chrome' }], ['set-enabled', { browser: 'firefox', enabled: true }],
  ['set-enabled', { browser: 'edge', enabled: 'yes' }], ['set-enabled', { browser: 'edge', enabled: true, executablePath: 'private' }],
  ['open-manager', { browser: 'edge', enabled: true }], ['open-manager', []], ['unknown', {}],
  ['open-settings', { browser: 'chrome', url: 'https://example.com' }], ['open-settings', { browser: 'edge', executablePath: 'C:\\malicious.exe' }],
  ['open-settings', { browser: 'firefox' }], ['open-settings', []], ['open-settings', {}]] as const)
('refuses invalid %s payload %j without changing permissions or opening a browser', async (method, payload) => {
  const { ctx, revoke, rpc } = await mounted()
  expect(await rpc(method, payload)).toMatchObject({ ok: false })
  expect(ctx.xiaojingNativeBrowserSettings.enabled('edge')).toBe(false)
  expect(ctx.xiaojingNativeBrowserSettings.enabled('chrome')).toBe(false)
  expect(revoke).not.toHaveBeenCalled()
  expect(vi.mocked(spawn)).not.toHaveBeenCalled()
})
