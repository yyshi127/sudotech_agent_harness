/**
 * Xiaojing browser-control capability: a Playwright provider, a semantic model tool, and fail-closed approval checks for
 * private-network navigation and high-impact page actions.
 * @module @deepseek-ai/dsh-xiaojing-browser-control
 */

import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { access, mkdir, readdir } from 'node:fs/promises'
import { isIP } from 'node:net'
import { isAbsolute, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { chromium } from 'playwright-core'
import type { BrowserContext, Locator, Page, Route, Worker } from 'playwright-core'
import { BROWSER_ACTIONS, BrowserObservationId, BrowserPageId, BrowserTargetId } from './types.ts'
import type {
  BrowserActionRequest,
  BrowserActionResult,
  BrowserPageSummary,
  BrowserTarget,
} from './types.ts'

export { BROWSER_ACTIONS, BrowserObservationId, BrowserPageId, BrowserTargetId } from './types.ts'
export type {
  BrowserAction,
  BrowserActionRequest,
  BrowserActionResult,
  BrowserPageSummary,
  BrowserTarget,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    xiaojingBrowserControl: BrowserControl
  }
}

/** Browser runtime configuration. */
export interface Config {
  /** Dedicated persistent profile directory; never point this at a person's normal browser profile. */
  profileDir: string
  /** Explicit Chromium executable used by tests or a controlled deployment when Microsoft Edge is unavailable. */
  executablePath?: string
  /** Whether to hide the controlled browser window. Xiaojing ships with this disabled. */
  headless?: boolean
  /** Playwright operation timeout. */
  actionTimeoutMs?: number
  /** Page navigation timeout. */
  navigationTimeoutMs?: number
  /** Lifetime of opaque observation targets. */
  observationTtlMs?: number
  /** Maximum semantic targets returned per observation. */
  maxTargets?: number
  /** Maximum session-owned pages returned by `tabs`. */
  maxTabs?: number
  /** Maximum visible page characters returned per observation. */
  maxTextChars?: number
  /** Whether private and loopback destinations are allowed without approval. Intended only for tests. */
  allowPrivateHosts?: boolean
}

interface ResolvedConfig {
  profileDir: string
  executablePath?: string
  headless: boolean
  actionTimeoutMs: number
  navigationTimeoutMs: number
  observationTtlMs: number
  maxTargets: number
  maxTabs: number
  maxTextChars: number
  allowPrivateHosts: boolean
}

interface PageRecord {
  readonly id: BrowserPageId
  readonly owner: SessionId
  readonly page: Page
}

interface StoredTarget {
  readonly target: BrowserTarget
  readonly locator: Locator
  readonly inputType: string
}

interface Observation {
  readonly id: BrowserObservationId
  readonly owner: SessionId
  readonly pageId: BrowserPageId
  readonly expiresAt: number
  readonly targets: ReadonlyMap<BrowserTargetId, StoredTarget>
}

interface ElementProjection {
  readonly index: number
  readonly role: string
  readonly name: string
  readonly value?: string
  readonly disabled: boolean
  readonly checked?: boolean
  readonly inputType: string
  readonly actions: string[]
}

interface ProjectionResult {
  readonly targets: ElementProjection[]
  readonly truncated: boolean
}

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
].join(',')

const HIGH_IMPACT_PATTERN = new RegExp(
  '(?:delete|remove|uninstall|pay|purchase|buy|submit|send|publish|post|transfer|sign|close account'
  + '|删除|移除|卸载|支付|购买|提交|发送|发布|转账|签署|注销)',
  'iu',
)

/** Locate an installed Edge executable when Playwright's channel lookup misses a system or EdgeCore installation. */
async function findWindowsEdgeExecutable(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter((root): root is string => root !== undefined && root !== '')
  const standard = roots.map(root => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  for (const candidate of standard) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Missing or inaccessible candidates are expected while checking the fixed Windows installation locations.
    }
  }
  for (const root of roots) {
    const edgeCore = join(root, 'Microsoft', 'EdgeCore')
    let versions
    try {
      versions = await readdir(edgeCore, { withFileTypes: true })
    } catch {
      // EdgeCore is optional, so an absent or inaccessible root contributes no candidate.
      continue
    }
    const directories = versions.filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }))
    for (const version of directories) {
      const candidate = join(edgeCore, version, 'msedge.exe')
      try {
        await access(candidate)
        return candidate
      } catch {
        // An incomplete version directory is ignored in favor of the next installed EdgeCore version.
      }
    }
  }
  return undefined
}

