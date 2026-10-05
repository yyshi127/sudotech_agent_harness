/** Recorded native browser routing through the shipped Web composition and agent loop. */
import { existsSync } from 'node:fs'
import { once } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { chromium } from 'playwright'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
// Keep scaffold services and persisted message sources explicit in a standalone Host check.
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-tool-skill'
import type {} from '@deepseek-ai/dsh-xiaojing-browser-control/native-settings-types'
import {
  fixtureUserPrompts, launchWebScaffold, readPersistedEvents, recordFixture,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { XIAOJING_REPLAY_PROVIDERS } from './xiaojing-replay-catalog.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'
import { serverResponseSchema } from '@deepseek-ai/dsh-client-connection'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/xiaojing-native-browser/session.v4.jsonl', import.meta.url))
const NATIVE_CLI = fileURLToPath(new URL('./fixtures/xiaojing-native-browser.mjs', import.meta.url))
const EDGE_EXECUTABLE = fileURLToPath(new URL('./fixtures/xiaojing-native-edge.mjs', import.meta.url))
const CATALOG = fileURLToPath(new URL('./fixtures/xiaojing-route-catalog/session.v4.jsonl', import.meta.url))
const STANDARD_PRESET = fileURLToPath(new URL('../../../packages/bundle/web-app/presets/standard.patch.yml', import.meta.url))
const WEB_PROFILE = fileURLToPath(new URL('../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url))
const childProcess = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process')

/** Preserve shipped auto-connect routes while isolating browser executables, profiles, and model input. */
async function portableBrowserOverlay(root: string): Promise<string> {
  const declaration = loadOverlayPatches('native browser fixture', STANDARD_PRESET)
    .flatMap(patch => patch.insert ?? []).find(row => row.id === 'preset-standard')
  if (declaration === undefined) throw new Error('Shipped standard preset declaration is missing')
  const preset = declaration.config as PresetDefinition
  const native = loadOverlayPatches('shipped native browser defaults', WEB_PROFILE)
    .flatMap(patch => patch.insert ?? []).find(row => row.id === 'xiaojing-native-browser-control')
  if (native === undefined) throw new Error('Shipped native browser declaration is missing')
  const routes = native.config as { edge: { existingConnection: string }; chrome: { existingConnection: string } }
  expect(routes.edge.existingConnection).toBe('auto-connect')
  expect(routes.chrome.existingConnection).toBe('auto-connect')
  const omitted = new Set(['tool-bash', 'tool-pwsh', 'tool-skill'])
  const plugins = preset.plugins.map(row => omitted.has(row.id ?? '') ? { ...row, disabled: true } : row)
  expect(plugins.filter(row => omitted.has(row.id ?? ''))).toHaveLength(3)
  const path = join(root, 'browser-fixture.patch.yml')
  await writeFile(path, '# Browser-only recording: preserve native providers and sandbox; omit unused platform catalogs.\n'
    + JSON.stringify([
      { id: 'preset-standard', config: { ...preset, plugins } },
      { id: 'xiaojing-native-browser-control', config: {
        requireUserSettings: true,
        edge: { executablePath: join(root, 'fixture-edge.exe'), existingConnection: routes.edge.existingConnection },
        chrome: { executablePath: join(root, 'fixture-chrome.exe'), existingConnection: routes.chrome.existingConnection,
          userDataDir: join(root, 'chrome-profile') },
      } },
      { id: 'xiaojing-native-browser-settings', config: { chrome: true, edge: false } },
    ]) + '\n')
  return path
}

/** Model responses used only for keyless authored refresh; ordinary replay derives them from JSONL. */
function authoredCalls(): ReplayEntry[] {
  const call = (ordinal: number, name: string, args: object): ReplayEntry => {
    const id = ToolCallId(`native-browser-${ordinal}`)
    const argumentsText = JSON.stringify(args)
    return { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] }
  }
  const answer = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] })
  return [
    call(1, 'browser_connect', {}),
    call(2, 'mcp__xiaojing-edge-managed__take_snapshot', {}),
    answer('已使用默认 Edge 读取页面：Quarterly office plan。'),
    call(3, 'browser_connect', { browser: 'chrome', surface: 'existing' }),
    call(4, 'mcp__xiaojing-chrome-existing__take_snapshot', {}),
    answer('已读取您已打开的 Chrome 标签页：Monthly finance review。'),
  ]
}

