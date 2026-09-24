/**
 * Xiaojing Edge browser automation: a managed Playwright route, an optional authenticated personal-Edge route, and one
 * model-facing semantic tool.
 * @module @deepseek-ai/dsh-xiaojing-browser-control
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { access } from 'node:fs/promises'
import { isIP } from 'node:net'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-credentials'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ElementHandle, Frame, Page, Route, Worker } from 'playwright-core'
import {
  ManagedEdgeAdapter,
  findWindowsEdgeExecutable,
  withManagedPageCancellation,
  type ManagedPageRecord,
} from './managed-edge.ts'
import {
  PersonalEdgeAdapter,
  type PersonalActionCommand,
  type PersonalPageRecord,
  type PersonalTargetDescriptor,
} from './personal-edge.ts'
import {
  resolveObservedElement,
  resolveSemanticElement,
  scanSemanticPage,
  type SemanticTargetDescriptor,
} from './semantic-dom.ts'
import {
  BROWSER_ACTIONS,
  BROWSER_STEP_ACTIONS,
  BrowserObservationId,
  BrowserPageId,
  BrowserTargetId,
  BrowserWindowId,
} from './types.ts'
import type {
  BrowserAction,
  BrowserActionRequest,
  BrowserActionResult,
  BrowserActStep,
  BrowserControlStatus,
  BrowserFailedStep,
  BrowserPageSummary,
  BrowserSemanticTarget,
  BrowserStepAction,
  BrowserSurface,
  BrowserTarget,
  BrowserTargetId as TargetId,
} from './types.ts'

export {
  BROWSER_ACTIONS,
  BROWSER_STEP_ACTIONS,
  BrowserObservationId,
  BrowserPageId,
  BrowserTargetId,
  BrowserWindowId,
} from './types.ts'
export type {
  BrowserAction,
  BrowserActionRequest,
  BrowserActionResult,
  BrowserActStep,
  BrowserControlStatus,
  BrowserDisposition,
  BrowserPageSummary,
  BrowserSemanticTarget,
  BrowserStepAction,
  BrowserSurface,
  BrowserSurfacePreference,
  BrowserTarget,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    xiaojingBrowserControl: BrowserControl
  }
}

/** Browser runtime configuration. */
export interface Config {
  /** Dedicated persistent Microsoft Edge profile directory; never use a person's normal browser profile. */
  profileDir: string
  /** Explicit Edge-compatible executable used by tests or a controlled deployment. */
  executablePath?: string
  /** Absolute unpacked personal Edge extension directory exposed by the settings action. */
  extensionDir?: string
  /** Whether to hide the dedicated Edge window. Xiaojing ships with this disabled. */
  headless?: boolean
  /** Playwright operation timeout. */
  actionTimeoutMs?: number
  /** Page navigation timeout. */
  navigationTimeoutMs?: number
  /** Lifetime of opaque observation targets. */
  observationTtlMs?: number
  /** Maximum semantic targets returned per observation. */
  maxTargets?: number
  /** Maximum discoverable pages returned by `tabs`. */
  maxTabs?: number
  /** Maximum visible page characters returned per explicit observation. */
  maxTextChars?: number
  /** Maximum ordered operations in one `act` request. */
  maxActSteps?: number
  /** Whether private and loopback destinations are allowed without approval. Intended only for tests. */
  allowPrivateHosts?: boolean
}

interface ResolvedConfig {
  readonly profileDir: string
  readonly executablePath?: string
  readonly extensionDir: string
  readonly headless: boolean
  readonly actionTimeoutMs: number
  readonly navigationTimeoutMs: number
  readonly observationTtlMs: number
  readonly maxTargets: number
  readonly maxTabs: number
  readonly maxTextChars: number
  readonly maxActSteps: number
  readonly allowPrivateHosts: boolean
}

interface ManagedPage {
  readonly surface: 'managed'
  readonly key: string
  readonly record: ManagedPageRecord
  readonly url: string
  readonly title: string
  readonly active: boolean
  readonly internalWindowId: string
}

interface PersonalPage {
  readonly surface: 'personal'
  readonly key: string
  readonly record: PersonalPageRecord
  readonly url: string
  readonly title: string
  readonly active: boolean
  readonly internalWindowId: string
}

type UnifiedPage = ManagedPage | PersonalPage

interface SessionAliases {
  readonly pageByInternal: Map<string, ReturnType<typeof BrowserPageId>>
  readonly internalByPage: Map<ReturnType<typeof BrowserPageId>, string>
  readonly windowByInternal: Map<string, ReturnType<typeof BrowserWindowId>>
}

interface ManagedStoredTarget {
  readonly surface: 'managed'
  readonly target: BrowserTarget
  readonly inputType: string
  readonly frame: Frame
  readonly descriptor: SemanticTargetDescriptor
}

interface PersonalStoredTarget {
  readonly surface: 'personal'
  readonly target: BrowserTarget
  readonly inputType: string
  readonly descriptor: PersonalTargetDescriptor
}

type StoredTarget = ManagedStoredTarget | PersonalStoredTarget

interface Observation {
  readonly id: ReturnType<typeof BrowserObservationId>
  readonly owner: SessionId
  readonly pageKey: string
  readonly expiresAt: number
  readonly targets: ReadonlyMap<TargetId, StoredTarget>
}

interface PageLease {
  readonly owner: SessionId
  readonly turn?: number
}

interface OperationScope {
  readonly owner: SessionId
  readonly turn?: number
  readonly claimed: Set<string>
}

interface ApprovalRequirement {
  readonly reason: string
  readonly mandatory: boolean
}

type BrowserRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: 'internal'; readonly message: string; readonly details: Record<string, never> } }

const HIGH_IMPACT_PATTERNS = [
  /\b(?:submit|send|publish|post|save|approve|pay|purchase|buy|transfer|sign)\b|confirm order/iu,
  /提交|发送|发布|保存|支付|购买|转账|签署|下单/iu,
  /(?:^|\s)(?:审批|通过)(?:\s|$)/iu,
] as const
const DELETION_PATTERN = /(?:delete|remove|uninstall|erase|删除|移除|卸载|清空)/iu
const DEFAULT_PERSONAL_EXTENSION_DIR = fileURLToPath(new URL('../extension/', import.meta.url))

/** Schemastery configuration for the browser-control capability. */
export const Config: z<Config> = z.object({
  profileDir: z.string().required(),
  executablePath: z.string(),
  extensionDir: z.string(),
  headless: z.boolean().default(false),
  actionTimeoutMs: z.number().min(100).max(120_000).default(15_000),
  navigationTimeoutMs: z.number().min(100).max(180_000).default(30_000),
  observationTtlMs: z.number().min(1_000).max(600_000).default(120_000),
  maxTargets: z.number().min(1).max(1_000).default(160),
  maxTabs: z.number().min(1).max(500).default(50),
  maxTextChars: z.number().min(256).max(100_000).default(20_000),
  maxActSteps: z.number().min(1).max(100).default(40),
  allowPrivateHosts: z.boolean().default(false),
})

