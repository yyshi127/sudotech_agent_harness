/**
 * Xiaojing Windows computer-control capability using the operating system's UI Automation tree and a persistent PowerShell
 * helper. No OCR, coordinates, external drivers, or arbitrary shell commands are exposed to the model.
 * @module @deepseek-ai/dsh-xiaojing-computer-control
 */

import { Buffer } from 'node:buffer'
import { gzipSync } from 'node:zlib'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { WINDOWS_UIA_HELPER } from './helper-script.ts'
import {
  COMPUTER_ACTIONS,
  ComputerAppId,
  ComputerObservationId,
  ComputerTargetId,
  ComputerWindowId,
} from './types.ts'
import type {
  ComputerApp,
  ComputerActionRequest,
  ComputerActionResult,
  ComputerTarget,
  ComputerWindow,
} from './types.ts'

export {
  COMPUTER_ACTIONS,
  ComputerAppId,
  ComputerObservationId,
  ComputerTargetId,
  ComputerWindowId,
} from './types.ts'
export type {
  ComputerApp,
  ComputerAction,
  ComputerActionRequest,
  ComputerActionResult,
  ComputerTarget,
  ComputerWindow,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    xiaojingComputerControl: ComputerControl
  }
}

/** Windows computer-control configuration. */
export interface Config {
  /** Windows PowerShell executable name or absolute path. */
  powershellPath?: string
  /** Maximum duration of one helper request. */
  requestTimeoutMs?: number
  /** Process-tree termination grace. */
  processGraceMs?: number
  /** Lifetime of a UI Automation observation. */
  observationTtlMs?: number
  /** Maximum elements returned from one UI Automation tree walk. */
  maxTargets?: number
  /** Maximum installed applications returned from one catalog query. */
  maxApps?: number
  /** Maximum top-level windows returned from one listing. */
  maxWindows?: number
  /** Maximum UI Automation tree depth. */
  maxDepth?: number
  /** Maximum wait action duration. */
  maxWaitMs?: number
  /** Maximum time to wait for a launched application's visible window. */
  launchWaitMs?: number
  /** Poll interval used by the helper's semantic wait action. */
  waitPollMs?: number
  /** Maximum buffered helper protocol line length. */
  maxProtocolLineBytes?: number
}

