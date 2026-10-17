import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import BrowserUse from '@deepseek-ai/dsh-browser-use'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Llm, { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Agents from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Projections from '@deepseek-ai/dsh-session-projection'
import Approval from '@deepseek-ai/dsh-user-approval'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { bindScopeParent } from '@deepseek-ai/dsh-scope'
import { afterEach, expect, it, vi } from 'vitest'
import * as Native from '../src/native.ts'
import * as ManagedEdge from '../src/native-edge-launch.ts'
import type { NativeBrowserSettingsRuntime } from '../src/native-settings-types.ts'

const fixture = vi.hoisted(() => ({ root: '', mode: '', executable: '', edgeExecutable: '', edgeProcess: '', chromePolicy: '',
  options: [] as Array<{ route: string; mode: string; args: string[] }>,
  profilePolicy: undefined as ((signal: AbortSignal) => Promise<string>) | undefined,
}))
vi.mock('@deepseek-ai/dsh-native-command', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-native-command')>()
  return { ...actual, runNativeCommand: vi.fn<import('@deepseek-ai/dsh-native-command').NativeCommandRunner>(async (command, args, signal, window) => {
    if (command !== 'powershell.exe' || args[0] !== '-NoProfile' || args[1] !== '-NonInteractive') {
      return actual.runNativeCommand(command, args, signal, window)
    }
    if (args[3]?.includes("GetValue('RemoteDebuggingAllowed'")) {
      return { stdout: fixture.profilePolicy === undefined
        ? '{"status":"ok","userDataDir":null,"remoteDebuggingAllowed":null}' : await fixture.profilePolicy(signal), stderr: '' }
    }
    if (args[3]?.includes("GetValue('UserDataDir'")) {
      return { stdout: JSON.stringify({ status: fixture.chromePolicy === '' ? 'absent' : 'present' }), stderr: '' }
    }
    return { stdout: '{"paths":[]}', stderr: '' }
  }) }
})
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn((command: string, args: readonly string[], options: import('node:child_process').SpawnOptions) => {
    if (command === fixture.edgeExecutable) return actual.spawn(process.execPath, [fixture.edgeProcess, 'ready', ...args], options)
    return actual.spawn(command, [...args], options)
  }) }
})
vi.mock('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp')>()
  return { ...actual, createSessionMcpOptions: vi.fn((config: import('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp').Config) => ({
    ...actual.createSessionMcpOptions(config), command: process.execPath,
    args: [fixture.executable, fixture.root, config.serverName, fixture.mode, 'playwright'],
  })) }
})
vi.mock('@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp')>()
  return { ...actual, createSessionMcpOptions: vi.fn((config: import('@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp').Config) => {
    const options = actual.createSessionMcpOptions(config)
    fixture.options.push({ route: config.serverName, mode: config.mode, args: options.args })
    return { ...options, command: process.execPath,
      args: [fixture.executable, fixture.root, config.serverName, fixture.mode, 'devtools'] }
  }) }
})

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  fixture.chromePolicy = ''
  fixture.options = []
  fixture.profilePolicy = undefined
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