it('logs default Edge and explicitly requested existing Chrome native reads through the shipped Web profile', async ({ onTestFinished }) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-native-browser-'))
  const failures: unknown[] = []
  const children: { child: ChildProcess; exited: Promise<unknown>; profileDir?: string }[] = []
  let scaffold: WebScaffold | undefined
  const originalSpawn = childProcess.spawn
  const originalExecFile = childProcess.execFile
  const execFile = vi.spyOn(childProcess, 'execFile').mockImplementation((file, args, options, callback) => {
    if (file === 'powershell.exe' && Array.isArray(args)
      && args[0] === '-NoProfile' && args[1] === '-NonInteractive' && args[2] === '-Command'
      && typeof args[3] === 'string' && args[3].includes("GetValue('RemoteDebuggingAllowed'")) {
      return originalExecFile(process.execPath, [NATIVE_CLI, '--profile-policy'], options, callback)
    }
    return originalExecFile(file, args, options, callback)
  })
  const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation((command, args, options) => {
    if (Array.isArray(args)) {
      if (command === join(root, 'fixture-edge.exe')) {
        const profileArg: unknown = args.find((arg: string) => arg.startsWith('--user-data-dir='))
        if (typeof profileArg !== 'string') throw new Error('Native Edge launch omitted its isolated profile')
        const profileDir = profileArg.slice('--user-data-dir='.length)
        expect(args).toContain('--remote-debugging-port=0')
        expect(args).not.toContain('--no-sandbox')
        const child = originalSpawn(process.execPath, [EDGE_EXECUTABLE, profileDir], options)
        children.push({ child, exited: once(child, 'close'), profileDir })
        return child
      }
      const entry: unknown = args.find((arg: string) => {
        const path = arg.replaceAll('\\', '/')
        return path.endsWith('/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js')
          || path.endsWith('/@playwright/mcp/cli.js')
      })
      const cli = typeof entry === 'string' ? entry.replaceAll('\\', '/') : undefined
      if (cli?.endsWith('/@playwright/mcp/cli.js') === true) {
        throw new Error('The native default-route fixture must not start an extension browser')
      }
      const devtools = command === process.execPath && cli?.endsWith('/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js') === true
      if (devtools) {
        const autoConnect = args.includes('--autoConnect')
        if (autoConnect) {
          expect(args[args.indexOf('--user-data-dir') + 1]).toBe(join(root, 'chrome-profile'))
          expect(args).not.toContain('--isolated')
          expect(args).not.toContain('--executable-path')
          expect(args).not.toContain('--ws-endpoint')
        } else {
          expect(args).toContain('--ws-endpoint')
          expect(args[args.indexOf('--ws-endpoint') + 1]).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/fixture-edge$/u)
        }
        expect(args).not.toContain('--extension')
        const child = originalSpawn(process.execPath, [NATIVE_CLI, root, autoConnect ? 'chrome' : 'edge'], options)
        children.push({ child, exited: once(child, 'close') })
        return child
      }
    }
    return originalSpawn(command, args, options)
  })
  syncBuiltinESMExports()
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  vi.stubEnv('XIAOJING_NATIVE_EDGE_EXECUTABLE', join(root, 'fixture-edge.exe'))
  vi.stubEnv('XIAOJING_EDGE_CDP_ENDPOINT', undefined)
  vi.stubEnv('XIAOJING_CHROME_CDP_ENDPOINT', undefined)
  vi.stubEnv('XIAOJING_CHROME_EXECUTABLE', join(root, 'fixture-chrome.exe'))
  vi.stubEnv('XIAOJING_EDGE_PLAYWRIGHT_EXTENSION_TOKEN', undefined)
  vi.stubEnv('XIAOJING_CHROME_PLAYWRIGHT_EXTENSION_TOKEN', undefined)
  let cleanup: Promise<void> | undefined
  const close = (): Promise<void> => (cleanup ??= (async () => {
    const errors: unknown[] = []
    try {
      await scaffold?.close().catch((error: unknown) => errors.push(error))
    } finally {
      for (const entry of children) {
        if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGKILL')
      }
      const exits = await Promise.allSettled(children.map(entry => entry.exited))
      for (const result of exits) if (result.status === 'rejected') errors.push(result.reason)
      spawn.mockRestore()
      execFile.mockRestore()
      syncBuiltinESMExports()
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true }).catch((error: unknown) => errors.push(error))
    }
    if (errors.length > 0) throw new AggregateError(errors, 'native browser Web cleanup failed')
  })())
  onTestFinished(close)
  const authoring = webSnapshotMode() === 'refresh'
  try {
    await writeFile(join(root, 'fixture-edge.exe'), '')
    await writeFile(join(root, 'fixture-chrome.exe'), '')
    const overlay = await portableBrowserOverlay(root)
    const override = join(root, 'authoring-replay.json')
    if (authoring) await writeFile(override, JSON.stringify(authoredCalls()))
    scaffold = await launchWebScaffold({
      replayFixture: authoring ? CATALOG : FIXTURE,
      extraOverlayPath: overlay,
      replayProviders: XIAOJING_REPLAY_PROVIDERS,
      ...authoring ? { replayOverride: override, compareReplaySession: false } : {},
    })
    expect(scaffold.ctx.xiaojingNativeBrowserSettings.enabled('chrome')).toBe(true)
    expect(scaffold.ctx.xiaojingNativeBrowserSettings.enabled('edge')).toBe(false)
    const prompts = authoring
      ? ['打开Edge浏览器并读取当前页面。', '读取我已经打开的 Chrome 标签页，不要改用 Edge，也不要打开新的浏览器。']
      : fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))
    expect(prompts).toHaveLength(2)
    const sessionId = SessionId('xiaojing-native-browser')
    const handle = await scaffold.ctx.agents.create({
      sessionId,
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash' },
      setup: ctx => scaffold!.ctx.agentPresets.mount(ctx, 'standard').then(() => undefined),
    })
    try {
      const initial = await handle.agent.ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent })
      expect(renderContextSnapshot(initial)).toContain('Default to browser=edge; choose browser=chrome only when the user explicitly requests Chrome')
      expect(initial.tools.some(tool => tool.name === 'browser_connect')).toBe(true)
      expect(initial.tools.some(tool => tool.name === 'browser_control')).toBe(false)
      expect(initial.tools.some(tool => tool.name.startsWith('mcp__xiaojing-'))).toBe(false)
      expect(initial.tools.some(tool => ['pwsh', 'bash', 'skill'].includes(tool.name))).toBe(false)
      for (const [index, prompt] of prompts.entries()) {
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
        const failures = handle.agent.session.snapshotEvents().flatMap(event => event.type === 'tool/result' && event.data.message.isError
          ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : [])
        expect(failures, failures.join('\n')).toEqual([])
        const request = handle.agent.session.requestHeader()
        expect(request?.tools?.some(tool => tool.name === (index === 0
          ? 'mcp__xiaojing-edge-managed__take_snapshot'
          : 'mcp__xiaojing-chrome-existing__take_snapshot'))).toBe(true)
      }
      const events = handle.agent.session.snapshotEvents()
      const tools = events.flatMap(event => event.type === 'assistant/message'
        ? event.data.message.content.flatMap(block => block.type === 'tool-call' ? [block.name] : []) : [])
      expect(tools).toEqual([
        'browser_connect', 'mcp__xiaojing-edge-managed__take_snapshot',
        'browser_connect', 'mcp__xiaojing-chrome-existing__take_snapshot',
      ])
      const results = events.flatMap(event => event.type === 'tool/result' ? [event.data.message] : [])
      const resultText = results.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
      expect(results).toHaveLength(4)
      expect(results.every(message => !message.isError)).toBe(true)
      expect(resultText).toContain('Quarterly office plan')
      expect(resultText).toContain('Monthly finance review')
      expect(resultText).toContain('"surface":"existing"')
      const context = events.flatMap(event => event.type === 'user/message'
        ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('\n')
      expect(context).toContain('Default to browser=edge; choose browser=chrome only when the user explicitly requests Chrome')
      expect(context).toContain('A request to open a browser or public website authorizes the necessary browser connection and ordinary tab opening')
      expect(context).toContain('Start browser_connect without another confirmation or prolonged authorization analysis')
      expect(context).toContain('explicitly try surface=managed once with the same browser')
      expect(context).toContain('If that requested existing connection fails, report the connection requirement without replacing it')
      expect(context).not.toContain('If connection fails, explain the required connection step and do not substitute a dedicated browser')
      expect(context).toContain('select surface=existing and reuse the listed tabs')
      expect(context).toContain('When surface is omitted, browser_connect uses existing tabs for a browser enabled in Browser Control settings; otherwise it uses a dedicated browser.')
      expect(context).toContain('allowing remote debugging in its inspect page, and approving the browser connection')
      expect(context).not.toContain('Existing-browser connections require the official Playwright Extension and browser approval')
      expect(events.some(event => event.type === 'user/message' && event.data.source.kind === 'skill-catalog')).toBe(false)
      if (authoring) await recordFixture(scaffold, sessionId, FIXTURE)
    } finally {
      await handle.dispose()
    }
    const persisted = await readPersistedEvents(scaffold, sessionId)
    expect(persisted.filter(event => event.type === 'tool/result')).toHaveLength(4)
    await scaffold.close()
    scaffold = undefined
    await Promise.all(children.map(entry => entry.exited))
    const ownedEdge = children.filter(entry => entry.profileDir !== undefined)
    expect(ownedEdge).toHaveLength(1)
    for (const entry of ownedEdge) {
      if (entry.profileDir !== undefined) expect(existsSync(entry.profileDir)).toBe(false)
    }
    const external = (await readFile(join(root, 'native-events.jsonl'), 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as { event: string; browser: string; name?: string; pid: number })
    expect(external.filter(event => event.event === 'call').map(event => `${event.browser}:${event.name}`))
      .toEqual(['edge:list_pages', 'edge:take_snapshot', 'chrome:list_pages', 'chrome:take_snapshot'])
    expect(new Set(external.filter(event => event.event === 'start').map(event => event.browser)))
      .toEqual(new Set(['edge', 'chrome']))
    for (const started of external.filter(event => event.event === 'start')) {
      expect(() => process.kill(started.pid, 0)).toThrow()
    }
  } catch (error) {
    failures.push(error)
  } finally {
    await close().catch((error: unknown) => failures.push(error))
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'native browser Web scenario and cleanup failed')
})