interface ResolvedConfig {
  powershellPath: string
  requestTimeoutMs: number
  processGraceMs: number
  observationTtlMs: number
  maxTargets: number
  maxApps: number
  maxWindows: number
  maxDepth: number
  maxWaitMs: number
  launchWaitMs: number
  waitPollMs: number
  maxProtocolLineBytes: number
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

interface ObservationState {
  readonly owner: SessionId
  readonly id: ComputerObservationId
  readonly expiresAt: number
  readonly targets: ReadonlyMap<ComputerTargetId, ComputerTarget>
}

interface ApplicationCatalogState {
  readonly owner: SessionId
  readonly expiresAt: number
  readonly apps: ReadonlyMap<ComputerAppId, ComputerApp>
}

type HelperRequestId = Branded<'ComputerHelperRequestId'>

/** Brand one private request id at the helper process protocol boundary. */
function HelperRequestId(id: string): HelperRequestId {
  return id as HelperRequestId
}

const HIGH_IMPACT_PATTERN = new RegExp(
  '(?:delete|remove|uninstall|pay|purchase|buy|submit|send|publish|post|transfer|sign|close account'
  + '|install|run|open|save|export|upload|attach|download|删除|移除|卸载|支付|购买|提交|发送|发布'
  + '|转账|签署|注销|安装|运行|打开|保存|导出|上传|附件|下载)',
  'iu',
)
const HIGH_IMPACT_APP_PATTERN = new RegExp(
  '(?:\\buninstall\\b|\\binstaller?\\b|\\bsetup\\b|\\bpowershell\\b|\\bterminal\\b|\\bcommand prompt\\b'
  + '|\\bcmd\\b|\\bregistry\\b|\\bregedit\\b|卸载|安装|终端|命令提示符|注册表|管理工具|安全策略|防火墙|恢复驱动器|磁盘清理|计算机管理)',
  'iu',
)
const SAFE_KEYS = new Set(['{TAB}', '+{TAB}', '{ESC}', '{UP}', '{DOWN}', '{LEFT}', '{RIGHT}', '{PGUP}', '{PGDN}', '{HOME}', '{END}'])

/** Schemastery configuration for Windows computer control. */
export const Config: z<Config> = z.object({
  powershellPath: z.string().default('powershell.exe'),
  requestTimeoutMs: z.number().min(250).max(120_000).default(15_000),
  processGraceMs: z.number().min(100).max(30_000).default(1_000),
  observationTtlMs: z.number().min(1_000).max(600_000).default(120_000),
  maxTargets: z.number().min(1).max(1_000).default(240),
  maxApps: z.number().min(1).max(500).default(60),
  maxWindows: z.number().min(1).max(1_000).default(100),
  maxDepth: z.number().min(1).max(32).default(8),
  maxWaitMs: z.number().min(100).max(120_000).default(15_000),
  launchWaitMs: z.number().min(100).max(30_000).default(5_000),
  waitPollMs: z.number().min(25).max(5_000).default(100),
  maxProtocolLineBytes: z.number().min(1_024).max(10_000_000).default(1_000_000),
})

/** Resolve a required non-empty string field. */
function requireText(value: string | undefined, field: string): string {
  const resolved = value?.trim()
  if (resolved === undefined || resolved === '') throw new Error(`computer_control ${field} must be a non-empty string`)
  return resolved
}

/** Throw the signal's reason or a stable cancellation error. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('computer operation cancelled')
}

/** Reject a computer action omitted from a closed action switch. */
function assertNever(value: never): never {
  throw new Error(`unsupported computer action ${String(value)}`)
}

/** Validate a helper-projected window. */
function parseWindow(value: unknown): ComputerWindow {
  if (typeof value !== 'object' || value === null) throw new Error('computer helper returned an invalid window')
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.title !== 'string' || !Number.isInteger(item.processId)) {
    throw new Error('computer helper returned an invalid window')
  }
  return { id: ComputerWindowId(item.id), title: item.title, processId: item.processId as number }
}

/** Validate a helper-projected installed application. */
function parseApp(value: unknown): ComputerApp {
  if (typeof value !== 'object' || value === null) throw new Error('computer helper returned an invalid application')
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.name !== 'string') {
    throw new Error('computer helper returned an invalid application')
  }
  return { id: ComputerAppId(item.id), name: item.name }
}

/** Validate a helper-projected UI Automation target. */
function parseTarget(value: unknown): ComputerTarget {
  if (typeof value !== 'object' || value === null) throw new Error('computer helper returned an invalid target')
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.controlType !== 'string' || typeof item.name !== 'string'
    || typeof item.enabled !== 'boolean' || !Array.isArray(item.actions)
    || item.actions.some(action => typeof action !== 'string')) {
    throw new Error(
      `computer helper returned an invalid target (id=${typeof item.id}, controlType=${typeof item.controlType}, `
      + `name=${typeof item.name}, enabled=${typeof item.enabled}, actions=${Array.isArray(item.actions) ? 'array' : typeof item.actions})`,
    )
  }
  return {
    id: ComputerTargetId(item.id),
    controlType: item.controlType,
    name: item.name,
    ...typeof item.value === 'string' ? { value: item.value } : {},
    enabled: item.enabled,
    actions: item.actions as string[],
  }
}

/**
 * Validate the complete helper result at the process boundary.
 * @param value - Parsed JSON value returned by the PowerShell helper.
 * @returns The validated computer action result.
 */