interface FixtureEvent { event: string; pid: number; route: string; name?: string; hold?: boolean; cwd?: string }
async function events(root: string): Promise<FixtureEvent[]> {
  try { return (await readFile(join(root, 'events.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as FixtureEvent) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

function permissions(initial: Partial<Record<Native.NativeBrowser, boolean>> = {}) {
  const enabled = { edge: false, chrome: false, ...initial }
  let runtime: NativeBrowserSettingsRuntime | undefined
  const plugin = { name: 'native-permissions-fixture', apply(ctx: Context) {
    ctx.provide('xiaojingNativeBrowserSettings', {
      enabled: browser => enabled[browser],
      registerRuntime(value) {
        if (runtime !== undefined) throw new Error('Native runtime is already registered')
        runtime = value
        return () => { if (runtime === value) runtime = undefined }
      },
    })
  } }
  return { plugin,
    runtime() { if (runtime === undefined) throw new Error('Native runtime is not registered'); return runtime },
    deny(browser: Native.NativeBrowser) { enabled[browser] = false },
    async revoke(browser: Native.NativeBrowser) { enabled[browser] = false; await runtime?.revoke(browser) },
  }
}

async function load(mode = '', nativeConfig: Partial<Native.Config> = {}, permission?: ReturnType<typeof permissions>) {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-native-browser-'))
  roots.push(root)
  Object.assign(fixture, { root, mode, executable: fileURLToPath(new URL('./fixtures/native-browser.mjs', import.meta.url)) })
  fixture.edgeExecutable = join(root, 'fixture-edge.exe')
  fixture.edgeProcess = fileURLToPath(new URL('./fixtures/native-edge-process.mjs', import.meta.url))
  const modules = {
    include: Include, browserUse: BrowserUse, prompt: SystemPrompt, tools: Tools, llm: Llm,
    sessions: Sessions, agents: Agents, loop: AgentLoop, projections: Projections, approval: Approval,
    fs: LocalFileSystem, workingDirectory: WorkingDirectory,
    ...permission === undefined ? {} : { permissions: permission.plugin }, native: Native,
  }
  const path = join(root, 'cordis.yml')
  await writeFile(path, JSON.stringify(Object.keys(modules).filter(key => key !== 'include').map(key => ({
    id: key, name: `cordis:${key}`,
    config: key === 'loop' ? { agents: [] } : key === 'workingDirectory' ? { defaultDirectory: root } : key === 'native'
      ? { allowPrivateHosts: true, ...nativeConfig, edge: { executablePath: fixture.edgeExecutable, ...nativeConfig.edge } } : {},
  }))))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, modules)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  const fiber = [...ctx.loader.entries()].find(entry => entry.options.id === 'native')!.fiber!
  const permissionsFiber = [...ctx.loader.entries()].find(entry => entry.options.id === 'permissions')?.fiber
  return { root, ctx, fiber, permissionsFiber }
}

function execute(ctx: Context, agent: Agent, name: string, args: object = {}, signal = new AbortController().signal) {
  return ctx.tools.execute({
    agent, name, arguments: { ...name.endsWith('__take_snapshot') ? { pageId: 1 } : {}, ...args },
    callId: ToolCallId(`test-${name}`), signal,
  })
}
function nativeTool(browser: Native.NativeBrowser, surface: Native.NativeBrowserSurface) {
  return `mcp__xiaojing-${browser}-${surface}__${surface === 'managed' ? 'take_snapshot' : 'browser_snapshot'}`
}

it('keeps ordinary Sessions browser-free and connects default Edge with real native tool discovery', async () => {
  const { root, ctx, fiber } = await load()
  const first = await ctx.agents.create({ sessionId: SessionId('ordinary') })
  expect(await events(root)).toEqual([])
  expect(ctx.tools.schemas(first.agent).map(tool => tool.name)).toEqual(['browser_connect'])
  const connected = await execute(ctx, first.agent, 'browser_connect')
  expect(connected.isError).toBe(false)
  expect(connected.value).toMatchObject({ browser: 'edge', surface: 'managed', toolPrefix: 'mcp__xiaojing-edge-managed__' })
  expect((await events(root)).filter(event => event.event === 'call')).toMatchObject([{ route: 'xiaojing-edge-managed', name: 'list_pages' }])
  const read = await execute(ctx, first.agent, nativeTool('edge', 'managed'))
  expect(read.content).toEqual([{ type: 'text', text: 'Snapshot xiaojing-edge-managed' }])
  const child = await ctx.agents.create({ sessionId: SessionId('child'), parentAgent: first.agent, setup: (_inner, agent) => { bindScopeParent(agent, first.agent) } })
  expect((await execute(ctx, child.agent, nativeTool('edge', 'managed'))).isError).toBe(true)
  const pids = (await events(root)).filter(event => event.event === 'start').map(event => event.pid)
  await fiber.dispose()
  expect(ctx.tools.schemas(first.agent)).toEqual([])
  expect(ctx.browserUse.providerName).toBeUndefined()
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
})

it.each(['managedBrowserTimeoutMs', 'connectTimeoutMs', 'toolCallTimeoutMs'])('rejects fractional %s when configuration is loaded', (field) => {
  expect(() => Native.Config({ [field]: 1.5 })).toThrow()
})

it('starts each native browser connection in the current working directory and retains it until reconnecting', async () => {
  const { root, ctx } = await load()
  const firstDirectory = join(root, 'first-directory')
  const secondDirectory = join(root, 'second-directory')
  await mkdir(firstDirectory)
  await mkdir(secondDirectory)
  const owner = await ctx.agents.create({ sessionId: SessionId('current-browser-directory'), meta: { cwd: root } })
  const first = await ctx.workingDirectory.set(owner.agent, firstDirectory)
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  const started = (await events(root)).filter(event => event.event === 'start')
  expect(started.length).toBeGreaterThan(0)
  expect(started.every(event => event.cwd === first)).toBe(true)
  const second = await ctx.workingDirectory.set(owner.agent, secondDirectory)
  expect((await execute(ctx, owner.agent, nativeTool('edge', 'managed'))).isError).toBe(false)
  expect((await events(root)).filter(event => event.event === 'start')).toEqual(started)
  expect((await execute(ctx, owner.agent, 'browser_connect', { browser: 'chrome' })).isError).toBe(false)
  const chrome = (await events(root)).filter(event => event.event === 'start' && event.route === 'xiaojing-chrome-managed')
  expect(chrome.length).toBeGreaterThan(0)
  expect(chrome.every(event => event.cwd === second)).toBe(true)
  expect(owner.agent.session.header.cwd).toBe(root)
})

it.each([false, true])('retains failed owned cleanup after Cordis effect disposal swallows its error (startup failure=%s)', async (startupFailure) => {
  let closing: Promise<void> | undefined
  const close = () => closing ??= Promise.reject(new Error('Owned Edge cleanup failed'))
  const launch = vi.spyOn(ManagedEdge, 'launchManagedEdge').mockImplementation(async () => ({
    profileDir: 'fixture-owned-profile', close,
    endpoint: startupFailure ? Promise.reject(new Error('Owned Edge startup failed')) : Promise.resolve('ws://127.0.0.1:43210/devtools/browser/fixture'),
  }))
  const { ctx } = await load('probe-failure')
  const owner = await ctx.agents.create({ sessionId: SessionId('retained-owned-edge') })
  const first = await execute(ctx, owner.agent, 'browser_connect')
  expect(first.isError).toBe(true)
  expect(JSON.stringify(first.content)).toContain('Owned Edge cleanup failed')
  const retry = await execute(ctx, owner.agent, 'browser_connect')
  expect(retry.isError).toBe(true)
  expect(JSON.stringify(retry.content)).toContain('Owned Edge cleanup failed')
  expect(launch).toHaveBeenCalledOnce()
})

it('allows an existing-browser approval probe beyond the ordinary operation deadline while later calls keep that deadline', async () => {
  const { root, ctx } = await load('probe-hold', { toolCallTimeoutMs: 50, connectTimeoutMs: 3_000 })
  const owner = await ctx.agents.create({ sessionId: SessionId('connection-approval-budget') })
  let settled = false
  const connect = execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' }).then((result) => { settled = true; return result })
  await vi.waitFor(async () => { expect((await events(root)).some(event => event.name === 'browser_tabs')).toBe(true) })
  await new Promise(resolve => setTimeout(resolve, 150))
  expect(settled).toBe(false)
  await writeFile(join(root, 'browser-ready'), '')
  expect((await connect).isError).toBe(false)
  expect((await execute(ctx, owner.agent, nativeTool('edge', 'existing'), { hold: true })).isError).toBe(true)
})

it('reconnects a confirmed dead MCP transport on one explicit connect without replaying the failed operation', async () => {
  const { root, ctx } = await load('backend-death', { edge: { existingEndpoint: 'http://127.0.0.1:9222' } })
  const owner = await ctx.agents.create({ sessionId: SessionId('native-transport-death') })
  const connectArgs = { surface: 'existing' }
  expect((await execute(ctx, owner.agent, 'browser_connect', connectArgs)).isError).toBe(false)
  const failed = await execute(ctx, owner.agent, 'mcp__xiaojing-edge-existing__take_snapshot')
  expect(failed.isError).toBe(true)
  const before = (await events(root)).filter(event => event.event === 'call')
  expect(before.filter(event => event.name === 'take_snapshot')).toHaveLength(1)
  expect((await execute(ctx, owner.agent, 'browser_connect', connectArgs)).isError).toBe(false)
  const after = (await events(root)).filter(event => event.event === 'call')
  expect(after.filter(event => event.name === 'take_snapshot')).toHaveLength(1)
  expect(after.filter(event => event.name === 'list_pages')).toHaveLength(2)
})

it('reconnects once when the native MCP process exits before the next operation', async () => {
  const { root, ctx } = await load('', { edge: { existingEndpoint: 'http://127.0.0.1:9222' } })
  const owner = await ctx.agents.create({ sessionId: SessionId('already-detached-native-transport') })
  expect((await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(false)
  const active = (await events(root)).findLast(event => event.event === 'start')
  if (active === undefined) throw new Error('Native fixture did not start')
  process.kill(active.pid)
  await vi.waitFor(() => {
    expect(ctx.logger.buffer.some(message => message.args.some((arg: unknown) => typeof arg === 'string'
      && arg.includes('mcp-client(xiaojing-edge-existing): connection lost and reconnect is disabled')))).toBe(true)
  })
  const failed = await execute(ctx, owner.agent, 'mcp__xiaojing-edge-existing__take_snapshot')
  expect(failed).toMatchObject({ isError: true, error: { info: { name: 'McpTransportError', code: 'NOT_CONNECTED' } } })
  expect((await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(false)
  const calls = (await events(root)).filter(event => event.event === 'call')
  expect(calls.filter(event => event.name === 'take_snapshot')).toHaveLength(0)
  expect(calls.filter(event => event.name === 'list_pages')).toHaveLength(2)
})

it('records a confirmed native transport loss in the actual loop Session result', async () => {
  const { ctx } = await load('backend-death', { edge: { existingEndpoint: 'http://127.0.0.1:9222' } })
  class FixtureAdapter extends LlmAdapter {
    private called = false
    async * stream(): AsyncIterable<StreamChunk> {
      if (!this.called) {
        this.called = true
        const id = ToolCallId('recorded-native-read')
        const name = 'mcp__xiaojing-edge-existing__take_snapshot'
        const args = '{"pageId":1}'
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Browser connection interrupted.' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Browser connection interrupted.' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  ctx.llm.registerAdapter(['native-fixture'], new FixtureAdapter())
  const owner = await ctx.agents.create({
    sessionId: SessionId('recorded-native-transport'), agentOptions: { provider: 'native-fixture', model: 'fixture' },
  })
  expect((await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(false)
  owner.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Read the selected browser page.' }], source: { kind: 'user' } }))
  await owner.agent.whenIdle()
  const results = owner.agent.session.snapshotEvents().flatMap(event => event.type === 'tool/result'
    ? [{ type: event.type, error: event.data.error, content: event.data.message.content, isError: event.data.message.isError }] : [])
  expect(results).toMatchInlineSnapshot(`
    [
      {
        "content": [
          {
            "text": "Error: Connection closed",
            "type": "text",
          },
        ],
        "error": {
          "code": "CONNECTION_CLOSED",
          "name": "McpTransportError",
        },
        "isError": true,
        "type": "tool/result",
      },
    ]
  `)
})

it('rebuilds only the cached readonly probe once when its transport dies during explicit connect', async () => {
  const { root, ctx } = await load('probe-backend-death', { edge: { existingEndpoint: 'http://127.0.0.1:9222' } })
  const owner = await ctx.agents.create({ sessionId: SessionId('native-probe-death') })
  expect((await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(false)
  expect((await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(false)
  const probes = (await events(root)).filter(event => event.event === 'call' && event.name === 'list_pages')
  expect(probes).toHaveLength(3)
  expect(probes[0]?.pid).toBe(probes[1]?.pid)
  expect(probes[2]?.pid).not.toBe(probes[1]?.pid)
})

it('does not retry a cached probe refused by a monotonic guard', async () => {
  const { root, ctx } = await load()
  const owner = await ctx.agents.create({ sessionId: SessionId('native-probe-guard-denied') })
  expect((await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(false)
  const before = (await events(root)).filter(event => event.event === 'start').length
  ctx.tools.guard(exec => exec.name.endsWith('__browser_tabs') ? 'Fixture approval denied' : undefined)
  const refused = await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })
  expect(refused.isError).toBe(true)
  expect(JSON.stringify(refused.content)).toContain('Fixture approval denied')
  expect((await events(root)).filter(event => event.event === 'start')).toHaveLength(before)
})

it.each(['probe-hold', 'probe-failure'])('does not rebuild a cached connection for %s', async (mode) => {
  const { root, ctx } = await load(mode, { connectTimeoutMs: 500 })
  const owner = await ctx.agents.create({ sessionId: SessionId(`native-${mode}-no-retry`) })
  await writeFile(join(root, 'browser-ready'), '')
  expect((await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(false)
  const before = (await events(root)).filter(event => event.event === 'start').length
  await rm(join(root, 'browser-ready'))
  expect((await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(true)
  expect((await events(root)).filter(event => event.event === 'start')).toHaveLength(before)
})

it('selects Chrome explicitly and rejects stale route tools through the executor', async () => {
  const { root, ctx } = await load()
  const owner = await ctx.agents.create({ sessionId: SessionId('switch') })
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  const chrome = await execute(ctx, owner.agent, 'browser_connect', { browser: 'chrome' })
  expect(chrome.value).toMatchObject({ browser: 'chrome', surface: 'managed' })
  const before = (await events(root)).filter(event => event.event === 'call').length
  expect((await execute(ctx, owner.agent, nativeTool('edge', 'managed'))).isError).toBe(true)
  expect((await events(root)).filter(event => event.event === 'call')).toHaveLength(before)
  expect((await execute(ctx, owner.agent, nativeTool('chrome', 'managed'))).isError).toBe(false)
  const assembly = await ctx.systemPrompt.assemble({ agent: owner.agent, scope: owner.agent, signal: new AbortController().signal })
  expect(assembly.sections.some(section => section.name === 'mcp:xiaojing-edge-managed')).toBe(false)
  expect(assembly.sections.some(section => section.name === 'mcp:xiaojing-chrome-managed')).toBe(true)
  expect(assembly.tools.some(tool => tool.name.startsWith('mcp__xiaojing-edge-managed__'))).toBe(false)
  expect(assembly.tools.some(tool => tool.name.startsWith('mcp__xiaojing-chrome-managed__'))).toBe(true)
})

it('holds existing-browser ownership until release and never switches browsers implicitly', async () => {
  const { root, ctx } = await load()
  const first = await ctx.agents.create({ sessionId: SessionId('first') })
  const second = await ctx.agents.create({ sessionId: SessionId('second') })
  expect((await execute(ctx, first.agent, 'browser_connect', { browser: 'chrome', surface: 'existing' })).isError).toBe(false)
  const busy = await execute(ctx, second.agent, 'browser_connect', { browser: 'chrome', surface: 'existing' })
  expect(busy.isError).toBe(true)
  expect(JSON.stringify(busy.content)).toContain('No replacement browser was opened')
  expect((await events(root)).filter(event => event.event === 'start')).toHaveLength(2)
  await first.dispose()
  expect((await execute(ctx, second.agent, 'browser_connect', { browser: 'chrome', surface: 'existing' })).isError).toBe(false)
})

it('refuses managed Chrome before MCP startup when a Windows profile policy exists and preserves the existing route', async () => {
  if (process.platform !== 'win32') return
  const { root, ctx } = await load()
  fixture.chromePolicy = 'D:\\PrivateChromeProfile'
  const owner = await ctx.agents.create({ sessionId: SessionId('chrome-policy') })
  const refused = await execute(ctx, owner.agent, 'browser_connect', { browser: 'chrome' })
  expect(refused.isError).toBe(true)
  expect(JSON.stringify(refused.content)).toContain('UserDataDir policy overrides isolated profiles')
  expect(JSON.stringify(refused.content)).not.toContain(fixture.chromePolicy)
  expect(await events(root)).toEqual([])
  expect((await execute(ctx, owner.agent, 'browser_connect', { browser: 'chrome', surface: 'existing' })).isError).toBe(false)
  expect((await events(root)).every(event => event.route === 'xiaojing-chrome-existing')).toBe(true)
})

it('uses the configured CDP connection through native DevTools without launching an extension route', async () => {
  const { root, ctx } = await load('', { edge: { existingEndpoint: 'http://127.0.0.1:9222' } })
  const owner = await ctx.agents.create({ sessionId: SessionId('cdp') })
  const connected = await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })
  expect(connected.isError).toBe(false)
  expect(connected.value).toMatchObject({ browser: 'edge', surface: 'existing', tabs: 'Existing tab for xiaojing-edge-existing' })
  const calls = (await events(root)).filter(event => event.event === 'call')
  expect(calls).toMatchObject([{ name: 'list_pages', route: 'xiaojing-edge-existing' }])
  expect(ctx.tools.schemas(owner.agent).some(tool => tool.name.endsWith('__browser_tabs'))).toBe(false)
  expect((await execute(ctx, owner.agent, 'mcp__xiaojing-edge-existing__take_snapshot', { pageId: 1 })).isError).toBe(false)
})

it('uses the original auto-connect DevTools arguments for enabled existing Edge without a replacement browser', async () => {
  const permission = permissions({ edge: true })
  const userDataDir = join(tmpdir(), 'native-fixture-profile-input')
  const launch = vi.spyOn(ManagedEdge, 'launchManagedEdge')
  const { root, ctx } = await load('', { requireUserSettings: true,
    edge: { existingConnection: 'auto-connect', userDataDir },
  }, permission)
  const owner = await ctx.agents.create({ sessionId: SessionId('native-auto-connect') })
  const connected = await execute(ctx, owner.agent, 'browser_connect')
  expect(connected.value).toMatchObject({ browser: 'edge', surface: 'existing' })
  expect(permission.runtime().state('edge')).toBe('connected')
  const option = fixture.options.findLast(value => value.route === 'xiaojing-edge-existing')
  expect(option).toMatchObject({ mode: 'auto-connect' })
  expect(option?.args.slice(1)).toEqual(['--no-usage-statistics', '--autoConnect', '--user-data-dir', userDataDir])
  expect(option?.args[0]).toMatch(/chrome-devtools-mcp(?:\.js)?$/u)
  expect((await events(root)).filter(event => event.event === 'call')).toMatchObject([{ route: 'xiaojing-edge-existing', name: 'list_pages' }])
  expect(ctx.tools.schemas(owner.agent).some(tool => tool.name.endsWith('__browser_tabs'))).toBe(false)
  expect(launch).not.toHaveBeenCalled()
  expect((await execute(ctx, owner.agent, 'mcp__xiaojing-edge-existing__take_snapshot')).isError).toBe(false)
})

it('uses enabled Chrome existing tabs only when Chrome is requested and keeps Edge as the default brand', async () => {
  const permission = permissions({ chrome: true })
  const { ctx } = await load('', { requireUserSettings: true,
    chrome: { existingConnection: 'auto-connect', userDataDir: join(tmpdir(), 'native-chrome-profile-input') },
  }, permission)
  const owner = await ctx.agents.create({ sessionId: SessionId('enabled-chrome-brand') })
  expect((await execute(ctx, owner.agent, 'browser_connect')).value).toMatchObject({ browser: 'edge', surface: 'managed' })
  expect((await execute(ctx, owner.agent, 'browser_connect', { browser: 'chrome' })).value).toMatchObject({ browser: 'chrome', surface: 'existing' })
  expect(permission.runtime().state('chrome')).toBe('connected')
})

it('denies disabled existing access before acquiring a browser and rechecks permission on direct native calls', async () => {
  const permission = permissions({ edge: true })
  const { root, ctx } = await load('', { requireUserSettings: true,
    edge: { existingEndpoint: 'http://127.0.0.1:9222' },
  }, permission)
  const owner = await ctx.agents.create({ sessionId: SessionId('disabled-native-access') })
  const refused = await execute(ctx, owner.agent, 'browser_connect', { browser: 'chrome', surface: 'existing' })
  expect(refused.isError).toBe(true)
  expect(JSON.stringify(refused.content)).toContain('disabled')
  expect(await events(root)).toEqual([])
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  const before = (await events(root)).filter(event => event.event === 'call').length
  permission.deny('edge')
  expect((await execute(ctx, owner.agent, 'mcp__xiaojing-edge-existing__take_snapshot')).isError).toBe(true)
  expect((await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(true)
  expect((await events(root)).filter(event => event.event === 'call')).toHaveLength(before)
})

it('requires the product settings service for explicit existing access when configured to require it', async () => {
  const { root, ctx } = await load('', { requireUserSettings: true })
  const owner = await ctx.agents.create({ sessionId: SessionId('native-settings-required') })
  const refused = await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })
  expect(refused.isError).toBe(true)
  expect(JSON.stringify(refused.content)).toContain('requires the browser settings service')
  expect(await events(root)).toEqual([])
})

it('revokes a pending existing approval probe and waits for its MCP process to exit', async () => {
  const permission = permissions({ edge: true })
  const launch = vi.spyOn(ManagedEdge, 'launchManagedEdge')
  const { root, ctx } = await load('probe-hold', { requireUserSettings: true,
    edge: { existingEndpoint: 'http://127.0.0.1:9222' },
  }, permission)
  const owner = await ctx.agents.create({ sessionId: SessionId('revoke-native-probe') })
  const pending = execute(ctx, owner.agent, 'browser_connect')
  await vi.waitFor(async () => { expect((await events(root)).some(event => event.name === 'list_pages')).toBe(true) })
  expect(permission.runtime().state('edge')).toBe('connecting')
  const pids = (await events(root)).filter(event => event.event === 'start').map(event => event.pid)
  await permission.revoke('edge')
  expect((await pending).isError).toBe(true)
  expect(permission.runtime().state('edge')).toBeUndefined()
  expect(ctx.tools.schemas(owner.agent).map(tool => tool.name)).toEqual(['browser_connect'])
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  expect(launch).not.toHaveBeenCalled()
  expect((await events(root)).some(event => event.event === 'settled' && event.name === 'list_pages')).toBe(false)
})

it('revokes active and queued existing calls without launching or closing a managed replacement', async () => {
  const permission = permissions({ edge: true })
  const launch = vi.spyOn(ManagedEdge, 'launchManagedEdge')
  const { root, ctx } = await load('', { requireUserSettings: true,
    edge: { existingEndpoint: 'http://127.0.0.1:9222' },
  }, permission)
  const owner = await ctx.agents.create({ sessionId: SessionId('revoke-native-calls') })
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  const name = 'mcp__xiaojing-edge-existing__take_snapshot'
  const active = execute(ctx, owner.agent, name, { hold: true })
  await vi.waitFor(async () => { expect((await events(root)).some(event => event.hold)).toBe(true) })
  const queuedEntered = Promise.withResolvers<undefined>()
  ctx.on('tools/execute', (exec, next) => {
    const result = next()
    if (exec.name === name && !(exec.arguments as { hold?: boolean }).hold) queuedEntered.resolve(undefined)
    return result
  }, { prepend: true })
  const queued = execute(ctx, owner.agent, name)
  await queuedEntered.promise
  const pids = (await events(root)).filter(event => event.event === 'start').map(event => event.pid)
  await permission.revoke('edge')
  expect((await active).isError).toBe(true)
  expect((await queued).isError).toBe(true)
  expect((await events(root)).filter(event => event.event === 'call' && event.name === 'take_snapshot')).toHaveLength(1)
  expect(ctx.tools.schemas(owner.agent).map(tool => tool.name)).toEqual(['browser_connect'])
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  expect(launch).not.toHaveBeenCalled()
})

it('releases existing native connections when settings unload and refuses access without the required service', async () => {
  const permission = permissions({ edge: true })
  const { root, ctx, permissionsFiber } = await load('', { requireUserSettings: true,
    edge: { existingEndpoint: 'http://127.0.0.1:9222' },
  }, permission)
  const owner = await ctx.agents.create({ sessionId: SessionId('unload-native-settings') })
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  const pids = (await events(root)).filter(event => event.event === 'start').map(event => event.pid)
  expect(permissionsFiber).toBeDefined()
  await permissionsFiber!.dispose()
  expect(ctx.get('xiaojingNativeBrowserSettings')).toBeUndefined()
  expect((await execute(ctx, owner.agent, 'mcp__xiaojing-edge-existing__take_snapshot')).isError).toBe(true)
  const refused = await execute(ctx, owner.agent, 'browser_connect', { surface: 'existing' })
  expect(refused.isError).toBe(true)
  expect(JSON.stringify(refused.content)).toContain('requires the browser settings service')
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
})

it('releases the previous existing route when switching brands so another live Session can acquire it', async () => {
  const permission = permissions({ edge: true, chrome: true })
  const { root, ctx } = await load('', { requireUserSettings: true,
    edge: { existingEndpoint: 'http://127.0.0.1:9222' }, chrome: { existingEndpoint: 'http://127.0.0.1:9223' },
  }, permission)
  const first = await ctx.agents.create({ sessionId: SessionId('existing-route-switch') })
  expect((await execute(ctx, first.agent, 'browser_connect')).isError).toBe(false)
  const prior = (await events(root)).find(event => event.event === 'start' && event.route === 'xiaojing-edge-existing')
  expect(prior).toBeDefined()
  expect((await execute(ctx, first.agent, 'browser_connect', { browser: 'chrome' })).isError).toBe(false)
  expect(() => process.kill(prior!.pid, 0)).toThrow()
  expect((await execute(ctx, first.agent, 'mcp__xiaojing-edge-existing__take_snapshot')).isError).toBe(true)
  const second = await ctx.agents.create({ sessionId: SessionId('new-existing-owner') })
  expect((await execute(ctx, second.agent, 'browser_connect')).isError).toBe(false)
  expect((await execute(ctx, first.agent, 'mcp__xiaojing-chrome-existing__take_snapshot')).isError).toBe(false)
})

it('cancels a held previous existing operation before connecting the requested new browser', async () => {
  const permission = permissions({ edge: true, chrome: true })
  const { root, ctx } = await load('', { requireUserSettings: true,
    edge: { existingEndpoint: 'http://127.0.0.1:9222' }, chrome: { existingEndpoint: 'http://127.0.0.1:9223' },
  }, permission)
  const owner = await ctx.agents.create({ sessionId: SessionId('active-existing-switch') })
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  const active = execute(ctx, owner.agent, 'mcp__xiaojing-edge-existing__take_snapshot', { hold: true })
  await vi.waitFor(async () => { expect((await events(root)).some(event => event.hold)).toBe(true) })
  expect((await execute(ctx, owner.agent, 'browser_connect', { browser: 'chrome' })).isError).toBe(false)
  expect((await active).isError).toBe(true)
  const edgeReads = (await events(root)).filter(event => event.event === 'call' && event.route === 'xiaojing-edge-existing' && event.name === 'take_snapshot')
  expect(edgeReads).toHaveLength(1)
  expect((await execute(ctx, owner.agent, 'mcp__xiaojing-chrome-existing__take_snapshot')).isError).toBe(false)
})

it.skipIf(process.platform !== 'win32')('keeps a second Windows policy inspection independent of a canceled first operator', async () => {
  const permission = permissions({ edge: true })
  const userDataDir = await mkdtemp(join(tmpdir(), 'xiaojing-native-metadata-'))
  roots.push(userDataDir)
  const { root } = await load('', { edge: {
    existingConnection: 'auto-connect', userDataDir,
  } }, permission)
  const entered = Promise.withResolvers<undefined>()
  let queries = 0
  fixture.profilePolicy = async (signal) => {
    if (++queries === 1) {
      entered.resolve(undefined)
      await new Promise<void>((_resolve, reject) => {
        const aborted = () => { reject(signal.reason instanceof Error ? signal.reason : new Error('Metadata inspection aborted', { cause: signal.reason })) }
        signal.addEventListener('abort', aborted, { once: true })
        if (signal.aborted) aborted()
      })
    }
    return '{"status":"ok","userDataDir":null,"remoteDebuggingAllowed":null}'
  }
  const controller = new AbortController()
  const first = permission.runtime().inspect('edge', controller.signal).then(() => ({ passed: true }), () => ({ passed: false }))
  try {
    await entered.promise
    const second = permission.runtime().inspect('edge', new AbortController().signal)
    controller.abort(new Error('Operator canceled inspection'))
    expect((await first).passed).toBe(false)
    expect(await second).toMatchObject({ installed: true, setupReady: false })
    expect(queries).toBe(2)
    expect(await events(root)).toEqual([])
  } finally { controller.abort(); await first }
})

it.skipIf(process.platform !== 'win32')('checks current Windows debugging policy at connection time after installation metadata was cached', async () => {
  const permission = permissions({ edge: true })
  const userDataDir = await mkdtemp(join(tmpdir(), 'xiaojing-native-policy-'))
  roots.push(userDataDir)
  const { root, ctx } = await load('', { requireUserSettings: true, edge: {
    existingConnection: 'auto-connect', userDataDir,
  } }, permission)
  let allowed = true
  let queries = 0
  fixture.profilePolicy = async () => {
    queries++
    return JSON.stringify({ status: 'ok', userDataDir: null, remoteDebuggingAllowed: allowed })
  }
  expect(await permission.runtime().inspect('edge', new AbortController().signal)).toMatchObject({ installed: true })
  expect(queries).toBe(1)
  allowed = false
  const owner = await ctx.agents.create({ sessionId: SessionId('fresh-existing-policy') })
  const refused = await execute(ctx, owner.agent, 'browser_connect')
  expect(refused.isError).toBe(true)
  expect(JSON.stringify(refused.content)).toContain('RemoteDebuggingAllowed')
  expect(queries).toBe(2)
  expect(await events(root)).toEqual([])
})

it('rolls back a failed existing-browser probe so another Session can connect later', async () => {
  const { root, ctx } = await load('probe-failure')
  const first = await ctx.agents.create({ sessionId: SessionId('failed') })
  const failed = await execute(ctx, first.agent, 'browser_connect', { surface: 'existing' })
  expect(failed.isError).toBe(true)
  expect(JSON.stringify(failed.content)).toContain('Official browser extension is not installed')
  expect(ctx.tools.schemas(first.agent).map(tool => tool.name)).toEqual(['browser_connect'])
  const pids = (await events(root)).filter(event => event.event === 'start').map(event => event.pid)
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  await writeFile(join(root, 'browser-ready'), '')
  const second = await ctx.agents.create({ sessionId: SessionId('retry') })
  expect((await execute(ctx, second.agent, 'browser_connect', { surface: 'existing' })).isError).toBe(false)
  expect((await events(root)).every(event => event.route === 'xiaojing-edge-existing')).toBe(true)
})

it.each(['edge', 'chrome'] as const)('reports the selected %s brand and an unconfirmed native 403 without replacing the browser', async (browser) => {
  const { root, ctx } = await load('probe-native-403', {
    [browser]: { executablePath: process.execPath, existingConnection: 'auto-connect', userDataDir: tmpdir() },
  })
  const owner = await ctx.agents.create({ sessionId: SessionId(`native-403-${browser}`) })
  const refused = await execute(ctx, owner.agent, 'browser_connect', { browser, surface: 'existing' })
  expect(refused.isError).toBe(true)
  const detail = refused.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  expect(detail).toContain(`Could not connect to existing ${browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} tabs.`)
  expect(detail).toContain('native debugging endpoint rejected the connection (HTTP 403); its reason is unconfirmed')
  expect(detail).toContain(`${browser}://inspect/#remote-debugging`)
  expect(detail).toContain('No replacement browser was opened.')
  if (browser === 'edge') {
    expect(detail).not.toContain('Chrome')
    expect(detail).not.toContain('chrome://inspect/')
  }
  expect(detail).not.toContain('official browser extension')
  expect(ctx.tools.schemas(owner.agent).map(tool => tool.name)).toEqual(['browser_connect'])
  expect((await events(root)).filter(event => event.event === 'call')).toMatchObject([
    { route: `xiaojing-${browser}-existing`, name: 'list_pages' },
  ])
  const started = (await events(root)).filter(event => event.event === 'start')
  expect(new Set(started.map(event => event.route))).toEqual(new Set([`xiaojing-${browser}-existing`]))
  for (const { pid } of started) expect(() => process.kill(pid, 0)).toThrow()
  expect(fixture.options.filter(options => options.mode === 'auto-connect')).toMatchObject([
    { route: `xiaojing-${browser}-existing`, mode: 'auto-connect' },
  ])
})

it('requires an explicit reconnect after Chrome fails instead of retaining an implicit Edge fallback', async () => {
  const { root, ctx } = await load('chrome-probe-failure')
  const owner = await ctx.agents.create({ sessionId: SessionId('no-fallback') })
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  expect((await execute(ctx, owner.agent, 'browser_connect', { browser: 'chrome' })).isError).toBe(true)
  const before = (await events(root)).filter(event => event.event === 'call').length
  expect((await execute(ctx, owner.agent, nativeTool('edge', 'managed'))).isError).toBe(true)
  expect((await events(root)).filter(event => event.event === 'call')).toHaveLength(before)
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  expect((await execute(ctx, owner.agent, nativeTool('edge', 'managed'))).isError).toBe(false)
})

it('serializes native calls and awaits child exit when disposed during an active call', async () => {
  const { root, ctx, fiber } = await load()
  const owner = await ctx.agents.create({ sessionId: SessionId('queue') })
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  const first = execute(ctx, owner.agent, nativeTool('edge', 'managed'), { hold: true })
  await vi.waitFor(async () => { expect((await events(root)).some(event => event.hold)).toBe(true) })
  const queuedEntered = Promise.withResolvers<undefined>()
  ctx.on('tools/execute', (exec, next) => {
    const result = next()
    if (exec.name === nativeTool('edge', 'managed') && !(exec.arguments as { hold?: boolean }).hold) queuedEntered.resolve(undefined)
    return result
  }, { prepend: true })
  const second = execute(ctx, owner.agent, nativeTool('edge', 'managed'))
  await queuedEntered.promise
  expect((await events(root)).filter(event => event.name === 'take_snapshot' && event.event === 'call')).toHaveLength(1)
  const pids = (await events(root)).filter(event => event.event === 'start').map(event => event.pid)
  await fiber.dispose()
  await Promise.all([first, second])
  expect((await events(root)).filter(event => event.name === 'take_snapshot' && event.event === 'call')).toHaveLength(1)
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
})

it('rejects an already queued Edge call when the Session switches to Chrome', async () => {
  const { root, ctx } = await load()
  const owner = await ctx.agents.create({ sessionId: SessionId('queued-switch') })
  expect((await execute(ctx, owner.agent, 'browser_connect')).isError).toBe(false)
  const first = execute(ctx, owner.agent, nativeTool('edge', 'managed'), { hold: true })
  await vi.waitFor(async () => { expect((await events(root)).some(event => event.hold)).toBe(true) })
  const queuedEntered = Promise.withResolvers<undefined>()
  ctx.on('tools/execute', (exec, next) => {
    const result = next()
    if (exec.name === nativeTool('edge', 'managed') && !(exec.arguments as { hold?: boolean }).hold) queuedEntered.resolve(undefined)
    return result
  }, { prepend: true })
  const queued = execute(ctx, owner.agent, nativeTool('edge', 'managed'))
  await queuedEntered.promise
  expect((await execute(ctx, owner.agent, 'browser_connect', { browser: 'chrome' })).isError).toBe(false)
  await writeFile(join(root, 'release-operation'), '')
  expect((await first).isError).toBe(false)
  expect((await queued).isError).toBe(true)
  const edgeReads = (await events(root)).filter(event => event.route === 'xiaojing-edge-managed' && event.name === 'take_snapshot' && event.event === 'call')
  expect(edgeReads).toHaveLength(1)
})