/** Schemastery configuration for the browser-control capability. */
export const Config: z<Config> = z.object({
  profileDir: z.string().required(),
  executablePath: z.string(),
  headless: z.boolean().default(false),
  actionTimeoutMs: z.number().min(100).max(120_000).default(15_000),
  navigationTimeoutMs: z.number().min(100).max(180_000).default(30_000),
  observationTtlMs: z.number().min(1_000).max(600_000).default(120_000),
  maxTargets: z.number().min(1).max(1_000).default(160),
  maxTabs: z.number().min(1).max(500).default(50),
  maxTextChars: z.number().min(256).max(100_000).default(20_000),
  allowPrivateHosts: z.boolean().default(false),
})

/** Return an error when an abort signal has already fired. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('browser operation cancelled')
}

/** Resolve a required non-empty string field. */
function requireText(value: string | undefined, field: string): string {
  const resolved = value?.trim()
  if (resolved === undefined || resolved === '') throw new Error(`browser_control ${field} must be a non-empty string`)
  return resolved
}

/** Reject a browser action omitted from a closed action switch. */
function assertNever(value: never): never {
  throw new Error(`unsupported browser action ${String(value)}`)
}

/**
 * Whether an IP address belongs to a local, private, link-local, or unspecified range.
 * @param address - Parsed IPv4 or IPv6 address.
 * @returns Whether the address must be treated as private.
 */
export function isPrivateAddress(address: string): boolean {
  if (address === '::' || address === '::1') return true
  const normalized = address.toLowerCase()
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8')
    || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1]
  const ipv4 = mapped ?? (isIP(address) === 4 ? address : undefined)
  if (ipv4 === undefined) return false
  const octets = ipv4.split('.').map(Number)
  const [first, second] = octets
  if (first === undefined || second === undefined) return true
  return first === 0 || first === 10 || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224
}

/**
 * Resolve whether a URL reaches a destination that requires private-network approval.
 * @param url - Absolute HTTP or HTTPS URL to classify.
 * @returns The private host or address, or undefined for a public destination.
 */