function resolveConfig(config: Config): ResolvedConfig {
  const executablePath = config.executablePath?.trim()
  const configuredExtensionDir = config.extensionDir?.trim()
  const extensionDir = configuredExtensionDir === undefined || configuredExtensionDir === ''
    ? DEFAULT_PERSONAL_EXTENSION_DIR
    : configuredExtensionDir
  if (!isAbsolute(extensionDir)) throw new Error('browser-control extensionDir must be an absolute path')
  return {
    profileDir: config.profileDir,
    ...(executablePath === undefined || executablePath === '' ? {} : { executablePath }),
    extensionDir,
    headless: config.headless ?? false,
    actionTimeoutMs: config.actionTimeoutMs ?? 15_000,
    navigationTimeoutMs: config.navigationTimeoutMs ?? 30_000,
    observationTtlMs: config.observationTtlMs ?? 120_000,
    maxTargets: config.maxTargets ?? 160,
    maxTabs: config.maxTabs ?? 50,
    maxTextChars: config.maxTextChars ?? 20_000,
    maxActSteps: config.maxActSteps ?? 40,
    allowPrivateHosts: config.allowPrivateHosts ?? false,
  }
}

function ok<T>(value: T): BrowserRpcResult<T> {
  return { ok: true, value }
}

function failed(error: unknown): BrowserRpcResult<never> {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function assertEmptyPayload(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || Object.keys(payload).length !== 0) {
    throw new Error('browser-control RPC payload must be an empty object')
  }
}

function requireText(value: string | undefined, field: string): string {
  const resolved = value?.trim()
  if (resolved === undefined || resolved === '') throw new Error(`browser_control ${field} must be a non-empty string`)
  return resolved
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('browser operation cancelled')
}

function assertNever(value: never): never {
  throw new Error(`unsupported browser action ${String(value)}`)
}

function samePageDestination(current: string, requested: URL): boolean {
  try {
    const currentUrl = new URL(current)
    const target = new URL(requested.href)
    currentUrl.hash = ''
    target.hash = ''
    return currentUrl.href === target.href
  } catch {
    return false
  }
}

function samePageOrigin(current: string, requested: URL): boolean {
  try {
    const parsed = new URL(current)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === requested.origin
  } catch {
    return false
  }
}

function isWebsiteHome(url: URL): boolean {
  return (url.pathname === '' || url.pathname === '/') && url.search === ''
}

function isBlankBrowserPage(url: string): boolean {
  return url === 'about:blank' || url === 'edge://newtab/' || url === 'edge://new-tab-page/'
}

function pageKey(surface: BrowserSurface, id: string): string {
  return `${surface}:${id}`
}

function targetLabel(target: StoredTarget | undefined, semantic: BrowserSemanticTarget | undefined): string {
  if (target !== undefined) return `${target.target.name} ${target.target.role} ${target.inputType}`.trim()
  return `${semantic?.name ?? ''} ${semantic?.role ?? ''} ${semantic?.context ?? ''}`.trim()
}

function actionNeedsTarget(action: BrowserStepAction): boolean {
  return action !== 'press' && action !== 'scroll' && action !== 'wait_for'
}

