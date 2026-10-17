/** Lazy Edge and Chrome access through the Harness DevTools and Playwright providers. @module */

import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import { SessionResources } from '@deepseek-ai/dsh-experimental-browser-use-runtime'
import * as DevTools from '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp'
import * as Playwright from '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { installNativeBrowserGuard } from './native-approval.ts'
import { findWindowsEdgeExecutable } from './managed-edge.ts'
import { launchManagedEdge, type ManagedEdgeProcess } from './native-edge-launch.ts'
import { assertManagedChromeProfileIsolation } from './native-chrome-policy.ts'
import { findWindowsChromeExecutable } from './native-chrome-executable.ts'
import { discoverNativeBrowserProfile } from './native-profile-discovery.ts'
import type {} from './native-settings-types.ts'
import type { NativeBrowserInstallation } from './native-settings-types.ts'
import type {} from '@deepseek-ai/dsh-browser-use'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-working-directory'

/** Cordis identity for native browser routing. */
export const name = 'xiaojing-native-browser-control'

/** Services used for browser ownership, scoped tools, and approval. */
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt', 'approval', 'workingDirectory']

/** Browser explicitly selected by the user, or Edge when omitted. */
export type NativeBrowser = 'edge' | 'chrome'

/** Dedicated browser or a connection to the user's existing browser. */
export type NativeBrowserSurface = 'managed' | 'existing'

/** Deployment-owned browser installation and existing-browser connection settings. */
export interface NativeBrowserSettings {
  /** Browser installation override; omission uses the provider's discovery. */
  executablePath?: string
  /** Existing CDP endpoint; omission uses existingConnection. */
  existingEndpoint?: string
  /** Existing-browser discovery; extension keeps the explicit official extension route. */
  existingConnection?: 'extension' | 'auto-connect'
  /** Absolute existing-browser profile override for native auto-connect. */
  userDataDir?: string
  /** Optional official extension token, passed only to the child environment. */
  extensionToken?: string
}

/** Native browser configuration; ordinary chat does not acquire browser resources. */
export interface Config {
  /** Microsoft Edge connection settings. */
  edge: NativeBrowserSettings
  /** Google Chrome connection settings. */
  chrome: NativeBrowserSettings
  /** Optional timeout forwarded to the native MCP provider. */
  toolCallTimeoutMs?: number
  /** Native connection probe deadline, including existing-browser extension approval, in milliseconds. */
  connectTimeoutMs: number
  /** Browser discovery, policy checks, and owned managed Edge startup/cleanup deadline, in milliseconds. */
  managedBrowserTimeoutMs: number
  /** Permit loopback fixtures; production leaves this false. */
  allowPrivateHosts: boolean
  /** Require the product's persisted permission service for existing-tab access. */
  requireUserSettings: boolean
}

const BrowserSettings: Schema<NativeBrowserSettings> = Schema.object({
  executablePath: Schema.string().pattern(/\S/u),
  existingEndpoint: Schema.string().pattern(/\S/u),
  existingConnection: Schema.union(['extension', 'auto-connect']),
  userDataDir: Schema.string().pattern(/\S/u),
  extensionToken: Schema.string().pattern(/\S/u).role('secret'),
})

/** Validate trusted browser configuration independently of model arguments. */
export const Config: Schema<
  Omit<Config, 'edge' | 'chrome' | 'allowPrivateHosts' | 'managedBrowserTimeoutMs' | 'connectTimeoutMs' | 'requireUserSettings'>
  & Partial<Pick<Config, 'edge' | 'chrome' | 'allowPrivateHosts' | 'managedBrowserTimeoutMs' | 'connectTimeoutMs' | 'requireUserSettings'>>, Config
> = Schema.object({
  edge: BrowserSettings.default({}),
  chrome: BrowserSettings.default({}),
  toolCallTimeoutMs: Schema.number().step(1).min(1).max(2_147_483_647),
  connectTimeoutMs: Schema.number().step(1).min(1).max(2_147_483_647).default(600_000),
  managedBrowserTimeoutMs: Schema.number().step(1).min(1).max(2_147_483_647).default(30_000),
  allowPrivateHosts: Schema.boolean().default(false),
  requireUserSettings: Schema.boolean().default(false),
})