export function parseComputerResult(value: unknown): ComputerActionResult {
  if (typeof value !== 'object' || value === null) throw new Error('computer helper returned an invalid result')
  const result = value as Record<string, unknown>
  if (typeof result.action !== 'string' || !COMPUTER_ACTIONS.includes(result.action as never)
    || typeof result.summary !== 'string') {
    throw new Error('computer helper returned an invalid result')
  }
  const parsed: ComputerActionResult = {
    action: result.action as ComputerActionResult['action'],
    summary: result.summary,
    ...typeof result.appName === 'string' ? { appName: result.appName } : {},
    ...Array.isArray(result.apps) ? { apps: result.apps.map(parseApp) } : {},
    ...typeof result.windowId === 'string' ? { windowId: ComputerWindowId(result.windowId) } : {},
    ...typeof result.windowTitle === 'string' ? { windowTitle: result.windowTitle } : {},
    ...typeof result.observationId === 'string' ? { observationId: ComputerObservationId(result.observationId) } : {},
    ...Array.isArray(result.windows) ? { windows: result.windows.map(parseWindow) } : {},
    ...Array.isArray(result.targets) ? { targets: result.targets.map(parseTarget) } : {},
    ...typeof result.truncated === 'boolean' ? { truncated: result.truncated } : {},
  }
  return parsed
}

/** Semantic Windows UI Automation provider and model-facing tool consumer. */
export class ComputerControl extends Service {
  static inject = ['tools', 'subprocess']
  static Config = Config

  private readonly options: ResolvedConfig
  private helper: SubprocessHandle | undefined
  private helperStart: Promise<SubprocessHandle> | undefined
  private helperGeneration = 0
  private readonly exitedHelpers = new WeakSet<SubprocessHandle>()
  private stdoutBuffer = ''
  private requestSequence = 0
  private readonly pending = new Map<HelperRequestId, PendingRequest>()
  private operationTail: Promise<void> = Promise.resolve()
  private windowOwner: SessionId | undefined
  private knownWindows = new Set<ComputerWindowId>()
  private applicationCatalog: ApplicationCatalogState | undefined
  private observation: ObservationState | undefined

  /** Create the lazy UI Automation provider and register `computer_control`. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'xiaojingComputerControl')
    this.options = {
      powershellPath: config.powershellPath ?? 'powershell.exe',
      requestTimeoutMs: config.requestTimeoutMs ?? 15_000,
      processGraceMs: config.processGraceMs ?? 1_000,
      observationTtlMs: config.observationTtlMs ?? 120_000,
      maxTargets: config.maxTargets ?? 240,
      maxApps: config.maxApps ?? 60,
      maxWindows: config.maxWindows ?? 100,
      maxDepth: config.maxDepth ?? 8,
      maxWaitMs: config.maxWaitMs ?? 15_000,
      launchWaitMs: config.launchWaitMs ?? 5_000,
      waitPollMs: config.waitPollMs ?? 100,
      maxProtocolLineBytes: config.maxProtocolLineBytes ?? 1_000_000,
    }
    ctx.effect(() => async () => this.close(), 'xiaojingComputerControl.close')
    this.installTool(ctx)
  }

  /**
   * Explain whether one request requires a one-shot user approval.
   * @param owner - Agent session that owns the observed Windows targets.
   * @param request - Validated Windows operation.
   * @returns The approval reason, or undefined when the operation may proceed directly.
   */
  approvalReason(owner: SessionId, request: ComputerActionRequest): string | undefined {
    if (request.action === 'launch_app') {
      this.validateRequest(owner, request)
      const app = this.resolveApp(owner, request.appId)
      return HIGH_IMPACT_APP_PATTERN.test(app.name)
        ? `Launch potentially high-impact Windows application “${app.name}”`
        : undefined
    }
    if (request.action === 'press_key') {
      this.validateRequest(owner, request)
      const key = requireText(request.key, 'key').toUpperCase()
      return SAFE_KEYS.has(key) ? undefined : `Send keyboard input ${request.key as string} to another Windows application`
    }
    if (request.action !== 'invoke' && request.action !== 'toggle' && request.action !== 'select') return undefined
    this.validateRequest(owner, request)
    const target = this.resolveTarget(owner, request)
    const label = `${target.name} ${target.controlType}`
    return HIGH_IMPACT_PATTERN.test(label)
      ? `Activate potentially high-impact Windows control “${target.name || target.controlType}”`
      : undefined
  }