export async function privateDestination(url: string): Promise<string | undefined> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('browser_control open accepts only http:// and https:// URLs')
  }
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return hostname
  if (isIP(hostname) !== 0) return isPrivateAddress(hostname) ? hostname : undefined
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(hostname, { all: true, order: 'verbatim' })
  } catch (error) {
    throw new Error(`cannot resolve browser destination ${hostname}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return addresses.some(entry => isPrivateAddress(entry.address)) ? hostname : undefined
}

/** Close one page while keeping a headed persistent browser alive when it is the last tab. */
async function closeBrowserPage(page: Page): Promise<void> {
  if (page.isClosed()) return
  const context = page.context()
  if (context.pages().filter(candidate => !candidate.isClosed()).length === 1) {
    try {
      await context.newPage()
    } catch {
      // A browser that is already exiting cannot accept the replacement blank page.
    }
  }
  try {
    await page.close({ runBeforeUnload: false })
  } catch {
    // A crashed or concurrently closed page has no remaining resources Playwright can release.
  }
}

/** Race one Playwright operation against cancellation and close its page if cancellation wins. */
async function withPageCancellation<T>(page: Page, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  throwIfAborted(signal)
  let remove = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      void closeBrowserPage(page).then(() => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('browser operation cancelled'))
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    remove = () => { signal.removeEventListener('abort', onAbort) }
  })
  try {
    return await Promise.race([operation(), aborted])
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('browser operation cancelled')
    }
    throw error
  } finally {
    remove()
  }
}

/** Close one browser context without replacing the operation that originally failed. */
async function closeBrowserContext(context: BrowserContext): Promise<void> {
  try {
    await context.close()
  } catch {
    // A crashed or already closed browser has no remaining context resources Playwright can release.
  }
}

/** Semantic browser automation provider and model-facing tool consumer. */
export class BrowserControl extends Service {
  static inject = ['tools']
  static Config = Config

  private readonly options: ResolvedConfig
  private context: BrowserContext | undefined
  private launch: Promise<BrowserContext> | undefined
  private launchGeneration = 0
  private readonly closedContexts = new WeakSet<BrowserContext>()
  private readonly pages = new Map<BrowserPageId, PageRecord>()
  private readonly pageIds = new WeakMap<Page, BrowserPageId>()
  private readonly activePageByOwner = new Map<SessionId, BrowserPageId>()
  private readonly observations = new Map<BrowserObservationId, Observation>()
  private readonly approvedPrivateHosts = new WeakMap<Page, ReadonlySet<string>>()
  private readonly destinationChecks = new WeakMap<Page | Worker, Map<string, Promise<string | undefined>>>()
  private readonly operationTails = new Map<SessionId, Promise<void>>()

  /** Create the lazy browser provider and register `browser_control`. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'xiaojingBrowserControl')
    this.options = {
      profileDir: config.profileDir,
      ...config.executablePath !== undefined && config.executablePath.trim() !== ''
        ? { executablePath: config.executablePath }
        : {},
      headless: config.headless ?? false,
      actionTimeoutMs: config.actionTimeoutMs ?? 15_000,
      navigationTimeoutMs: config.navigationTimeoutMs ?? 30_000,
      observationTtlMs: config.observationTtlMs ?? 120_000,
      maxTargets: config.maxTargets ?? 160,
      maxTabs: config.maxTabs ?? 50,
      maxTextChars: config.maxTextChars ?? 20_000,
      allowPrivateHosts: config.allowPrivateHosts ?? false,
    }
    ctx.effect(() => async () => this.close(), 'xiaojingBrowserControl.close')
    this.installTool(ctx)
  }

  /**
   * Explain whether one request requires a one-shot user approval.
   * @param owner - Agent session that owns the browser page.
   * @param request - Validated browser operation.
   * @returns The approval reason, or undefined when the operation may proceed directly.
   */
  async approvalReason(owner: SessionId, request: BrowserActionRequest): Promise<string | undefined> {
    switch (request.action) {
      case 'open': {
        if (this.options.allowPrivateHosts) return undefined
        const destination = await privateDestination(requireText(request.url, 'url'))
        return destination === undefined ? undefined : `Open private or local browser destination ${destination}`
      }
      case 'upload': {
        const paths = this.uploadPaths(request)
        const target = this.resolveTarget(owner, request)
        if (target.inputType !== 'file') throw new Error('browser_control upload target must be a file input')
        return `Upload ${String(paths.length)} local file(s) to the current website`
      }
      case 'press': {
        this.activePage(owner)
        const key = requireText(request.key, 'key').toLowerCase()
        return key === 'enter' || key === 'delete' || key === 'backspace'
          ? `Send the potentially committing browser key ${request.key as string}`
          : undefined
      }
      case 'click': {
        const stored = this.resolveTarget(owner, request)
        const label = `${stored.target.name} ${stored.inputType}`
        return stored.inputType === 'submit' || HIGH_IMPACT_PATTERN.test(label)
          ? `Activate potentially high-impact browser control “${stored.target.name || stored.target.role}”`
          : undefined
      }
      case 'observe':
      case 'fill':
      case 'select':
      case 'scroll':
      case 'tabs':
      case 'switch_tab':
      case 'close_tab':
        return undefined
      default: return assertNever(request.action)
    }
  }

  /**
   * Execute one validated browser operation for an owning session.
   * @param owner - Agent session that owns the browser page.
   * @param request - Browser operation to execute.
   * @param signal - Cancellation signal for the operation.
   * @returns The bounded browser observation produced by the operation.
   */
  run(owner: SessionId, request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    return this.enqueue(owner, signal, async () => {
      switch (request.action) {
        case 'open': return await this.open(owner, request, signal)
        case 'observe': return await this.observeActive(owner, request.action, signal, 'Observed current page')
        case 'click': return await this.targetAction(owner, request, signal, async target => target.locator.click())
        case 'fill': {
          const value = request.value ?? ''
          return await this.targetAction(owner, request, signal, async target => target.locator.fill(value))
        }
        case 'select': {
          const value = requireText(request.value, 'value')
          return await this.targetAction(owner, request, signal, async (target) => {
            try {
              await target.locator.selectOption({ label: value })
            } catch (labelError) {
              try {
                await target.locator.selectOption(value)
              } catch {
                throw labelError
              }
            }
          })
        }
        case 'press': {
          const page = this.activePage(owner)
          const key = requireText(request.key, 'key')
          await withPageCancellation(page.page, signal, () => page.page.keyboard.press(key))
          return await this.observePage(owner, page, request.action, `Pressed ${key}`)
        }
        case 'scroll': {
          const page = this.activePage(owner)
          const deltaY = request.deltaY ?? 640
          if (!Number.isFinite(deltaY) || deltaY === 0) throw new Error('browser_control delta_y must be a finite non-zero number')
          await withPageCancellation(page.page, signal, () => page.page.mouse.wheel(0, deltaY))
          return await this.observePage(owner, page, request.action, `Scrolled ${String(deltaY)} pixels`)
        }
        case 'upload': {
          const paths = this.uploadPaths(request)
          return await this.targetAction(owner, request, signal, async target => target.locator.setInputFiles([...paths]))
        }
        case 'tabs': return await this.tabResult(owner, request.action, 'Listed browser tabs')
        case 'switch_tab': return await this.switchTab(owner, request, signal)
        case 'close_tab': return await this.closeTab(owner, request, signal)
        default: return assertNever(request.action)
      }
    })
  }

  /** Close the persistent browser context and clear all opaque handles. */
  async close(): Promise<void> {
    const context = this.context
    const launch = this.launch
    this.launchGeneration += 1
    this.context = undefined
    this.launch = undefined
    this.clearSessionState()
    this.operationTails.clear()
    if (context !== undefined) await closeBrowserContext(context)
    if (launch !== undefined) {
      let launched: BrowserContext | undefined
      try {
        launched = await launch
      } catch {
        // The caller awaiting this launch owns its startup error; disposal only waits for quiescence.
      }
      if (launched !== undefined && launched !== context) await closeBrowserContext(launched)
    }
  }

  private installTool(ctx: Context): void {
    ctx.tools.register(defineTool({
      name: 'browser_control',
      description: 'Control a dedicated visible browser using semantic page observations. Use open, then target only opaque IDs from the latest observation. Actions return a fresh observation automatically. Never guess target IDs. Use this tool for websites instead of computer_control. Private-network navigation, file uploads, submissions, payments, deletions, sends, and similar high-impact actions require one-time user approval.',
      parameters: {
        action: { type: 'string', enum: [...BROWSER_ACTIONS], required: true },
        url: { type: 'string', description: 'HTTP(S) URL for open.' },
        observation_id: { type: 'string', description: 'Latest observation ID for a target action.' },
        target_id: { type: 'string', description: 'Opaque target ID from that observation.' },
        value: { type: 'string', description: 'Text for fill or option label/value for select.' },
        key: { type: 'string', description: 'Playwright key such as Enter, Tab, or Control+L.' },
        delta_y: { type: 'number', description: 'Vertical scroll delta; positive moves down.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Absolute local file paths for upload.' },
        page_id: { type: 'string', description: 'Opaque page ID for switch_tab or close_tab.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: [...BROWSER_ACTIONS], required: true },
            summary: { type: 'string', required: true },
            pageId: { type: 'string' },
            url: { type: 'string' },
            title: { type: 'string' },
            observationId: { type: 'string' },
            text: { type: 'string' },
            targets: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  role: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  value: { type: 'string' },
                  disabled: { type: 'boolean', required: true },
                  checked: { type: 'boolean' },
                  actions: { type: 'array', items: { type: 'string' }, required: true },
                },
              },
            },
            tabs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  url: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  active: { type: 'boolean', required: true },
                },
              },
            },
            truncated: { type: 'boolean' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined) throw new Error('browser_control requires an owning agent session')
        const request: BrowserActionRequest = {
          action: args.action,
          ...args.url !== undefined ? { url: args.url } : {},
          ...args.observation_id !== undefined ? { observationId: BrowserObservationId(args.observation_id) } : {},
          ...args.target_id !== undefined ? { targetId: BrowserTargetId(args.target_id) } : {},
          ...args.value !== undefined ? { value: args.value } : {},
          ...args.key !== undefined ? { key: args.key } : {},
          ...args.delta_y !== undefined ? { deltaY: args.delta_y } : {},
          ...args.paths !== undefined ? { paths: args.paths } : {},
          ...args.page_id !== undefined ? { pageId: BrowserPageId(args.page_id) } : {},
        }
        const owner = exec.agent.id
        const reason = await this.approvalReason(owner, request)
        if (reason !== undefined) await this.requireApproval(ctx, exec, reason)
        return await this.run(owner, request, exec.signal)
      },
      presentCall: args => ({
        card: 'generic',
        title: `Browser: ${args.action}`,
        kind: args.action === 'observe' || args.action === 'tabs' ? 'read' : 'other',
        rawInput: args,
      }),
    }))
  }

  private async requireApproval(
    ctx: Context,
    exec: ToolRunContext,
    reason: string,
  ): Promise<void> {
    const approval = ctx.get('approval')
    if (approval === undefined) throw new Error(`${reason} requires approval, but no approval service is composed`)
    if (exec.agent === undefined) throw new Error(`${reason} requires an owning agent session`)
    const outcome = await approval.request({
      agent: exec.agent,
      toolName: exec.name,
      callId: exec.callId,
      reason,
      signal: exec.signal,
    })
    if (outcome === 'allowed-once') return
    if (outcome === 'rejected') throw new Error(`the user rejected: ${reason}`)
    if (outcome === 'cancelled') throw new Error(`approval was cancelled: ${reason}`)
    throw new Error(`approval is unavailable: ${reason}`)
  }

  private enqueue<T>(owner: SessionId, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(owner) ?? Promise.resolve()
    const result = previous.then(async () => {
      throwIfAborted(signal)
      return await operation()
    })
    const tail = result.then(() => {}, () => {})
    this.operationTails.set(owner, tail)
    void tail.then(() => {
      if (this.operationTails.get(owner) === tail) this.operationTails.delete(owner)
    })
    return result
  }

  private async browser(): Promise<BrowserContext> {
    if (this.context !== undefined) return this.context
    if (this.launch !== undefined) return await this.launch
    const generation = this.launchGeneration
    const launch = this.launchBrowser().then(async (context) => {
      if (generation !== this.launchGeneration || this.closedContexts.has(context)) {
        await closeBrowserContext(context)
        throw new Error('browser-control browser launch was cancelled or closed during startup')
      }
      this.context = context
      return context
    })
    this.launch = launch
    try {
      return await launch
    } finally {
      if (this.launch === launch) this.launch = undefined
    }
  }

  private async launchBrowser(): Promise<BrowserContext> {
    await mkdir(this.options.profileDir, { recursive: true })
    const common = {
      headless: this.options.headless,
      viewport: null,
      acceptDownloads: true,
      timeout: this.options.navigationTimeoutMs,
    } as const
    let context: BrowserContext | undefined
    try {
      context = await chromium.launchPersistentContext(this.options.profileDir, { ...common, channel: 'msedge' })
      this.ctx.logger.info('browser-control started Microsoft Edge')
    } catch (channelError) {
      const errors: unknown[] = [channelError]
      const installedEdge = await findWindowsEdgeExecutable()
      if (installedEdge !== undefined) {
        try {
          context = await chromium.launchPersistentContext(this.options.profileDir, {
            ...common,
            executablePath: installedEdge,
          })
          this.ctx.logger.info('browser-control started Microsoft Edge from %s', installedEdge)
        } catch (edgeError) {
          errors.push(edgeError)
        }
      }
      const configuredExecutable = this.options.executablePath
      if (context === undefined && configuredExecutable === undefined) {
        throw new AggregateError(errors, 'browser-control could not start the installed Microsoft Edge')
      }
      if (context === undefined && configuredExecutable !== undefined) {
        try {
          context = await chromium.launchPersistentContext(this.options.profileDir, {
            ...common,
            executablePath: configuredExecutable,
          })
          this.ctx.logger.info('browser-control started configured Chromium')
        } catch (chromiumError) {
          errors.push(chromiumError)
          throw new AggregateError(errors, 'browser-control could not start Microsoft Edge or the configured Chromium runtime')
        }
      }
    }
    if (context === undefined) throw new Error('browser-control launch completed without a browser context')
    context.on('close', () => { this.browserClosed(context) })
    try {
      context.setDefaultTimeout(this.options.actionTimeoutMs)
      context.setDefaultNavigationTimeout(this.options.navigationTimeoutMs)
      await context.route('**/*', async (route) => {
        try {
          await this.guardRoute(route)
        } catch (error) {
          this.ctx.logger.warn('browser-control blocked a request after route-policy failure: %s', String(error))
          try {
            await route.abort('blockedbyclient')
          } catch {
            // A page or browser closed while the failed route was being contained, so no live request remains to abort.
          }
        }
      })
      context.on('page', (page) => {
        void this.trackPopup(page).catch((error: unknown) => {
          this.ctx.logger.warn('browser-control could not track a new tab: %s', String(error))
        })
      })
      return context
    } catch (error) {
      await closeBrowserContext(context)
      throw error
    }
  }

  private browserClosed(context: BrowserContext): void {
    this.closedContexts.add(context)
    if (this.context !== context) return
    this.context = undefined
    this.clearSessionState()
  }

  private clearSessionState(): void {
    this.pages.clear()
    this.activePageByOwner.clear()
    this.observations.clear()
  }

  private async guardRoute(route: Route): Promise<void> {
    const request = route.request()
    let parsed: URL
    try {
      parsed = new URL(request.url())
    } catch {
      await route.abort('blockedbyclient')
      return
    }
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') {
      await route.continue()
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      await route.abort('blockedbyclient')
      return
    }
    const serviceWorker = request.serviceWorker()
    let source: Page | Worker
    if (serviceWorker !== null) {
      source = serviceWorker
    } else {
      try {
        source = request.frame().page()
      } catch {
        // A popup's first navigation can precede its Frame. Public traffic may continue, while an unowned private route fails closed.
        const destination = this.options.allowPrivateHosts ? undefined : await privateDestination(parsed.href)
        if (destination === undefined) await route.continue()
        else await route.abort('blockedbyclient')
        return
      }
    }
    const host = parsed.hostname.toLowerCase()
    const destination = this.options.allowPrivateHosts
      ? undefined
      : await this.destinationForSource(source, parsed.href)
    const approved = serviceWorker === null
      ? this.approvedPrivateHosts.get(source as Page)?.has(host) === true
      : this.serviceWorkerDestinationApproved(serviceWorker, host)
    if (destination !== undefined && !approved) {
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  }

  private async open(owner: SessionId, request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    const rawUrl = requireText(request.url, 'url')
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('browser_control open accepts only http:// and https:// URLs')
    }
    const destination = this.options.allowPrivateHosts ? undefined : await privateDestination(parsed.href)
    const context = await this.browser()
    const page = context.pages().find(candidate => candidate.url() === 'about:blank'
      && this.pageIds.get(candidate) === undefined) ?? await context.newPage()
    this.approvedPrivateHosts.set(page, destination === undefined
      ? new Set()
      : new Set([parsed.hostname.toLowerCase()]))
    const record = this.trackPage(owner, page)
    this.activePageByOwner.set(owner, record.id)
    try {
      await withPageCancellation(page, signal, () => page.goto(parsed.href, { waitUntil: 'domcontentloaded' }).then(() => {}))
      await page.bringToFront()
      return await this.observePage(owner, record, request.action, `Opened ${page.url()}`)
    } catch (error) {
      await closeBrowserPage(page)
      throw error
    }
  }

  private async observeActive(
    owner: SessionId,
    action: BrowserActionRequest['action'],
    signal: AbortSignal,
    summary: string,
  ): Promise<BrowserActionResult> {
    const page = this.activePage(owner)
    throwIfAborted(signal)
    return await this.observePage(owner, page, action, summary)
  }

  private async targetAction(
    owner: SessionId,
    request: BrowserActionRequest,
    signal: AbortSignal,
    action: (target: StoredTarget) => Promise<void>,
  ): Promise<BrowserActionResult> {
    const target = this.resolveTarget(owner, request)
    if (!target.target.actions.includes(request.action)) {
      throw new Error(`browser target does not support ${request.action}; use one of: ${target.target.actions.join(', ')}`)
    }
    const page = this.activePage(owner)
    this.observations.delete(BrowserObservationId(requireText(request.observationId, 'observation_id')))
    await withPageCancellation(page.page, signal, () => action(target))
    return await this.observePage(owner, page, request.action, `${request.action} completed on ${target.target.name || target.target.role}`)
  }

  private resolveTarget(owner: SessionId, request: BrowserActionRequest): StoredTarget {
    const observationId = BrowserObservationId(requireText(request.observationId, 'observation_id'))
    const targetId = BrowserTargetId(requireText(request.targetId, 'target_id'))
    const observation = this.observations.get(observationId)
    if (observation === undefined || observation.owner !== owner) {
      throw new Error('browser observation is missing or belongs to another session; observe again')
    }
    if (observation.expiresAt < Date.now()) {
      this.observations.delete(observationId)
      throw new Error('browser observation expired; observe again')
    }
    if (this.activePageByOwner.get(owner) !== observation.pageId) {
      this.observations.delete(observationId)
      throw new Error('browser observation is stale because the active tab changed; observe again')
    }
    const target = observation.targets.get(targetId)
    if (target === undefined) throw new Error('browser target is not part of that observation; observe again')
    return target
  }

  private async observePage(
    owner: SessionId,
    record: PageRecord,
    action: BrowserActionRequest['action'],
    summary: string,
  ): Promise<BrowserActionResult> {
    if (record.page.isClosed()) throw new Error('active browser tab closed; open or switch to another tab')
    const all = record.page.locator(INTERACTIVE_SELECTOR)
    const projection = await all.evaluateAll((elements, limit): ProjectionResult => {
      const output: ElementProjection[] = []
      const excludedFillTypes = new Set([
        'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'password', 'radio', 'range', 'reset', 'submit',
      ])
      let truncated = false
      for (let index = 0; index < elements.length && output.length < limit; index += 1) {
        const element = elements[index]
        if (!(element instanceof HTMLElement)) continue
        const style = getComputedStyle(element)
        const bounds = element.getBoundingClientRect()
        if (style.visibility === 'hidden' || style.display === 'none' || bounds.width <= 0 || bounds.height <= 0) continue
        const explicitRole = element.getAttribute('role')
        const tag = element.tagName.toLowerCase()
        const input = element instanceof HTMLInputElement ? element : undefined
        const inputType = input?.type.toLowerCase() ?? ''
        let role = explicitRole ?? ''
        if (role === '') {
          if (tag === 'a') role = 'link'
          else if (tag === 'textarea') role = 'textbox'
          else if (tag === 'select') role = 'combobox'
          else if (tag !== 'input') role = tag === 'button' ? 'button' : tag
          else if (inputType === 'checkbox' || inputType === 'radio' || inputType === 'button') role = inputType
          else if (inputType === 'submit') role = 'button'
          else if (inputType === 'file') role = 'file'
          else role = 'textbox'
        }
        let labelled = ''
        const labelledBy = element.getAttribute('aria-labelledby')
        if (labelledBy !== null) {
          for (const id of labelledBy.split(/\s+/u)) {
            const labelledElement = document.getElementById(id)
            const labelledText = labelledElement?.textContent
            if (labelledText !== undefined) {
              labelled += ` ${labelledText}`
            }
          }
        }
        let name = ''
        const candidates = [
          element.getAttribute('aria-label'), labelled, element.getAttribute('alt'), element.getAttribute('title'),
          element.getAttribute('placeholder'), element.innerText, element.textContent,
        ]
        for (const candidate of candidates) {
          const value = (candidate ?? '').replace(/\s+/gu, ' ').trim().slice(0, 160)
          if (value !== '') {
            name = value
            break
          }
        }
        const actions = inputType === 'file' ? [] : ['click']
        if ((element instanceof HTMLInputElement && !excludedFillTypes.has(inputType))
          || element instanceof HTMLTextAreaElement || element.isContentEditable) actions.push('fill')
        if (element instanceof HTMLSelectElement) actions.push('select')
        if (inputType === 'file') actions.push('upload')
        const value = inputType === 'password' ? undefined
          : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
            ? element.value.replace(/\s+/gu, ' ').trim().slice(0, 160)
            : undefined
        const checked = inputType === 'checkbox' || inputType === 'radio' ? Boolean(input?.checked) : undefined
        output.push({
          index,
          role,
          name,
          ...value !== undefined && value !== '' ? { value } : {},
          disabled: 'disabled' in element && Boolean(element.disabled),
          ...checked !== undefined ? { checked } : {},
          inputType,
          actions,
        })
      }
      if (output.length === limit) {
        for (let index = (output[output.length - 1]?.index ?? -1) + 1; index < elements.length; index += 1) {
          const element = elements[index]
          if (!(element instanceof HTMLElement)) continue
          const style = getComputedStyle(element)
          const bounds = element.getBoundingClientRect()
          if (style.visibility !== 'hidden' && style.display !== 'none' && bounds.width > 0 && bounds.height > 0) {
            truncated = true
            break
          }
        }
      }
      return { targets: output, truncated }
    }, this.options.maxTargets)
    const projected = projection.targets
    const observationId = BrowserObservationId(`bo-${randomUUID()}`)
    const targetMap = new Map<BrowserTargetId, StoredTarget>()
    const targets = projected.map((projection): BrowserTarget => {
      const id = BrowserTargetId(`bt-${randomUUID()}`)
      const target: BrowserTarget = {
        id,
        role: projection.role,
        name: projection.name,
        ...projection.value !== undefined ? { value: projection.value } : {},
        disabled: projection.disabled,
        ...projection.checked !== undefined ? { checked: projection.checked } : {},
        actions: projection.actions,
      }
      targetMap.set(id, { target, locator: all.nth(projection.index), inputType: projection.inputType })
      return target
    })
    for (const [id, observation] of this.observations) {
      if (observation.owner === owner) this.observations.delete(id)
    }
    this.observations.set(observationId, {
      id: observationId,
      owner,
      pageId: record.id,
      expiresAt: Date.now() + this.options.observationTtlMs,
      targets: targetMap,
    })
    const rawText = await record.page.locator('body').innerText().catch(() => '')
    const text = rawText.replace(/\r\n?/gu, '\n').slice(0, this.options.maxTextChars)
    return {
      action,
      summary,
      pageId: record.id,
      url: record.page.url(),
      title: await record.page.title().catch(() => ''),
      observationId,
      text,
      targets,
      truncated: rawText.length > this.options.maxTextChars || projection.truncated,
    }
  }

  private async tabResult(
    owner: SessionId,
    action: BrowserActionRequest['action'],
    summary: string,
  ): Promise<BrowserActionResult> {
    const tabs: BrowserPageSummary[] = []
    let truncated = false
    const active = this.activePageByOwner.get(owner)
    for (const record of this.pages.values()) {
      if (record.owner !== owner || record.page.isClosed()) continue
      if (tabs.length >= this.options.maxTabs) {
        truncated = true
        break
      }
      tabs.push({
        id: record.id,
        url: record.page.url(),
        title: await record.page.title().catch(() => ''),
        active: record.id === active,
      })
    }
    return { action, summary, tabs, truncated }
  }

  private async switchTab(owner: SessionId, request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    const pageId = BrowserPageId(requireText(request.pageId, 'page_id'))
    const record = this.pages.get(pageId)
    if (record === undefined || record.owner !== owner || record.page.isClosed()) throw new Error('browser tab is missing or belongs to another session')
    throwIfAborted(signal)
    this.activePageByOwner.set(owner, pageId)
    await record.page.bringToFront()
    return await this.observePage(owner, record, request.action, 'Switched browser tab')
  }

  private async closeTab(owner: SessionId, request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    const pageId = request.pageId ?? this.activePageByOwner.get(owner)
    if (pageId === undefined) throw new Error('browser_control close_tab has no active tab')
    const record = this.pages.get(pageId)
    if (record === undefined || record.owner !== owner) throw new Error('browser tab is missing or belongs to another session')
    await withPageCancellation(record.page, signal, () => record.page.close({ runBeforeUnload: false }))
    this.dropPage(record.page)
    return await this.tabResult(owner, request.action, 'Closed browser tab')
  }

  private trackPage(owner: SessionId, page: Page): PageRecord {
    const record: PageRecord = { id: BrowserPageId(`bp-${randomUUID()}`), owner, page }
    this.pages.set(record.id, record)
    this.pageIds.set(page, record.id)
    page.on('close', () => { this.dropPage(page) })
    return record
  }

  private async trackPopup(page: Page): Promise<void> {
    const opener = await page.opener()
    const openerId = opener === null ? undefined : this.pageIds.get(opener)
    const owner = openerId === undefined ? undefined : this.pages.get(openerId)?.owner
    if (owner === undefined || this.pageIds.has(page)) return
    const record = this.trackPage(owner, page)
    this.activePageByOwner.set(owner, record.id)
  }

  private dropPage(page: Page): void {
    const pageId = this.pageIds.get(page)
    if (pageId === undefined) return
    const record = this.pages.get(pageId)
    this.pages.delete(pageId)
    if (record === undefined) return
    for (const [id, observation] of this.observations) {
      if (observation.pageId === pageId) this.observations.delete(id)
    }
    if (this.activePageByOwner.get(record.owner) !== pageId) return
    const replacement = [...this.pages.values()].find(candidate => candidate.owner === record.owner && !candidate.page.isClosed())
    if (replacement === undefined) this.activePageByOwner.delete(record.owner)
    else this.activePageByOwner.set(record.owner, replacement.id)
  }

  private activePage(owner: SessionId): PageRecord {
    const id = this.activePageByOwner.get(owner)
    const record = id === undefined ? undefined : this.pages.get(id)
    if (record === undefined || record.owner !== owner || record.page.isClosed()) {
      throw new Error('no active browser tab; call browser_control with action open first')
    }
    return record
  }

  private uploadPaths(request: BrowserActionRequest): readonly string[] {
    const paths = request.paths
    if (paths === undefined || paths.length === 0
      || paths.some(path => path.trim() === '' || !isAbsolute(path))) {
      throw new Error('browser_control upload requires one or more non-empty absolute paths')
    }
    return paths
  }

  private serviceWorkerDestinationApproved(worker: Worker, host: string): boolean {
    let workerOrigin: string
    try {
      workerOrigin = new URL(worker.url()).origin
    } catch {
      return false
    }
    return [...this.pages.values()].some((record) => {
      if (record.page.isClosed() || this.approvedPrivateHosts.get(record.page)?.has(host) !== true) return false
      try {
        return new URL(record.page.url()).origin === workerOrigin
      } catch {
        return false
      }
    })
  }

  private destinationForSource(source: Page | Worker, url: string): Promise<string | undefined> {
    const host = new URL(url).hostname.toLowerCase()
    let checks = this.destinationChecks.get(source)
    if (checks === undefined) {
      checks = new Map()
      this.destinationChecks.set(source, checks)
    }
    const existing = checks.get(host)
    if (existing !== undefined) return existing
    const check = privateDestination(url)
    checks.set(host, check)
    return check
  }
}

export default BrowserControl