it.skipIf(process.platform !== 'win32' || process.env.XIAOJING_BROWSER_SETTINGS_LIVE !== '1')(
  'opens actual Chrome and Edge inspect pages only after clicking their Web settings buttons', async ({ onTestFinished }) => {
    const browser = await chromium.launch()
    onTestFinished(() => browser.close())
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    const scaffold = await launchWebScaffold({ developerTools: false,
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)) })
    onTestFinished(() => scaffold.close())
    const observations: unknown[] = []
    const originalExecFile = childProcess.execFile
    const execFile = vi.spyOn(childProcess, 'execFile').mockImplementation((file, args, options, callback) => {
      const encoded: unknown = Array.isArray(args) && args[2] === '-EncodedCommand' ? args[3] : undefined
      if (file === 'powershell.exe' && callback !== undefined && callback !== null && typeof encoded === 'string'
        && Buffer.from(encoded, 'base64').toString('utf16le').includes('public static class BrowserSettingsWindow')) {
        return originalExecFile(file, args, options, (error, stdout, stderr) => {
          if (error === null) observations.push(JSON.parse(typeof stdout === 'string' ? stdout : stdout.toString('utf8')))
          callback(error, stdout, stderr)
        })
      }
      return originalExecFile(file, args, options, callback)
    })
    syncBuiltinESMExports()
    onTestFinished(() => { execFile.mockRestore(); syncBuiltinESMExports() })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openSettings(page, 'zh')
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.getByRole('button', { name: '浏览器控制', exact: true }).click()
    const evidence = process.env.XIAOJING_BROWSER_SETTINGS_EVIDENCE
    for (const brand of ['chrome', 'edge'] as const) {
      await settings.getByRole('button', { name: brand === 'chrome' ? '管理 Chrome 浏览器' : '管理 Edge 浏览器' }).click()
      const guide = page.getByRole('dialog', { name: brand === 'chrome' ? '设置 Chrome 标签页控制' : '设置 Edge 标签页控制' })
      await guide.waitFor()
      expect(observations).toHaveLength(brand === 'chrome' ? 0 : 1)
      const result = page.waitForResponse(response => response.url().endsWith('/xiaojing-native-browser-control/open-settings'))
      await guide.getByRole('button', { name: brand === 'chrome' ? '打开 Chrome 设置页' : '打开 Edge 设置页', exact: true }).click()
      const response = serverResponseSchema.parse(await (await result).json()).result
      expect(response).toMatchObject({ ok: true })
      await guide.getByRole('status').filter({ hasText: '设置页已打开' }).waitFor({ timeout: 40_000 })
      expect(observations.at(-1)).toEqual({ browser: brand, url: `${brand}://inspect/#remote-debugging`,
        documentTitle: `Inspect with ${brand === 'chrome' ? 'Chrome' : 'Edge'} Developer Tools`, opened: true })
      expect(scaffold.ctx.xiaojingNativeBrowserSettings.enabled(brand)).toBe(false)
      expect(await settings.getByRole('switch', { name: brand === 'chrome' ? '允许控制 Chrome 已打开的标签页' : '允许控制 Edge 已打开的标签页' })
        .getAttribute('aria-checked')).toBe('false')
      if (evidence !== undefined) await page.screenshot({ path: join(evidence, `settings-web-${brand}.png`), fullPage: true })
      await guide.getByRole('button', { name: '知道了', exact: true }).click()
    }
    if (evidence !== undefined) await writeFile(join(evidence, 'settings-web-observations.json'), JSON.stringify(observations, null, 2) + '\n')
    expect(observations).toHaveLength(2)
  }, 120_000,
)