  /**
   * Execute one validated Windows operation for an owning session.
   * @param owner - Agent session that owns the observed Windows targets.
   * @param request - Windows operation to execute.
   * @param signal - Cancellation signal for the operation.
   * @returns The bounded application catalog, window list, or UI Automation observation produced by the operation.
   */
  run(owner: SessionId, request: ComputerActionRequest, signal: AbortSignal): Promise<ComputerActionResult> {
    if (process.platform !== 'win32') return Promise.reject(new Error('computer_control is available only in the Windows desktop application'))
    return this.enqueue(signal, async () => {
      this.validateRequest(owner, request)
      const payload: Record<string, unknown> = {
        action: request.action,
        maxApps: this.options.maxApps,
        maxWindows: this.options.maxWindows,
        maxTargets: this.options.maxTargets,
        maxDepth: this.options.maxDepth,
        ...request.query !== undefined ? { query: request.query } : {},
        ...request.appId !== undefined ? { appId: request.appId } : {},
        ...request.windowId !== undefined ? { windowId: request.windowId } : {},
        ...request.observationId !== undefined ? { observationId: request.observationId } : {},
        ...request.targetId !== undefined ? { targetId: request.targetId } : {},
        ...request.value !== undefined ? { value: request.value } : {},
        ...request.key !== undefined ? { key: request.key } : {},
        ...request.direction !== undefined ? { direction: request.direction } : {},
        ...request.text !== undefined ? { text: request.text } : {},
        ...request.action === 'wait'
          ? {
            timeoutMs: Math.min(request.timeoutMs ?? this.options.maxWaitMs, this.options.maxWaitMs),
            pollMs: this.options.waitPollMs,
          }
          : {},
        ...request.action === 'launch_app'
          ? { timeoutMs: this.options.launchWaitMs, pollMs: this.options.waitPollMs }
          : {},
      }
      const result = parseComputerResult(await this.request(payload, signal))
      this.rememberResult(owner, result)
      return result
    })
  }

  /** Terminate the helper process tree and reject any pending request. */
  async close(): Promise<void> {
    const helper = this.helper
    const helperStart = this.helperStart
    this.helperGeneration += 1
    this.helper = undefined
    this.helperStart = undefined
    this.invalidateHelperState()
    this.rejectPending(new Error('computer-control helper closed'))
    if (helper !== undefined) await this.terminateHelper(helper)
    if (helperStart !== undefined) {
      let started: SubprocessHandle | undefined
      try {
        started = await helperStart
      } catch {
        // The request awaiting startup owns its launch error; disposal only waits for quiescence.
      }
      if (started !== undefined && started !== helper) await this.terminateHelper(started)
    }
  }