function validateSemanticTarget(target: BrowserSemanticTarget | undefined): BrowserSemanticTarget | undefined {
  if (target === undefined) return undefined
  const role = target.role?.trim()
  const name = target.name?.trim()
  const context = target.context?.trim()
  if ((role ?? '') === '' && (name ?? '') === '' && (context ?? '') === '') {
    throw new Error('browser_control semantic target must include role, name, or context')
  }
  return {
    ...(role === undefined || role === '' ? {} : { role }),
    ...(name === undefined || name === '' ? {} : { name }),
    ...(context === undefined || context === '' ? {} : { context }),
  }
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
  const [first, second] = ipv4.split('.').map(Number)
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

/** DOM-first Edge automation coordinator and model-facing tool consumer. */
export class BrowserControl extends Service {
  static inject = ['tools', 'credentials', 'connection', 'webServer']
  static Config = Config

  private readonly options: ResolvedConfig
  private readonly managed: ManagedEdgeAdapter
  private readonly personal: PersonalEdgeAdapter
  private readonly personalReady: Promise<void>
  private readonly aliases = new Map<SessionId, SessionAliases>()
  private readonly activePageByOwner = new Map<SessionId, string>()
  private readonly observations = new Map<ReturnType<typeof BrowserObservationId>, Observation>()
  private readonly leases = new Map<string, PageLease>()
  private readonly currentTurnByOwner = new Map<SessionId, number>()
  private readonly operationTails = new Map<SessionId, Promise<void>>()
  private readonly approvedPersonalPrivateHosts = new Map<SessionId, Set<string>>()
  private readonly approvedPrivateHosts = new WeakMap<Page, ReadonlySet<string>>()
  private readonly destinationChecks = new WeakMap<Page | Worker, Map<string, Promise<string | undefined>>>()
  private lifecycle = new AbortController()
  private closeTask: Promise<void> | undefined
  private closing = false
  private disposed = false

  /** Create both Edge routes, the loopback settings interface, and `browser_control`. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'xiaojingBrowserControl')
    this.options = resolveConfig(config)
    this.managed = new ManagedEdgeAdapter(ctx, this.options, route => this.guardRoute(route))
    this.personal = new PersonalEdgeAdapter(ctx, this.options.extensionDir)
    this.personalReady = this.personal.start().catch((error: unknown) => {
      this.personal.reportStartupFailure(error)
      ctx.logger.warn('browser-control personal Edge bridge unavailable: %s', error instanceof Error ? error.message : String(error))
    })
    ctx.effect(() => ctx.connection.rpc.handle(
      '/xiaojing-browser-control',
      (endpoint: string, payload: unknown) => this.handleRpc(endpoint, payload),
    ), 'xiaojing-browser-control: loopback RPC')
    ctx.on('session/event', (session, event: SessionEvent) => {
      const owner = session.header.id
      if (event.type === 'turn/start') this.currentTurnByOwner.set(owner, event.data.turn)
      if (event.type === 'turn/end' && this.currentTurnByOwner.get(owner) === event.data.turn) {
        this.currentTurnByOwner.delete(owner)
        void this.releaseTurn(owner, event.data.turn)
      }
    })
    ctx.effect(() => async () => this.shutdown(), 'xiaojing-browser-control: lifecycle')
    this.installTool(ctx)
  }

  /**
   * Return the current managed and personal Edge status without exposing credentials.
   * @returns Sanitized route and extension state.
   */
  status(): BrowserControlStatus {
    return this.personal.snapshot(this.managed.running)
  }

  /**
   * Explain whether one request requires a one-shot user approval.
   * @param owner - Agent session making the request.
   * @param request - Validated semantic browser operation.
   * @returns Approval reason, or undefined for a read or low-risk edit.
   */
  async approvalReason(owner: SessionId, request: BrowserActionRequest): Promise<string | undefined> {
    return (await this.approvalRequirement(owner, request))?.reason
  }

  /**
   * Execute one unprotected browser operation for an owning session; protected requests must use the registered tool.
   * @param owner - Agent session making the request.
   * @param request - Browser operation.
   * @param signal - Cancellation signal.
   * @returns Bounded semantic result.
   */
  async run(owner: SessionId, request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    const requirement = await this.approvalRequirement(owner, request)
    if (requirement !== undefined) {
      throw new Error(`${requirement.reason} requires execution through the browser_control approval path`)
    }
    return await this.runApproved(owner, request, signal)
  }

  private runApproved(owner: SessionId, request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    if (this.disposed) return Promise.reject(new Error('browser_control is unavailable because its plugin was unloaded'))
    if (this.closing) return Promise.reject(new Error('browser_control is closing; retry after the browser has closed'))
    const operationSignal = AbortSignal.any([signal, this.lifecycle.signal])
    return this.enqueue(owner, operationSignal, async () => {
      const turn = this.currentTurnByOwner.get(owner)
      const scope: OperationScope = { owner, ...(turn === undefined ? {} : { turn }), claimed: new Set() }
      try {
        throwIfAborted(operationSignal)
        const result = await this.execute(scope, request, operationSignal)
        throwIfAborted(operationSignal)
        if (scope.turn === undefined) await this.releaseScope(scope)
        return result
      } catch (error) {
        await this.releaseScope(scope)
        throw error
      }
    })
  }

  /** Close the dedicated Edge process while leaving the optional extension bridge available. */
  async close(): Promise<void> {
    if (this.closeTask !== undefined) {
      await this.closeTask
      return
    }
    this.closing = true
    const task = this.closeManagedNow()
    this.closeTask = task
    try {
      await task
    } finally {
      if (this.closeTask === task) {
        this.closeTask = undefined
        this.closing = false
        if (!this.disposed) this.lifecycle = new AbortController()
      }
    }
  }

  private async execute(scope: OperationScope, request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    switch (request.action) {
      case 'open': return await this.open(scope, request, signal)
      case 'observe': return await this.observeActive(scope, request.action, signal, 'Observed current Edge page')
      case 'act': return await this.batch(scope, request, signal)
      case 'click':
      case 'fill':
      case 'type':
      case 'select':
      case 'check':
      case 'uncheck':
      case 'hover':
      case 'press':
      case 'scroll':
      case 'upload':
      case 'wait_for':
        return await this.singleAction(scope, request, signal)
      case 'show': return await this.show(scope, signal)
      case 'tabs': return await this.listTabs(scope.owner, request.action)
      case 'switch_tab': return await this.switchTab(scope, request, signal)
      case 'close_tab': return await this.closeTab(scope, request, signal)
      default: return assertNever(request.action)
    }
  }

  private async open(scope: OperationScope, request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    const rawUrl = requireText(request.url, 'url')
    const target = new URL(rawUrl)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('browser_control open accepts only http:// and https:// URLs')
    }
    throwIfAborted(signal)
    const selected = await this.selectOpenPage(scope, target, request, signal)
    this.activePageByOwner.set(scope.owner, selected.page.key)
    if (selected.navigate) {
      if (selected.page.surface === 'personal') {
        throw new Error('browser_control cannot navigate an unrelated personal Edge tab; open created the wrong route')
      }
      const managedPage = selected.page.record.page
      const privateHost = this.options.allowPrivateHosts ? undefined : await privateDestination(target.href)
      this.approvedPrivateHosts.set(managedPage, privateHost === undefined
        ? new Set()
        : new Set([target.hostname.toLowerCase()]))
      await withManagedPageCancellation(managedPage, signal, async () => {
        await managedPage.goto(target.href, { waitUntil: 'domcontentloaded' })
      })
    }
    if (selected.page.surface === 'managed') await this.closeUnusedManagedBlanks(selected.page.key, signal)
    const summary = selected.reused
      ? `Using existing ${selected.page.surface} Edge page ${target.href}`
      : `Opened ${target.href} in ${selected.page.surface} Edge`
    return await this.observePage(scope, await this.refreshPage(selected.page), request.action, summary)
  }

  private async selectOpenPage(
    scope: OperationScope,
    target: URL,
    request: BrowserActionRequest,
    signal: AbortSignal,
  ): Promise<{ page: UnifiedPage; reused: boolean; navigate: boolean }> {
    const surface = request.surface ?? 'auto'
    const disposition = request.disposition ?? 'reuse'
    if (disposition === 'new_window') {
      const created = surface === 'personal'
        ? this.personalPage(await this.personal.open(target.href, disposition))
        : await this.managedPage(await this.managed.create(disposition, signal))
      await this.acquire(scope, created)
      return { page: created, reused: false, navigate: created.surface === 'managed' }
    }
    const pages = (await this.catalog()).filter(page => (
      (surface === 'auto' || page.surface === surface) && this.availableTo(scope.owner, page.key)
    ))
    const activeKey = this.activePageByOwner.get(scope.owner)
    const sessionActive = activeKey === undefined ? undefined : pages.find(page => page.key === activeKey)
    let page = sessionActive !== undefined && samePageDestination(sessionActive.url, target)
      ? sessionActive
      : pages.find(candidate => candidate.surface === 'personal' && candidate.active
        && samePageDestination(candidate.url, target))
    page ??= pages.find(candidate => samePageDestination(candidate.url, target))
    if (page === undefined && isWebsiteHome(target)) page = pages.find(candidate => samePageOrigin(candidate.url, target))
    if (page !== undefined) {
      await this.acquire(scope, page)
      return { page, reused: true, navigate: false }
    }
    if (surface === 'personal') {
      const opened = this.personalPage(await this.personal.open(target.href, 'reuse'))
      await this.acquire(scope, opened)
      return { page: opened, reused: false, navigate: false }
    }
    const managed = pages.filter((candidate): candidate is ManagedPage => candidate.surface === 'managed')
    page = managed.find(candidate => samePageOrigin(candidate.url, target))
      ?? managed.find(candidate => isBlankBrowserPage(candidate.url))
    if (page === undefined) page = await this.managedPage(await this.managed.create('reuse', signal))
    await this.acquire(scope, page)
    return { page, reused: false, navigate: !samePageDestination(page.url, target) }
  }

  private async observeActive(
    scope: OperationScope,
    action: BrowserAction,
    signal: AbortSignal,
    summary: string,
  ): Promise<BrowserActionResult> {
    const page = await this.activePage(scope.owner)
    await this.acquire(scope, page)
    throwIfAborted(signal)
    return await this.observePage(scope, page, action, summary)
  }

  private async observePage(
    scope: OperationScope,
    page: UnifiedPage,
    action: BrowserAction,
    summary: string,
  ): Promise<BrowserActionResult> {
    this.dropOwnerObservations(scope.owner)
    const observationId = BrowserObservationId(`bo-${randomUUID()}`)
    const targets = new Map<TargetId, StoredTarget>()
    let text: string
    let url: string
    let title: string
    let truncated: boolean
    if (page.surface === 'managed') {
      const scan = await scanSemanticPage(page.record.page, this.options.maxTargets, this.options.maxTextChars)
      text = scan.text
      url = page.record.page.url()
      title = await page.record.page.title()
      truncated = scan.truncated
      for (const candidate of scan.targets) {
        const id = BrowserTargetId(`bt-${randomUUID()}`)
        const target: BrowserTarget = { id, ...candidate.target }
        targets.set(id, {
          surface: 'managed', target, inputType: candidate.descriptor.inputType,
          frame: candidate.frame, descriptor: candidate.descriptor,
        })
      }
    } else {
      await this.requireApprovedPersonalDestination(scope.owner, page)
      await this.personal.acquire(page.record)
      const scan = await this.personal.observe(page.record, this.options.maxTargets, this.options.maxTextChars)
      text = scan.text
      url = scan.url
      title = scan.title
      truncated = scan.truncated
      for (const candidate of scan.targets) {
        const id = BrowserTargetId(`bt-${randomUUID()}`)
        const target: BrowserTarget = { id, ...candidate.target }
        targets.set(id, {
          surface: 'personal', target, inputType: candidate.descriptor.inputType, descriptor: candidate.descriptor,
        })
      }
    }
    this.observations.set(observationId, {
      id: observationId, owner: scope.owner, pageKey: page.key,
      expiresAt: Date.now() + this.options.observationTtlMs, targets,
    })
    const identity = this.publicIdentity(scope.owner, page)
    return {
      action,
      summary,
      surface: page.surface,
      pageId: identity.pageId,
      windowId: identity.windowId,
      url,
      title,
      observationId,
      text,
      targets: [...targets.values()].map(target => target.target),
      ...(truncated ? { truncated: true } : {}),
    }
  }

  private async singleAction(
    scope: OperationScope,
    request: BrowserActionRequest,
    signal: AbortSignal,
  ): Promise<BrowserActionResult> {
    const page = await this.activePage(scope.owner)
    await this.acquire(scope, page)
    const step = this.requestStep(request)
    const before = await this.catalog()
    await this.executeStep(scope.owner, page, step, request.observationId, signal)
    throwIfAborted(signal)
    const current = await this.followNewPage(scope, page, before)
    this.dropOwnerObservations(scope.owner)
    return await this.compactResult(scope.owner, current, request.action, `${request.action} completed`)
  }

  private async batch(
    scope: OperationScope,
    request: BrowserActionRequest,
    signal: AbortSignal,
  ): Promise<BrowserActionResult> {
    const steps = request.steps
    if (steps === undefined || steps.length === 0) throw new Error('browser_control act requires at least one step')
    if (steps.length > this.options.maxActSteps) {
      throw new Error(`browser_control act accepts at most ${String(this.options.maxActSteps)} steps`)
    }
    let page = await this.activePage(scope.owner)
    await this.acquire(scope, page)
    let completed = 0
    let failedStep: BrowserFailedStep | undefined
    for (const [index, step] of steps.entries()) {
      throwIfAborted(signal)
      const before = await this.catalog()
      try {
        await this.executeStep(scope.owner, page, step, request.observationId, signal)
        completed += 1
        page = await this.followNewPage(scope, page, before)
      } catch (error) {
        failedStep = { index, action: step.action, error: error instanceof Error ? error.message : String(error) }
        break
      }
    }
    const result = await this.observePage(
      scope,
      page,
      request.action,
      failedStep === undefined
        ? `Completed ${String(completed)} browser actions`
        : `Stopped after ${String(completed)} browser actions`,
    )
    return { ...result, completedSteps: completed, ...(failedStep === undefined ? {} : { failedStep }) }
  }

  private requestStep(request: BrowserActionRequest): BrowserActStep {
    if (!BROWSER_STEP_ACTIONS.includes(request.action as BrowserStepAction)) {
      throw new Error(`browser_control ${request.action} is not a page action`)
    }
    return {
      action: request.action as BrowserStepAction,
      ...(request.targetId === undefined ? {} : { targetId: request.targetId }),
      ...(request.target === undefined ? {} : { target: request.target }),
      ...(request.value === undefined ? {} : { value: request.value }),
      ...(request.key === undefined ? {} : { key: request.key }),
      ...(request.deltaY === undefined ? {} : { deltaY: request.deltaY }),
      ...(request.paths === undefined ? {} : { paths: request.paths }),
      ...(request.url === undefined ? {} : { expectedUrl: request.url }),
      ...(request.expectedText === undefined ? {} : { expectedText: request.expectedText }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    }
  }

  private async executeStep(
    owner: SessionId,
    page: UnifiedPage,
    step: BrowserActStep,
    observationId: ReturnType<typeof BrowserObservationId> | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const semantic = validateSemanticTarget(step.target)
    const stored = step.targetId === undefined
      ? undefined
      : this.resolveStoredTarget(owner, observationId, step.targetId, page.key)
    if (actionNeedsTarget(step.action) && stored === undefined && semantic === undefined) {
      throw new Error(`browser_control ${step.action} requires target_id or a semantic target`)
    }
    if (stored !== undefined && !stored.target.actions.includes(step.action) && actionNeedsTarget(step.action)) {
      throw new Error(`browser target does not support ${step.action}; use one of: ${stored.target.actions.join(', ')}`)
    }
    if (page.surface === 'managed') {
      await this.executeManagedStep(page.record.page, step, stored, semantic, signal)
    } else {
      await this.requireApprovedPersonalDestination(owner, page)
      if (stored !== undefined && stored.surface !== 'personal') {
        throw new Error('browser target belongs to another Edge route; observe again')
      }
      const command: PersonalActionCommand = {
        action: step.action,
        ...(stored?.surface === 'personal' ? { descriptor: stored.descriptor } : {}),
        ...(semantic === undefined ? {} : { semantic }),
        ...(step.value === undefined ? {} : { value: step.value }),
        ...(step.key === undefined ? {} : { key: step.key }),
        ...(step.deltaY === undefined ? {} : { deltaY: step.deltaY }),
        ...(step.paths === undefined ? {} : { paths: this.uploadPaths(step.paths) }),
        ...(step.expectedUrl === undefined ? {} : { expectedUrl: step.expectedUrl }),
        ...(step.expectedText === undefined ? {} : { expectedText: step.expectedText }),
        ...(step.timeoutMs === undefined ? {} : { timeoutMs: this.stepTimeout(step.timeoutMs) }),
      }
      throwIfAborted(signal)
      await this.personal.act(page.record, command, signal)
      throwIfAborted(signal)
    }
  }

  private async executeManagedStep(
    page: Page,
    step: BrowserActStep,
    stored: StoredTarget | undefined,
    semantic: BrowserSemanticTarget | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    if (stored !== undefined && stored.surface !== 'managed') {
      throw new Error('browser target belongs to another Edge route; observe again')
    }
    const timeout = this.stepTimeout(step.timeoutMs)
    if (step.action === 'wait_for') {
      await withManagedPageCancellation(page, signal, async () => {
        if (semantic !== undefined) await this.waitForSemantic(page, semantic, timeout)
        await this.verifyExpectedPage(page, step, timeout)
      })
      return
    }
    let element: ElementHandle<HTMLElement> | undefined
    try {
      if (stored?.surface === 'managed') element = await resolveObservedElement(stored.frame, stored.descriptor)
      else if (semantic !== undefined) element = await this.resolveManagedSemantic(page, semantic, timeout)
      let dialogMessage: string | undefined
      const onDialog = (dialog: { message(): string; dismiss(): Promise<void> }) => {
        dialogMessage = dialog.message()
        void dialog.dismiss()
      }
      page.on('dialog', onDialog)
      try {
        await withManagedPageCancellation(page, signal, async () => {
          switch (step.action) {
            case 'click': await this.requiredElement(element, step.action).click(); break
            case 'fill': {
              const value = step.value ?? ''
              const target = this.requiredElement(element, step.action)
              await target.fill(value)
              if (await this.elementValue(target) !== value) throw new Error('browser fill verification failed')
              break
            }
            case 'type': {
              const value = requireText(step.value, 'value')
              const target = this.requiredElement(element, step.action)
              const previous = await this.elementValue(target)
              // ElementHandle has no locator equivalent without synthesizing a selector for the semantically resolved node.
              // oxlint-disable-next-line typescript/no-deprecated
              await target.type(value)
              if (await this.elementValue(target) !== `${previous}${value}`) throw new Error('browser type verification failed')
              break
            }
            case 'select': {
              const value = requireText(step.value, 'value')
              const target = this.requiredElement(element, step.action)
              let selected = await target.selectOption({ label: value })
              if (selected.length === 0) selected = await target.selectOption(value)
              if (selected.length === 0) throw new Error(`browser select option ${value} is missing`)
              break
            }
            case 'check': {
              const target = this.requiredElement(element, step.action)
              await target.check()
              if (!await target.isChecked()) throw new Error('browser check verification failed')
              break
            }
            case 'uncheck': {
              const target = this.requiredElement(element, step.action)
              await target.uncheck()
              if (await target.isChecked()) throw new Error('browser uncheck verification failed')
              break
            }
            case 'hover': await this.requiredElement(element, step.action).hover(); break
            case 'press': {
              const key = requireText(step.key, 'key')
              if (element === undefined) await page.keyboard.press(key)
              else await element.press(key)
              break
            }
            case 'scroll': {
              const deltaY = step.deltaY ?? 640
              if (!Number.isFinite(deltaY) || deltaY === 0) {
                throw new Error('browser_control delta_y must be a finite non-zero number')
              }
              if (element !== undefined) await element.scrollIntoViewIfNeeded()
              await page.mouse.wheel(0, deltaY)
              break
            }
            case 'upload':
              await this.requiredElement(element, step.action).setInputFiles([...this.uploadPaths(step.paths)])
              break
            case 'wait_for': throw new Error('browser_control internal wait_for dispatch failure')
            default: return assertNever(step.action)
          }
          await this.verifyExpectedPage(page, step, timeout)
        })
      } finally {
        page.off('dialog', onDialog)
      }
      if (dialogMessage !== undefined) {
        throw new Error(`website opened a JavaScript dialog (${dialogMessage}); it was dismissed for safety`)
      }
    } finally {
      await element?.dispose().catch(() => undefined)
    }
  }

  private async followNewPage(
    scope: OperationScope,
    previous: UnifiedPage,
    before: readonly UnifiedPage[],
  ): Promise<UnifiedPage> {
    const beforeKeys = new Set(before.map(page => page.key))
    const after = await this.catalog()
    let created: UnifiedPage | undefined
    for (const candidate of after) {
      if (beforeKeys.has(candidate.key) || candidate.surface !== previous.surface
        || !this.availableTo(scope.owner, candidate.key)) continue
      if (candidate.surface === 'personal' && previous.surface === 'personal'
        && candidate.record.openerTabId === previous.record.tabId) {
        created = candidate
        break
      }
      if (candidate.surface === 'managed' && previous.surface === 'managed'
        && await candidate.record.page.opener().catch(() => null) === previous.record.page) {
        created = candidate
        break
      }
    }
    const current = created ?? after.find(page => page.key === previous.key) ?? previous
    if (created !== undefined) await this.acquire(scope, created)
    this.activePageByOwner.set(scope.owner, current.key)
    return current
  }

  private async show(scope: OperationScope, signal: AbortSignal): Promise<BrowserActionResult> {
    const page = await this.activePage(scope.owner)
    await this.acquire(scope, page)
    throwIfAborted(signal)
    if (page.surface === 'managed') await this.managed.show(page.record)
    else await this.personal.show(page.record)
    return await this.observePage(scope, await this.refreshPage(page), 'show', 'Displayed the selected Edge page')
  }

  private async listTabs(owner: SessionId, action: BrowserAction): Promise<BrowserActionResult> {
    const pages = await this.catalog()
    const bounded = pages.slice(0, this.options.maxTabs)
    return {
      action,
      summary: `Found ${String(pages.length)} Edge page(s)`,
      tabs: bounded.map(page => this.pageSummary(owner, page)),
      ...(pages.length > bounded.length ? { truncated: true } : {}),
    }
  }

  private async switchTab(
    scope: OperationScope,
    request: BrowserActionRequest,
    signal: AbortSignal,
  ): Promise<BrowserActionResult> {
    const page = await this.pageFromPublicId(scope.owner, request.pageId)
    await this.acquire(scope, page)
    this.activePageByOwner.set(scope.owner, page.key)
    throwIfAborted(signal)
    return await this.observePage(scope, page, request.action, `Selected ${page.surface} Edge page ${page.url}`)
  }

  private async closeTab(
    scope: OperationScope,
    request: BrowserActionRequest,
    signal: AbortSignal,
  ): Promise<BrowserActionResult> {
    const page = request.pageId === undefined
      ? await this.activePage(scope.owner)
      : await this.pageFromPublicId(scope.owner, request.pageId)
    await this.acquire(scope, page)
    if (page.surface === 'managed') await this.managed.closePage(page.record, signal)
    else await this.personal.closePage(page.record)
    await this.releaseKey(page.key)
    this.dropPageObservations(page.key)
    if (this.activePageByOwner.get(scope.owner) === page.key) this.activePageByOwner.delete(scope.owner)
    return await this.listTabs(scope.owner, request.action)
  }

  private async compactResult(
    owner: SessionId,
    page: UnifiedPage,
    action: BrowserAction,
    summary: string,
  ): Promise<BrowserActionResult> {
    const refreshed = await this.refreshPage(page)
    if (refreshed.surface === 'personal') await this.requireApprovedPersonalDestination(owner, refreshed)
    const identity = this.publicIdentity(owner, refreshed)
    return {
      action, summary, surface: refreshed.surface, pageId: identity.pageId, windowId: identity.windowId,
      url: refreshed.url, title: refreshed.title,
    }
  }

  private async closeUnusedManagedBlanks(selectedKey: string, signal: AbortSignal): Promise<void> {
    const records = await this.managed.pages(false)
    for (const record of records) {
      const key = pageKey('managed', String(record.id))
      if (key === selectedKey || this.leases.has(key) || !isBlankBrowserPage(record.page.url())) continue
      await this.managed.closePage(record, signal)
    }
  }

  private async approvalRequirement(owner: SessionId, request: BrowserActionRequest): Promise<ApprovalRequirement | undefined> {
    if (request.action === 'open') {
      if (this.options.allowPrivateHosts) return undefined
      const destination = await privateDestination(requireText(request.url, 'url'))
      return destination === undefined ? undefined : {
        reason: `Open private or local browser destination ${destination}`,
        mandatory: false,
      }
    }
    const steps = request.action === 'act'
      ? request.steps ?? []
      : BROWSER_STEP_ACTIONS.includes(request.action as BrowserStepAction)
        ? [this.requestStep(request)]
        : []
    let ordinary = request.action === 'tabs' || request.action === 'close_tab'
      ? undefined
      : await this.personalPrivateApprovalReason(owner)
    let mandatory: string | undefined
    for (const step of steps) {
      const stored = step.targetId === undefined
        ? undefined
        : this.resolveStoredTarget(owner, request.observationId, step.targetId)
      const label = targetLabel(stored, step.target)
      if (step.action === 'upload') ordinary ??= `Upload ${String(this.uploadPaths(step.paths).length)} local file(s) to the current website`
      if (step.action === 'press' && requireText(step.key, 'key').toLowerCase() === 'delete') {
        mandatory ??= 'Send the destructive Delete key to the current website'
      }
      if (DELETION_PATTERN.test(label)) mandatory ??= `Activate destructive browser control “${label}”`
      else if (HIGH_IMPACT_PATTERNS.some(pattern => pattern.test(label))) {
        ordinary ??= `Activate external-impact browser control “${label}”`
      }
    }
    if (mandatory !== undefined) return { reason: mandatory, mandatory: true }
    return ordinary === undefined ? undefined : { reason: ordinary, mandatory: true }
  }

  private async personalPrivateApprovalReason(owner: SessionId): Promise<string | undefined> {
    const key = this.activePageByOwner.get(owner)
    if (key === undefined || !key.startsWith('personal:')) return undefined
    const page = (await this.catalog()).find(candidate => candidate.key === key)
    if (page?.surface !== 'personal') return undefined
    const destination = this.options.allowPrivateHosts ? undefined : await privateDestination(page.url)
    if (destination === undefined) return undefined
    const host = new URL(page.url).hostname.toLowerCase()
    return this.approvedPersonalPrivateHosts.get(owner)?.has(host) === true
      ? undefined
      : `Read or operate private or local personal Edge destination ${destination}`
  }

  private async rememberApprovedPersonalDestination(owner: SessionId, request: BrowserActionRequest): Promise<void> {
    let url: string | undefined
    if (request.action === 'open') url = request.url
    else {
      const key = this.activePageByOwner.get(owner)
      if (key?.startsWith('personal:') === true) {
        const page = (await this.catalog()).find(candidate => candidate.key === key)
        if (page?.surface === 'personal') url = page.url
      }
    }
    if (url === undefined || this.options.allowPrivateHosts || await privateDestination(url) === undefined) return
    const host = new URL(url).hostname.toLowerCase()
    let approved = this.approvedPersonalPrivateHosts.get(owner)
    if (approved === undefined) {
      approved = new Set()
      this.approvedPersonalPrivateHosts.set(owner, approved)
    }
    approved.add(host)
  }

  private async requireApprovedPersonalDestination(owner: SessionId, page: PersonalPage): Promise<void> {
    if (this.options.allowPrivateHosts) return
    const destination = await privateDestination(page.url)
    if (destination === undefined) return
    const host = new URL(page.url).hostname.toLowerCase()
    if (this.approvedPersonalPrivateHosts.get(owner)?.has(host) === true) return
    throw new Error(`private or local personal Edge destination ${destination} requires approval`)
  }

  private installTool(ctx: Context): void {
    const semanticTargetSchema = {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        role: { type: 'string' as const },
        name: { type: 'string' as const },
        context: { type: 'string' as const },
      },
    }
    const stepSchema = {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        action: { type: 'string' as const, enum: [...BROWSER_STEP_ACTIONS], required: true as const },
        target_id: { type: 'string' as const },
        target: semanticTargetSchema,
        value: { type: 'string' as const },
        key: { type: 'string' as const },
        delta_y: { type: 'number' as const },
        paths: { type: 'array' as const, items: { type: 'string' as const } },
        expected_url: { type: 'string' as const },
        expected_text: { type: 'string' as const },
        timeout_ms: { type: 'integer' as const },
      },
    }
    ctx.tools.register(defineTool({
      name: 'browser_control',
      description: [
        'Control Microsoft Edge through DOM semantics. Use open once: it first reuses a matching existing page across',
        'the managed and paired personal Edge routes, and starts the dedicated Edge only when no match exists.',
        'Use act for a form or menu sequence so the browser completes several validated steps in one call. Use opaque',
        'target IDs from observe, or exact role/name/context semantics for controls revealed by an earlier act step.',
        'Never guess IDs, repeatedly reopen the same site, use screenshot coordinates, or fall back to computer_control',
        'for webpage operations. surface=personal is valid only when the user explicitly asks for personal Edge.',
      ].join(' '),
      parameters: {
        action: { type: 'string', enum: [...BROWSER_ACTIONS], required: true },
        url: { type: 'string', description: 'HTTP(S) destination for open, or expected URL for wait_for.' },
        surface: { type: 'string', enum: ['auto', 'managed', 'personal'], description: 'Default auto. Force only from an explicit user request.' },
        disposition: { type: 'string', enum: ['reuse', 'new_window'], description: 'Default reuse. Use new_window only when explicitly requested.' },
        observation_id: { type: 'string', description: 'Latest observation ID for opaque target IDs.' },
        target_id: { type: 'string', description: 'Opaque target ID from that observation.' },
        target: semanticTargetSchema,
        value: { type: 'string', description: 'Text for fill/type/select.' },
        key: { type: 'string', description: 'Playwright key such as Enter, Tab, or Escape.' },
        delta_y: { type: 'number', description: 'Vertical scroll delta; positive moves down.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Absolute local paths for upload.' },
        page_id: { type: 'string', description: 'Session-scoped page ID for switch_tab or close_tab.' },
        steps: { type: 'array', items: stepSchema, description: 'Bounded ordered semantic actions for act.' },
        expected_text: { type: 'string', description: 'Visible text expected by wait_for.' },
        timeout_ms: { type: 'integer', description: 'Per-operation wait bound in milliseconds.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: [...BROWSER_ACTIONS], required: true },
            summary: { type: 'string', required: true },
            surface: { type: 'string', enum: ['managed', 'personal'] },
            pageId: { type: 'string' },
            windowId: { type: 'string' },
            url: { type: 'string' },
            title: { type: 'string' },
            observationId: { type: 'string' },
            text: { type: 'string' },
            targets: {
              type: 'array', items: {
                type: 'object', additionalProperties: false, properties: {
                  id: { type: 'string', required: true },
                  role: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  context: { type: 'string' },
                  value: { type: 'string' },
                  disabled: { type: 'boolean', required: true },
                  checked: { type: 'boolean' },
                  actions: { type: 'array', items: { type: 'string' }, required: true },
                },
              },
            },
            tabs: {
              type: 'array', items: {
                type: 'object', additionalProperties: false, properties: {
                  id: { type: 'string', required: true },
                  surface: { type: 'string', enum: ['managed', 'personal'], required: true },
                  windowId: { type: 'string', required: true },
                  url: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  active: { type: 'boolean', required: true },
                },
              },
            },
            completedSteps: { type: 'integer' },
            failedStep: {
              type: 'object', additionalProperties: false, properties: {
                index: { type: 'integer', required: true },
                action: { type: 'string', enum: [...BROWSER_STEP_ACTIONS], required: true },
                error: { type: 'string', required: true },
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
          ...(args.url === undefined ? {} : { url: args.url }),
          ...(args.surface === undefined ? {} : { surface: args.surface }),
          ...(args.disposition === undefined ? {} : { disposition: args.disposition }),
          ...(args.observation_id === undefined ? {} : { observationId: BrowserObservationId(args.observation_id) }),
          ...(args.target_id === undefined ? {} : { targetId: BrowserTargetId(args.target_id) }),
          ...(args.target === undefined ? {} : { target: args.target }),
          ...(args.value === undefined ? {} : { value: args.value }),
          ...(args.key === undefined ? {} : { key: args.key }),
          ...(args.delta_y === undefined ? {} : { deltaY: args.delta_y }),
          ...(args.paths === undefined ? {} : { paths: args.paths }),
          ...(args.page_id === undefined ? {} : { pageId: BrowserPageId(args.page_id) }),
          ...(args.steps === undefined ? {} : {
            steps: args.steps.map(step => ({
              action: step.action,
              ...(step.target_id === undefined ? {} : { targetId: BrowserTargetId(step.target_id) }),
              ...(step.target === undefined ? {} : { target: step.target }),
              ...(step.value === undefined ? {} : { value: step.value }),
              ...(step.key === undefined ? {} : { key: step.key }),
              ...(step.delta_y === undefined ? {} : { deltaY: step.delta_y }),
              ...(step.paths === undefined ? {} : { paths: step.paths }),
              ...(step.expected_url === undefined ? {} : { expectedUrl: step.expected_url }),
              ...(step.expected_text === undefined ? {} : { expectedText: step.expected_text }),
              ...(step.timeout_ms === undefined ? {} : { timeoutMs: step.timeout_ms }),
            })),
          }),
          ...(args.expected_text === undefined ? {} : { expectedText: args.expected_text }),
          ...(args.timeout_ms === undefined ? {} : { timeoutMs: args.timeout_ms }),
        }
        const approval = await this.approvalRequirement(exec.agent.id, request)
        if (approval !== undefined) {
          await this.requireApproval(ctx, exec, approval)
          await this.rememberApprovedPersonalDestination(exec.agent.id, request)
        }
        return await this.runApproved(exec.agent.id, request, exec.signal)
      },
      presentCall: args => ({
        card: 'generic', title: `Edge: ${args.action}`,
        kind: args.action === 'observe' || args.action === 'tabs' ? 'read' : 'other', rawInput: args,
      }),
    }))
  }

  private async requireApproval(ctx: Context, exec: ToolRunContext, requirement: ApprovalRequirement): Promise<void> {
    const approval = ctx.get('approval')
    if (approval === undefined) throw new Error(`${requirement.reason} requires approval, but no approval service is composed`)
    if (exec.agent === undefined) throw new Error(`${requirement.reason} requires an owning agent session`)
    const request = { agent: exec.agent, toolName: exec.name, callId: exec.callId, reason: requirement.reason, signal: exec.signal }
    const outcome = requirement.mandatory ? await approval.requestMandatory(request) : await approval.request(request)
    if (outcome === 'allowed-once') return
    if (outcome === 'rejected') throw new Error(`the user rejected: ${requirement.reason}`)
    if (outcome === 'cancelled') throw new Error(`approval was cancelled: ${requirement.reason}`)
    throw new Error(`approval is unavailable: ${requirement.reason}`)
  }

  private enqueue<T>(owner: SessionId, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(owner) ?? Promise.resolve()
    const result = previous.then(async () => {
      throwIfAborted(signal)
      const value = await operation()
      throwIfAborted(signal)
      return value
    })
    const tail = result.then(() => {}, () => {})
    this.operationTails.set(owner, tail)
    void tail.then(() => { if (this.operationTails.get(owner) === tail) this.operationTails.delete(owner) })
    return result
  }

  private async catalog(): Promise<UnifiedPage[]> {
    const [managed, personal] = await Promise.all([
      this.managed.pages(false),
      this.personal.pages().catch((error: unknown) => {
        this.ctx.logger.debug('browser-control personal Edge discovery unavailable: %s', error instanceof Error ? error.message : String(error))
        return []
      }),
    ])
    return [...await Promise.all(managed.map(record => this.managedPage(record))), ...personal.map(record => this.personalPage(record))]
  }

  private async managedPage(record: ManagedPageRecord): Promise<ManagedPage> {
    return {
      surface: 'managed', key: pageKey('managed', String(record.id)), record, url: record.page.url(),
      title: await record.page.title().catch(() => ''), active: false, internalWindowId: String(await record.windowId),
    }
  }

  private personalPage(record: PersonalPageRecord): PersonalPage {
    return {
      surface: 'personal', key: pageKey('personal', String(record.id)), record, url: record.url,
      title: record.title, active: record.active, internalWindowId: String(record.windowId),
    }
  }

  private async refreshPage(page: UnifiedPage): Promise<UnifiedPage> {
    if (page.surface === 'managed') return await this.managedPage(page.record)
    const current = (await this.personal.pages()).find(candidate => candidate.tabId === page.record.tabId)
    if (current === undefined) throw new Error('personal Edge page was closed or became unavailable')
    return this.personalPage(current)
  }

  private async activePage(owner: SessionId): Promise<UnifiedPage> {
    const key = this.activePageByOwner.get(owner)
    const page = key === undefined ? undefined : (await this.catalog()).find(candidate => candidate.key === key)
    if (page === undefined) throw new Error('no active Edge page; call browser_control with action open first')
    return page
  }

  private async pageFromPublicId(owner: SessionId, id: ReturnType<typeof BrowserPageId> | undefined): Promise<UnifiedPage> {
    const publicId = BrowserPageId(requireText(id, 'page_id'))
    const key = this.aliases.get(owner)?.internalByPage.get(publicId)
    const page = key === undefined ? undefined : (await this.catalog()).find(candidate => candidate.key === key)
    if (page === undefined) throw new Error('browser page is missing or belongs to another session; call tabs again')
    return page
  }

  private sessionAliases(owner: SessionId): SessionAliases {
    let aliases = this.aliases.get(owner)
    if (aliases !== undefined) return aliases
    aliases = { pageByInternal: new Map(), internalByPage: new Map(), windowByInternal: new Map() }
    this.aliases.set(owner, aliases)
    return aliases
  }

  private publicIdentity(owner: SessionId, page: UnifiedPage): {
    readonly pageId: ReturnType<typeof BrowserPageId>
    readonly windowId: ReturnType<typeof BrowserWindowId>
  } {
    const aliases = this.sessionAliases(owner)
    let pageId = aliases.pageByInternal.get(page.key)
    if (pageId === undefined) {
      pageId = BrowserPageId(`bp-${randomUUID()}`)
      aliases.pageByInternal.set(page.key, pageId)
      aliases.internalByPage.set(pageId, page.key)
    }
    let windowId = aliases.windowByInternal.get(page.internalWindowId)
    if (windowId === undefined) {
      windowId = BrowserWindowId(`bw-${randomUUID()}`)
      aliases.windowByInternal.set(page.internalWindowId, windowId)
    }
    return { pageId, windowId }
  }

  private pageSummary(owner: SessionId, page: UnifiedPage): BrowserPageSummary {
    const identity = this.publicIdentity(owner, page)
    return {
      id: identity.pageId, surface: page.surface, windowId: identity.windowId,
      url: page.url, title: page.title, active: this.activePageByOwner.get(owner) === page.key,
    }
  }

  private availableTo(owner: SessionId, key: string): boolean {
    const lease = this.leases.get(key)
    return lease === undefined || lease.owner === owner
  }

  private async acquire(scope: OperationScope, page: UnifiedPage): Promise<void> {
    const lease = this.leases.get(page.key)
    if (lease !== undefined && (lease.owner !== scope.owner || lease.turn !== scope.turn)) {
      throw new Error('the selected Edge page is busy with another task; choose another page or wait for that task to finish')
    }
    if (lease === undefined) {
      this.leases.set(page.key, { owner: scope.owner, ...(scope.turn === undefined ? {} : { turn: scope.turn }) })
      if (page.surface === 'personal') {
        try {
          await this.personal.acquire(page.record)
        } catch (error) {
          this.leases.delete(page.key)
          throw error
        }
      }
    }
    scope.claimed.add(page.key)
  }

  private async releaseScope(scope: OperationScope): Promise<void> {
    await Promise.allSettled([...scope.claimed].map(key => this.releaseKey(key, scope.owner, scope.turn)))
    scope.claimed.clear()
  }

  private async releaseTurn(owner: SessionId, turn: number): Promise<void> {
    const keys = [...this.leases.entries()]
      .filter(([, lease]) => lease.owner === owner && lease.turn === turn)
      .map(([key]) => key)
    await Promise.allSettled(keys.map(key => this.releaseKey(key, owner, turn)))
  }

  private async releaseKey(key: string, owner?: SessionId, turn?: number): Promise<void> {
    const lease = this.leases.get(key)
    if (lease === undefined) return
    if (owner !== undefined && (lease.owner !== owner || lease.turn !== turn)) return
    this.leases.delete(key)
    if (!key.startsWith('personal:')) return
    const record = (await this.personal.pages().catch(() => []))
      .find(candidate => pageKey('personal', String(candidate.id)) === key)
    if (record !== undefined) await this.personal.release(record)
  }

  private resolveStoredTarget(
    owner: SessionId,
    observationId: ReturnType<typeof BrowserObservationId> | undefined,
    targetId: TargetId,
    expectedPageKey?: string,
  ): StoredTarget {
    const id = BrowserObservationId(requireText(observationId, 'observation_id'))
    const observation = this.observations.get(id)
    if (observation === undefined || observation.owner !== owner) {
      throw new Error('browser observation is missing or belongs to another session; observe again')
    }
    if (observation.expiresAt < Date.now()) {
      this.observations.delete(id)
      throw new Error('browser observation expired; observe again')
    }
    if (expectedPageKey !== undefined && observation.pageKey !== expectedPageKey) {
      throw new Error('browser observation belongs to another page; observe again')
    }
    const target = observation.targets.get(targetId)
    if (target === undefined) throw new Error('browser target is missing from this observation; observe again')
    return target
  }

  private dropOwnerObservations(owner: SessionId): void {
    for (const [id, observation] of this.observations) if (observation.owner === owner) this.observations.delete(id)
  }

  private dropPageObservations(key: string): void {
    for (const [id, observation] of this.observations) if (observation.pageKey === key) this.observations.delete(id)
  }

  private async resolveManagedSemantic(
    page: Page,
    semantic: BrowserSemanticTarget,
    timeout: number,
  ): Promise<ElementHandle<HTMLElement>> {
    const immediate = await this.findManagedSemantic(page, semantic)
    if (immediate !== undefined) return immediate
    await this.waitForSemantic(page, semantic, timeout)
    const resolved = await this.findManagedSemantic(page, semantic)
    if (resolved === undefined) throw new Error('semantic browser target is missing or ambiguous; observe again')
    return resolved
  }

  private async findManagedSemantic(page: Page, semantic: BrowserSemanticTarget): Promise<ElementHandle<HTMLElement> | undefined> {
    const found: ElementHandle<HTMLElement>[] = []
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue
      const element = await resolveSemanticElement(frame, semantic).catch(() => undefined)
      if (element !== undefined) found.push(element)
    }
    if (found.length === 1) return found[0]
    await Promise.allSettled(found.map(element => element.dispose()))
    return undefined
  }

  private async waitForSemantic(page: Page, semantic: BrowserSemanticTarget, timeout: number): Promise<void> {
    const waits = page.frames().filter(frame => !frame.isDetached()).map(async (frame) => {
      if (semantic.role !== undefined) {
        await frame.getByRole(semantic.role as Parameters<Frame['getByRole']>[0], {
          ...(semantic.name === undefined ? {} : { name: semantic.name, exact: true }),
        }).first().waitFor({ state: 'visible', timeout })
        return
      }
      if (semantic.name !== undefined) {
        await frame.getByText(semantic.name, { exact: true }).first().waitFor({ state: 'visible', timeout })
        return
      }
      throw new Error('context-only semantic targets require an observation target ID')
    })
    if (waits.length === 0) throw new Error('browser page has no live frame')
    try {
      await Promise.any(waits)
    } catch {
      throw new Error('semantic browser target did not appear before the timeout')
    }
  }

  private requiredElement(element: ElementHandle<HTMLElement> | undefined, action: BrowserStepAction): ElementHandle<HTMLElement> {
    if (element === undefined) throw new Error(`browser_control ${action} requires a target`)
    return element
  }

  private async elementValue(element: ElementHandle<HTMLElement>): Promise<string> {
    return await element.evaluate((node) => {
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return node.value
      return node.textContent
    })
  }

  private async verifyExpectedPage(page: Page, step: BrowserActStep, timeout: number): Promise<void> {
    if (step.expectedUrl !== undefined) {
      const expected = step.expectedUrl
      await page.waitForURL(url => url.href.includes(expected), { timeout })
    }
    if (step.expectedText !== undefined) {
      await page.getByText(step.expectedText, { exact: false }).first().waitFor({ state: 'visible', timeout })
    }
  }

  private stepTimeout(value: number | undefined): number {
    const timeout = value ?? this.options.actionTimeoutMs
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120_000) {
      throw new Error('browser_control timeout_ms must be an integer from 100 to 120000')
    }
    return timeout
  }

  private uploadPaths(paths: readonly string[] | undefined): readonly string[] {
    if (paths === undefined || paths.length === 0 || paths.some(path => path.trim() === '' || !isAbsolute(path))) {
      throw new Error('browser_control upload requires one or more non-empty absolute paths')
    }
    return paths
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
    if (serviceWorker !== null) source = serviceWorker
    else {
      try {
        source = request.frame().page()
      } catch {
        const destination = this.options.allowPrivateHosts ? undefined : await privateDestination(parsed.href)
        if (destination === undefined) await route.continue()
        else await route.abort('blockedbyclient')
        return
      }
    }
    const host = parsed.hostname.toLowerCase()
    const destination = this.options.allowPrivateHosts ? undefined : await this.destinationForSource(source, parsed.href)
    const approved = serviceWorker === null
      ? this.approvedPrivateHosts.get(source as Page)?.has(host) === true
      : await this.serviceWorkerDestinationApproved(serviceWorker, host)
    if (destination !== undefined && !approved) await route.abort('blockedbyclient')
    else await route.continue()
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

  private async serviceWorkerDestinationApproved(worker: Worker, host: string): Promise<boolean> {
    let origin: string
    try {
      origin = new URL(worker.url()).origin
    } catch {
      return false
    }
    const records = await this.managed.pages(false)
    return records.some((record) => {
      if (record.page.isClosed() || this.approvedPrivateHosts.get(record.page)?.has(host) !== true) return false
      try {
        return new URL(record.page.url()).origin === origin
      } catch {
        return false
      }
    })
  }

  private async handleRpc(endpoint: string, payload: unknown): Promise<BrowserRpcResult<unknown>> {
    try {
      await this.personalReady
      switch (endpoint) {
        case 'status':
          assertEmptyPayload(payload)
          return ok(this.status())
        case 'pairing/start':
          assertEmptyPayload(payload)
          this.personal.startPairing()
          return ok(this.status())
        case 'pairing/cancel':
          assertEmptyPayload(payload)
          this.personal.cancelPairing()
          return ok(this.status())
        case 'disconnect':
          assertEmptyPayload(payload)
          await this.personal.disconnect()
          return ok(this.status())
        case 'extension/reveal':
          assertEmptyPayload(payload)
          await this.revealExtension()
          return ok(this.status())
        case 'extension/open-manager':
          assertEmptyPayload(payload)
          await this.openExtensionManager()
          return ok(this.status())
        default:
          throw new Error(`unknown browser-control operation: ${endpoint}`)
      }
    } catch (error) {
      this.ctx.logger.warn('browser-control RPC %s failed: %s', endpoint, error instanceof Error ? error.message : String(error))
      return failed(error)
    }
  }

  private async revealExtension(): Promise<void> {
    if (process.platform !== 'win32') throw new Error('the extension folder can only be opened automatically on Windows')
    await access(this.personal.extensionDir)
    const quotedPath = `'${this.personal.extensionDir.replaceAll("'", "''")}'`
    await runNativeCommand(
      'powershell.exe',
      ['-NoProfile', '-Command', `Invoke-Item -LiteralPath ${quotedPath}`],
      AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(10_000)]),
    )
  }

  private async openExtensionManager(): Promise<void> {
    if (process.platform !== 'win32') throw new Error('the Edge extension manager can only be opened automatically on Windows')
    const executable = this.options.executablePath ?? await findWindowsEdgeExecutable()
    if (executable === undefined) throw new Error('Microsoft Edge is not installed')
    const child = spawn(executable, ['edge://extensions'], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
  }

  private async closeManagedNow(): Promise<void> {
    const operations = [...new Set(this.operationTails.values())]
    this.lifecycle.abort(new Error('browser_control operation cancelled because managed Edge was closed'))
    this.operationTails.clear()
    await Promise.allSettled(operations)
    await Promise.allSettled([...this.leases.keys()].map(key => this.releaseKey(key)))
    this.leases.clear()
    this.observations.clear()
    this.activePageByOwner.clear()
    await this.managed.close()
  }

  private async shutdown(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.close()
    await this.personalReady
    await this.personal.close()
    this.aliases.clear()
    this.currentTurnByOwner.clear()
    this.approvedPersonalPrivateHosts.clear()
  }
}

export default BrowserControl