interface Route {
  browser: NativeBrowser
  surface: NativeBrowserSurface
  prefix: string
  serverName: string
  probe: { name: string; arguments: object }
  resources: SessionResources<Scope>
}

interface Selection {
  selected?: Route
  scope?: Scope
  connecting?: { route: Route; probeId: ToolCallId; controller: AbortController }
}

function resolveTimeouts(config: Config): { operation: number; connect: number; mcp: number } {
  const operation = config.toolCallTimeoutMs ?? 60_000
  return { operation, connect: config.connectTimeoutMs, mcp: Math.max(operation, config.connectTimeoutMs) }
}

function isNativeTransportFailure(result: ToolExecutionResult): boolean {
  return result.isError && result.error.info?.name === 'McpTransportError'
    && (result.error.info.code === 'NOT_CONNECTED' || result.error.info.code === 'CONNECTION_CLOSED')
}

/**
 * Publish browser_connect and acquire native tools only after an explicit tool call.
 * Browser selection commits after listing tabs succeeds; attached browsers remain externally owned.
 * @param ctx - plugin context with browser use, Agents, tools, prompt, and approval.
 * @param config - validated deployment-owned browser connections.
 */
export function apply(ctx: Context, config: Config): void {
  const timeouts = resolveTimeouts(config)
  const selections = new Map<Agent, Selection>()
  const connections = new WeakMap<Scope, 'connected' | 'disconnected'>()
  const routes: Route[] = []
  const resourceTools = new Set(['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'])
  const installations = new Map<NativeBrowser, { executablePath: string; userDataDir: string | undefined }>()
  let stopping = false

  const installation = async (browser: NativeBrowser, signal: AbortSignal) => {
    signal.throwIfAborted()
    const current = installations.get(browser)
    if (current !== undefined) return current
    const settings = config[browser]
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(config.managedBrowserTimeoutMs)])
    const executablePath = settings.executablePath ?? (browser === 'edge'
      ? await findWindowsEdgeExecutable() : await findWindowsChromeExecutable(deadline))
    const userDataDir = executablePath === undefined || settings.existingConnection !== 'auto-connect'
      ? undefined : (await discoverNativeBrowserProfile(browser, deadline, settings.userDataDir)).userDataDir
    deadline.throwIfAborted()
    if (executablePath !== undefined) installations.set(browser, { executablePath, userDataDir })
    return { executablePath, userDataDir }
  }

  const existingAllowed = (browser: NativeBrowser): void => {
    const settings = ctx.get('xiaojingNativeBrowserSettings')
    if (settings === undefined && config.requireUserSettings) throw new Error('Existing browser control requires the browser settings service')
    if (settings?.enabled(browser) === false) throw new Error(`Existing ${browser} control is disabled. Enable it in Browser Control settings first.`)
  }

  const revoke = async (browser: NativeBrowser): Promise<void> => {
    const route = routes.find(route => route.browser === browser && route.surface === 'existing')
    if (route === undefined) return
    const owners = [...selections].map(([agent, selection]) => {
      if (selection.connecting?.route === route) selection.connecting.controller.abort(new Error('Existing browser access was disabled in settings'))
      if (selection.selected === route) { delete selection.selected; delete selection.scope }
      return agent
    })
    const settled = await Promise.allSettled(owners.map(agent => route.resources.release(agent)))
    const errors = settled.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'Existing browser disconnect failed')
  }

  ctx.inject(['xiaojingNativeBrowserSettings'], (settingsCtx) => {
    settingsCtx.effect(function* () {
      yield settingsCtx.xiaojingNativeBrowserSettings.registerRuntime({
        async inspect(browser, signal): Promise<NativeBrowserInstallation> {
          const metadata = await installation(browser, signal)
          signal.throwIfAborted()
          let setupReady = config[browser].existingEndpoint !== undefined
          if (metadata.userDataDir !== undefined) {
            try { await access(join(metadata.userDataDir, 'DevToolsActivePort')); setupReady = true }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          }
          return { installed: metadata.executablePath !== undefined, setupReady,
            ...metadata.executablePath === undefined ? {} : { executablePath: metadata.executablePath } }
        },
        state(browser) {
          for (const selection of selections.values()) {
            if (selection.connecting?.route.browser === browser && selection.connecting.route.surface === 'existing') return 'connecting'
            if (selection.selected?.browser === browser && selection.selected.surface === 'existing' && selection.scope !== undefined) {
              return connections.get(selection.scope)
            }
          }
          return undefined
        },
        revoke,
      })
      yield async () => { await Promise.all([revoke('edge'), revoke('chrome')]) }
    }, 'native browser settings runtime')
  })

  ctx.effect(function* () {
    yield ctx.browserUse.register(BrowserUseProviderName('xiaojing-native-browser'))
    for (const browser of ['edge', 'chrome'] as const) {
      for (const surface of ['managed', 'existing'] as const) {
        const settings = config[browser]
        const serverName = `xiaojing-${browser}-${surface}`
        const autoConnect = surface === 'existing' && settings.existingEndpoint === undefined && settings.existingConnection === 'auto-connect'
        const extension = surface === 'existing' && settings.existingEndpoint === undefined && !autoConnect
        const createOptions = (executablePath: string | undefined, managedEndpoint?: string, userDataDir?: string) => {
          const shared = { serverName, toolCallTimeoutMs: timeouts.mcp }
          if (autoConnect) {
            if (userDataDir === undefined) throw new Error('Existing browser auto-connect requires a resolved profile directory')
            return DevTools.createSessionMcpOptions(DevTools.Config({ ...shared, mode: 'auto-connect', userDataDir }))
          }
          if (extension) {
            return Playwright.createSessionMcpOptions(Playwright.Config({
              ...shared, mode: 'extension', browser: browser === 'edge' ? 'msedge' : 'chrome',
              ...executablePath === undefined ? {} : { executablePath },
              ...settings.extensionToken === undefined ? {} : { extensionToken: settings.extensionToken },
            }))
          }
          const endpoint = managedEndpoint ?? settings.existingEndpoint
          if (endpoint !== undefined && (surface === 'existing' || managedEndpoint !== undefined)) {
            return DevTools.createSessionMcpOptions(DevTools.Config({ ...shared, mode: 'attach', endpoint }))
          }
          return DevTools.createSessionMcpOptions(DevTools.Config({
            ...shared, mode: 'launch', headless: false, ...executablePath === undefined ? {} : { executablePath },
          }))
        }
        if (!autoConnect) createOptions(settings.executablePath)
        const route: Route = {
          browser, surface, serverName, prefix: `mcp__${serverName}__`,
          probe: extension ? { name: 'browser_tabs', arguments: { action: 'list' } } : { name: 'list_pages', arguments: {} },
          resources: new SessionResources(ctx, {
            label: serverName,
            exclusive: surface === 'existing',
            open(agent, signal) {
              const scope = createScope(ctx, agent)
              let owned: ManagedEdgeProcess | undefined
              let closing: Promise<void> | undefined
              return Promise.resolve({
                value: scope,
                close: () => closing ??= (async () => {
                  await scope.dispose()
                  // Cordis logs effect cleanup failures; observe the owned process failure directly.
                  await owned?.close()
                })(),
                async initialize() {
                  const cancel = (): void => {
                    void scope.dispose().catch((error: unknown) => {
                      ctx.logger.warn(`${serverName}: canceled browser startup cleanup failed: ${String(error)}`)
                    })
                  }
                  signal.addEventListener('abort', cancel, { once: true })
                  try {
                    signal.throwIfAborted()
                    if (surface === 'existing') existingAllowed(browser)
                    const discoverySignal = AbortSignal.any([signal, AbortSignal.timeout(config.managedBrowserTimeoutMs)])
                    if (browser === 'chrome' && surface === 'managed') await assertManagedChromeProfileIsolation(discoverySignal)
                    const executablePath = settings.executablePath ?? (surface === 'managed' || extension
                      ? browser === 'edge' ? await findWindowsEdgeExecutable() : await findWindowsChromeExecutable(discoverySignal) : undefined)
                    discoverySignal.throwIfAborted()
                    if (browser === 'edge' && surface === 'managed' && executablePath === undefined) {
                      throw new Error('Microsoft Edge is not installed or its executable could not be found')
                    }
                    let managedEndpoint: string | undefined
                    const userDataDir = autoConnect
                      ? (await discoverNativeBrowserProfile(browser, discoverySignal, settings.userDataDir)).userDataDir : undefined
                    if (browser === 'edge' && surface === 'managed' && executablePath !== undefined) {
                      owned = await launchManagedEdge({
                        executablePath, headless: false, timeoutMs: config.managedBrowserTimeoutMs,
                      }, signal)
                      const processOwner = owned
                      scope.ctx.effect(() => () => processOwner.close(), 'owned managed Edge process')
                      managedEndpoint = await owned.endpoint
                    }
                    const options = createOptions(executablePath, managedEndpoint, userDataDir)
                    signal.throwIfAborted()
                    installNativeBrowserGuard(scope.ctx, {
                      prefix: route.prefix, browser, surface, owner: agent, allowPrivateHosts: config.allowPrivateHosts,
                    })
                    await scope.ctx.plugin(McpClient, McpClient.Config({
                      transport: 'stdio', serverName: options.name, command: options.command, args: options.args,
                      ...options.env === undefined ? {} : { env: options.env },
                      cwd: await ctx.workingDirectory.ensure(agent, signal),
                      ...options.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: options.toolCallTimeoutMs },
                      failOnStartupError: true, reconnect: { enabled: false },
                    }))
                    signal.throwIfAborted()
                  } finally {
                    signal.removeEventListener('abort', cancel)
                  }
                },
              })
            },
          }),
        }
        routes.push(route)
      }
    }
    yield async () => {
      stopping = true
      const settled = await Promise.allSettled(routes.map(route => route.resources.dispose()))
      selections.clear()
      const errors = settled.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason] : [])
      if (errors.length > 0) throw new AggregateError(errors, 'native browser cleanup failed')
    }
  }, 'xiaojing-native-browser.sessions')

  ctx.on('tools/execute', async (exec, next) => {
    const resourceServer = resourceTools.has(exec.name) && typeof exec.arguments === 'object' && exec.arguments !== null
      ? (exec.arguments as { server?: unknown }).server : undefined
    const route = routes.find(route => exec.name.startsWith(route.prefix) || resourceServer === route.serverName)
    if (route === undefined) return next()
    const agent = exec.agent
    const selection = agent === undefined ? undefined : selections.get(agent)
    const isProbe = selection?.connecting?.route === route && selection.connecting.probeId === exec.callId
    if (stopping || agent === undefined || (selection?.selected !== route && !isProbe)) {
      throw new Error('native browser tool requires browser_connect for this browser in the owning Session')
    }
    if (route.surface === 'existing') existingAllowed(route.browser)
    const deadline = AbortSignal.timeout(isProbe ? timeouts.connect : timeouts.operation)
    return route.resources.run(agent, AbortSignal.any([exec.signal, deadline]), async (scope, signal) => {
      const current = selections.get(agent)
      const currentProbe = current?.connecting?.route === route && current.connecting.probeId === exec.callId
      if (current?.selected !== route && !currentProbe) throw new Error('native browser selection changed before this call started')
      if (route.surface === 'existing') existingAllowed(route.browser)
      const original = exec.signal
      exec.signal = signal
      try {
        const result = await next()
        if (isNativeTransportFailure(result) && connections.has(scope)) connections.set(scope, 'disconnected')
        return result
      } finally { exec.signal = original }
    })
  })

  ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
    const assembly = await next()
    const selected = agent === undefined ? undefined : selections.get(agent)?.selected
    return {
      ...assembly,
      tools: assembly.tools.filter(tool => !routes.some(route => tool.name.startsWith(route.prefix) && route !== selected)),
      sections: assembly.sections.filter(section => !routes.some(route => section.name === `mcp:${route.serverName}` && route !== selected)),
    }
  })

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_connect',
    description: 'Connect to a browser before using its native browser tools. Default to Edge; choose Chrome only when the user asks for Chrome. When surface is omitted, use existing tabs if that browser is enabled in Browser Control settings; otherwise use a dedicated visible browser. Choose existing explicitly for already-open tabs. Existing access requires the browser permission enabled in settings and the browser connection approval; configured extension and debugging routes remain supported. A failed existing connection never opens a replacement browser.',
    parameters: {
      browser: { type: 'string', enum: ['edge', 'chrome'], description: 'Default edge; use chrome only when requested.' },
      surface: { type: 'string', enum: ['managed', 'existing'], description: 'Omitted uses existing when enabled in Browser Control settings, otherwise managed. Existing connects to already-open browser tabs.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        browser: { type: 'string', enum: ['edge', 'chrome'], required: true },
        surface: { type: 'string', enum: ['managed', 'existing'], required: true },
        toolPrefix: { type: 'string', required: true },
        tabs: { type: 'string', required: true },
        summary: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (stopping || agent === undefined || ctx.agents.get(agent.id) !== agent) throw new Error('browser_connect requires a live owning Agent')
      const browser: NativeBrowser = args.browser ?? 'edge'
      const surface: NativeBrowserSurface = args.surface ?? (ctx.get('xiaojingNativeBrowserSettings')?.enabled(browser) === true ? 'existing' : 'managed')
      if (surface === 'existing') existingAllowed(browser)
      const route = routes.find(route => route.browser === browser && route.surface === surface)
      if (route === undefined) throw new Error('native browser route is not active')
      let selection = selections.get(agent)
      if (selection === undefined) {
        selection = {}
        selections.set(agent, selection)
        agent.ctx.effect(() => () => { selections.delete(agent) }, 'xiaojing-native-browser.selection')
      }
      if (selection.connecting !== undefined) throw new Error('browser_connect is already in progress in this Session')
      const probeId = ToolCallId(randomUUID())
      const controller = new AbortController()
      const signal = AbortSignal.any([exec.signal, controller.signal])
      const previous = selection.selected
      delete selection.selected
      delete selection.scope
      selection.connecting = { route, probeId, controller }
      try {
        if (previous !== undefined && previous !== route && previous.surface === 'existing') await previous.resources.release(agent)
        let scope = await route.resources.get(agent, signal)
        let rebuilt = false
        if (connections.get(scope) === 'disconnected') {
          await route.resources.release(agent)
          scope = await route.resources.get(agent, signal)
          rebuilt = true
        }
        signal.throwIfAborted()
        let result = await ctx.tools.execute({
          agent, name: `${route.prefix}${route.probe.name}`, arguments: route.probe.arguments, callId: probeId, signal,
        })
        if (result.isError && !rebuilt && connections.get(scope) === 'disconnected' && !signal.aborted) {
          await route.resources.release(agent)
          scope = await route.resources.get(agent, signal)
          const retryId = ToolCallId(randomUUID())
          selection.connecting = { route, probeId: retryId, controller }
          result = await ctx.tools.execute({
            agent, name: `${route.prefix}${route.probe.name}`, arguments: route.probe.arguments,
            callId: retryId, signal,
          })
        }
        if (result.isError) throw new Error(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
        signal.throwIfAborted()
        if (surface === 'existing') existingAllowed(browser)
        connections.set(scope, 'connected')
        selection.selected = route
        selection.scope = scope
        return { browser, surface, toolPrefix: route.prefix, tabs: result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'), summary: `Connected to ${browser} ${surface}; use native tools with this prefix and reuse the listed tabs.` }
      } catch (error) {
        await route.resources.release(agent)
        delete selection.selected
        delete selection.scope
        if (surface === 'existing' && !signal.aborted) {
          const displayBrowser = browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'
          const detail = (error instanceof Error ? error.message : String(error))
            .replaceAll('Could not connect to Chrome.', `Could not connect to ${displayBrowser}.`)
            .replaceAll('Check if Chrome is running', `Check if ${displayBrowser} is running`)
            .replaceAll('chrome://inspect/#remote-debugging', `${browser}://inspect/#remote-debugging`)
          const settings = config[browser]
          const guidance = settings.existingEndpoint !== undefined
            ? 'Check the configured debugging endpoint and that the browser is running.'
            : settings.existingConnection === 'auto-connect'
              ? `The browser must be running with remote debugging permitted at ${browser}://inspect/#remote-debugging. If it asks to allow this connection, approve its native request.`
              : 'The configured official browser extension requires its connection approval.'
          const refusal = detail.includes('Unexpected server response: 403')
            ? 'The native debugging endpoint rejected the connection (HTTP 403); its reason is unconfirmed. ' : ''
          throw new Error(`Could not connect to existing ${displayBrowser} tabs. ${refusal}${guidance} No replacement browser was opened. ${detail}`, { cause: error })
        }
        throw error
      } finally {
        delete selection.connecting
      }
    },
  })), 'xiaojing-native-browser.connect')
}