  private installTool(ctx: Context): void {
    ctx.tools.register(defineTool({
      name: 'computer_control',
      description: 'Control a visible native Windows application through semantic UI Automation when direct file, command, or data tools cannot complete the task more efficiently. Use browser_control for websites. If the required application is closed, call list_apps with its name and launch_app with the returned opaque app ID. Then list or use the returned windows, observe one window, and invoke only advertised target actions. Never guess IDs or launch an application merely to perform work that a direct tool can complete. This tool cannot control UAC, secure desktop, sign-in screens, elevated applications, pixel-only canvases, or controls without UI Automation semantics.',
      parameters: {
        action: { type: 'string', enum: [...COMPUTER_ACTIONS], required: true },
        query: { type: 'string', description: 'Installed-application display name to search for with list_apps.' },
        app_id: { type: 'string', description: 'Opaque application ID from the latest list_apps result.' },
        window_id: { type: 'string', description: 'Opaque window ID from list_windows.' },
        observation_id: { type: 'string', description: 'Latest observation ID for a target action.' },
        target_id: { type: 'string', description: 'Opaque target ID from that observation.' },
        value: { type: 'string', description: 'New text for set_value. Password fields are intentionally unsupported.' },
        key: { type: 'string', description: 'Windows Forms SendKeys expression, such as {TAB}, ^s, or {ENTER}.' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction.' },
        text: { type: 'string', description: 'Exact accessible name to wait for.' },
        timeout_ms: { type: 'number', description: 'Wait timeout, capped by product configuration.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: [...COMPUTER_ACTIONS], required: true },
            summary: { type: 'string', required: true },
            appName: { type: 'string' },
            apps: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                },
              },
            },
            windowId: { type: 'string' },
            windowTitle: { type: 'string' },
            observationId: { type: 'string' },
            windows: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  processId: { type: 'integer', required: true },
                },
              },
            },
            targets: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  controlType: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  value: { type: 'string' },
                  enabled: { type: 'boolean', required: true },
                  actions: { type: 'array', items: { type: 'string' }, required: true },
                },
              },
            },
            truncated: { type: 'boolean' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined) throw new Error('computer_control requires an owning agent session')
        const request: ComputerActionRequest = {
          action: args.action,
          ...args.query !== undefined ? { query: args.query } : {},
          ...args.app_id !== undefined ? { appId: ComputerAppId(args.app_id) } : {},
          ...args.window_id !== undefined ? { windowId: ComputerWindowId(args.window_id) } : {},
          ...args.observation_id !== undefined ? { observationId: ComputerObservationId(args.observation_id) } : {},
          ...args.target_id !== undefined ? { targetId: ComputerTargetId(args.target_id) } : {},
          ...args.value !== undefined ? { value: args.value } : {},
          ...args.key !== undefined ? { key: args.key } : {},
          ...args.direction !== undefined ? { direction: args.direction } : {},
          ...args.text !== undefined ? { text: args.text } : {},
          ...args.timeout_ms !== undefined ? { timeoutMs: args.timeout_ms } : {},
        }
        const owner = exec.agent.id
        const reason = this.approvalReason(owner, request)
        if (reason !== undefined) await this.requireApproval(ctx, exec, reason)
        return await this.run(owner, request, exec.signal)
      },
      presentCall: args => ({
        card: 'generic',
        title: `Windows: ${args.action}`,
        kind: args.action === 'list_apps' || args.action === 'list_windows' || args.action === 'observe' ? 'read' : 'other',
        rawInput: args,
      }),
    }))
  }

  private async requireApproval(ctx: Context, exec: ToolRunContext, reason: string): Promise<void> {
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

  private validateRequest(owner: SessionId, request: ComputerActionRequest): void {
    switch (request.action) {
      case 'list_apps': {
        if (request.query !== undefined && request.query.trim() === '') {
          throw new Error('computer_control query must be omitted or contain text')
        }
        return
      }
      case 'launch_app': {
        this.resolveApp(owner, request.appId)
        return
      }
      case 'list_windows': return
      case 'observe': {
        const windowId = ComputerWindowId(requireText(request.windowId, 'window_id'))
        if (this.windowOwner !== owner || !this.knownWindows.has(windowId)) {
          throw new Error('Windows window list is missing, stale, or belongs to another session; list windows again')
        }
        return
      }
      case 'wait': {
        this.requireObservation(owner, request.observationId)
        requireText(request.text, 'text')
        if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)) {
          throw new Error('computer_control timeout_ms must be positive and finite')
        }
        return
      }
      case 'press_key': {
        this.requireObservation(owner, request.observationId)
        requireText(request.key, 'key')
        if (request.targetId !== undefined) {
          const target = this.resolveTarget(owner, request)
          if (!target.actions.includes('focus')) throw new Error('Windows target does not support focus for press_key')
        }
        return
      }
      case 'set_value': {
        const target = this.resolveTarget(owner, request)
        if (!target.actions.includes(request.action)) throw new Error('Windows target does not support set_value')
        if (request.value === undefined) throw new Error('computer_control set_value requires value')
        return
      }
      case 'scroll': {
        const target = this.resolveTarget(owner, request)
        if (!target.actions.includes(request.action)) throw new Error('Windows target does not support scroll')
        if (request.direction === undefined) throw new Error('computer_control scroll requires direction')
        return
      }
      case 'invoke':
      case 'toggle':
      case 'select':
      case 'focus': {
        const target = this.resolveTarget(owner, request)
        if (!target.actions.includes(request.action)) {
          throw new Error(`Windows target does not support ${request.action}; use one of: ${target.actions.join(', ')}`)
        }
        return
      }
      default: return assertNever(request.action)
    }
  }

  private requireObservation(owner: SessionId, observationId: ComputerObservationId | undefined): ObservationState {
    const id = ComputerObservationId(requireText(observationId, 'observation_id'))
    const observation = this.observation
    if (observation === undefined || observation.owner !== owner || observation.id !== id || observation.expiresAt < Date.now()) {
      throw new Error('Windows control observation is missing, expired, or belongs to another session; observe again')
    }
    return observation
  }

  private resolveApp(owner: SessionId, appId: ComputerAppId | undefined): ComputerApp {
    const id = ComputerAppId(requireText(appId, 'app_id'))
    const catalog = this.applicationCatalog
    if (catalog === undefined || catalog.owner !== owner || catalog.expiresAt < Date.now()) {
      throw new Error('Windows application list is missing, expired, or belongs to another session; list apps again')
    }
    const app = catalog.apps.get(id)
    if (app === undefined) throw new Error('Windows application is not part of the latest listing; list apps again')
    return app
  }

  private resolveTarget(owner: SessionId, request: ComputerActionRequest): ComputerTarget {
    const observation = this.requireObservation(owner, request.observationId)
    const targetId = ComputerTargetId(requireText(request.targetId, 'target_id'))
    const target = observation.targets.get(targetId)
    if (target === undefined) throw new Error('Windows target is not part of that observation; observe again')
    return target
  }

  private rememberResult(owner: SessionId, result: ComputerActionResult): void {
    if (result.apps !== undefined) {
      this.applicationCatalog = {
        owner,
        expiresAt: Date.now() + this.options.observationTtlMs,
        apps: new Map(result.apps.map(app => [app.id, app])),
      }
    }
    if (result.action === 'launch_app') this.applicationCatalog = undefined
    if (result.windows !== undefined) {
      this.windowOwner = owner
      this.knownWindows = new Set(result.windows.map(window => window.id))
      this.observation = undefined
    }
    if (result.observationId !== undefined && result.targets !== undefined) {
      this.observation = {
        owner,
        id: result.observationId,
        expiresAt: Date.now() + this.options.observationTtlMs,
        targets: new Map(result.targets.map(target => [target.id, target])),
      }
    }
  }

  private enqueue<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(async () => {
      throwIfAborted(signal)
      return await operation()
    })
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private async request(payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    throwIfAborted(signal)
    const helper = await this.startHelper()
    const id = HelperRequestId(`wr-${String(++this.requestSequence)}`)
    const request = JSON.stringify({ id, ...payload })
    if (Buffer.byteLength(request) > this.options.maxProtocolLineBytes) {
      throw new Error('computer-control helper request exceeds the configured protocol bound')
    }
    return await new Promise<unknown>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.pending.delete(id)
        callback()
      }
      const failAndRestart = (error: Error) => {
        if (this.helper === helper) this.retireHelper(helper, error)
        else finish(() => { reject(error) })
      }
      const onAbort = () => {
        failAndRestart(signal.reason instanceof Error ? signal.reason : new Error('computer operation cancelled'))
      }
      const timer = setTimeout(() => {
        failAndRestart(new Error('computer-control helper request timed out'))
      }, this.options.requestTimeoutMs)
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve: (value) => { finish(() => { resolve(value) }) },
        reject: (error) => { finish(() => { reject(error) }) },
      })
      if (this.helper !== helper) {
        finish(() => { reject(new Error('computer-control helper exited before request dispatch')) })
        return
      }
      helper.stdin?.write(`${request}\n`, 'utf8', (error) => {
        if (error !== null && error !== undefined) failAndRestart(error)
      })
    })
  }

  private async startHelper(): Promise<SubprocessHandle> {
    if (this.helper !== undefined) return this.helper
    if (this.helperStart !== undefined) return await this.helperStart
    const generation = this.helperGeneration
    const start = this.launchHelper()
    this.helperStart = start
    try {
      const helper = await start
      if (generation !== this.helperGeneration || this.exitedHelpers.has(helper)) {
        await this.terminateHelper(helper)
        throw new Error('computer-control helper start was cancelled or exited during startup')
      }
      this.stdoutBuffer = ''
      this.helper = helper
      return helper
    } finally {
      if (this.helperStart === start) this.helperStart = undefined
    }
  }

  private async launchHelper(): Promise<SubprocessHandle> {
    const executable = await this.ctx.subprocess.resolveExecutable(this.options.powershellPath)
    const compressed = gzipSync(Buffer.from(WINDOWS_UIA_HELPER, 'utf8')).toString('base64')
    const bootstrap = [
      `$bytes=[Convert]::FromBase64String('${compressed}')`,
      '$memory=New-Object IO.MemoryStream(,$bytes)',
      '$gzip=New-Object IO.Compression.GzipStream($memory,[IO.Compression.CompressionMode]::Decompress)',
      '$reader=New-Object IO.StreamReader($gzip,[Text.Encoding]::UTF8)',
      '$source=$reader.ReadToEnd()',
      '$reader.Dispose()',
      '$gzip.Dispose()',
      '$memory.Dispose()',
      '& ([ScriptBlock]::Create($source))',
    ].join(';')
    const encoded = Buffer.from(bootstrap, 'utf16le').toString('base64')
    const helper = this.ctx.subprocess.spawn({
      argv: [executable, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      cwd: process.cwd(),
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: 32_768 },
      },
      graceMs: this.options.processGraceMs,
    })
    if (helper.stdin === undefined || helper.stdout === undefined) {
      helper.terminate()
      throw new Error('computer-control helper did not expose piped stdio')
    }
    helper.stdout.setEncoding('utf8')
    helper.stdout.on('data', (chunk) => { this.consumeStdout(helper, String(chunk)) })
    void helper.done.then(
      (outcome) => {
        this.helperExited(helper, new Error(`computer-control helper exited (${String(outcome.exitCode ?? outcome.signal)})`))
      },
      (error: unknown) => {
        this.helperExited(helper, error instanceof Error ? error : new Error(String(error)))
      },
    )
    return helper
  }

  private consumeStdout(helper: SubprocessHandle, chunk: string): void {
    if (this.helper !== helper) return
    this.stdoutBuffer += chunk
    if (Buffer.byteLength(this.stdoutBuffer) > this.options.maxProtocolLineBytes) {
      this.retireHelper(helper, new Error('computer-control helper emitted an oversized protocol line'))
      return
    }
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) return
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line === '') continue
      this.consumeLine(helper, line)
    }
  }

  private consumeLine(helper: SubprocessHandle, line: string): void {
    let decoded: unknown
    try {
      decoded = JSON.parse(line)
    } catch {
      this.retireHelper(helper, new Error('computer-control helper emitted invalid JSON'))
      return
    }
    if (typeof decoded !== 'object' || decoded === null) {
      this.retireHelper(helper, new Error('computer-control helper emitted an invalid response'))
      return
    }
    const response = decoded as Record<string, unknown>
    if (typeof response.id !== 'string' || typeof response.ok !== 'boolean') {
      this.retireHelper(helper, new Error('computer-control helper emitted an invalid response'))
      return
    }
    const pending = this.pending.get(HelperRequestId(response.id))
    if (pending === undefined) {
      this.retireHelper(helper, new Error('computer-control helper emitted an unknown response id'))
      return
    }
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(typeof response.error === 'string' ? response.error : 'computer-control helper request failed'))
  }

  private helperExited(helper: SubprocessHandle, error: Error): void {
    this.exitedHelpers.add(helper)
    if (this.helper !== helper) return
    this.helper = undefined
    this.invalidateHelperState()
    this.rejectPending(error)
  }

  private retireHelper(helper: SubprocessHandle, error: Error): void {
    if (this.helper !== helper) return
    this.helper = undefined
    this.invalidateHelperState()
    helper.terminate()
    this.rejectPending(error)
  }

  private invalidateHelperState(): void {
    this.stdoutBuffer = ''
    this.observation = undefined
    this.applicationCatalog = undefined
    this.knownWindows.clear()
    this.windowOwner = undefined
  }

  private async terminateHelper(helper: SubprocessHandle): Promise<void> {
    helper.terminate()
    try {
      await helper.waitForExit()
    } catch {
      // The original request or exit callback owns the process failure; teardown cannot recover it.
    }
  }

  private rejectPending(error: Error): void {
    for (const request of [...this.pending.values()]) request.reject(error)
  }
}

export default ComputerControl
