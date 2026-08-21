/** Xiaojing Weixin iLink channel: pairing, durable polling, Agent bridging, and approval replies. */

import { createHash, randomInt, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-commands'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { AssistantMessage, ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import QRCode from 'qrcode'
import { z } from 'zod'
import { formatWeixinText, splitWeixinText } from './formatter.ts'
import {
  DEFAULT_WEIXIN_MEDIA_MAX_BYTES,
  DEFAULT_WEIXIN_MEDIA_TOTAL_MAX_BYTES,
  WeixinMediaStore,
  inspectOutboundWeixinMedia,
  receiveWeixinMedia,
  sendOutboundWeixinMedia,
  type StoredWeixinMedia,
} from './media.ts'
import {
  IlinkClient, normalizeOfficialIlinkBaseUrl,
  type IlinkIncomingMessage, type IlinkMessageItem, type IlinkPairingStatus,
} from './protocol.ts'
import { emptyWeixinState, WeixinInstanceLease, WeixinStateStore } from './state.ts'
import type {
  WeixinChannelStateFile, WeixinChannelStatus, WeixinPendingMessage,
} from './types.ts'

export type * from './types.ts'
export { formatWeixinText, splitWeixinText } from './formatter.ts'
export { IlinkClient } from './protocol.ts'
export { WeixinStateStore } from './state.ts'

const TOKEN_REF = credentialRef('XIAOJING_WEIXIN_TOKEN')
const QR_TTL_MS = 5 * 60_000
const STALE_TOKEN_CODE = -14
const COMPLETED_ID_LIMIT = 1000
const PENDING_MESSAGE_LIMIT = 100
const MAX_MEDIA_ITEMS_PER_MESSAGE = 10
const MEDIA_UNSUPPORTED = '当前版本支持文字、图片和普通文档，暂不支持语音或视频。'
const SESSION_TITLE = '微信助手'
const WORKSPACE_WRITE_PRESET = 'workspace-write'
const FULL_ACCESS_PRESET = 'danger-full-access'

/** Deployment tunables for network deadlines and reply delivery. */
export interface Config {
  /** Private state directory; defaults to `$DSH_HOME/weixin-channel`. */
  stateDir?: string
  /** Ordinary iLink request timeout in milliseconds. */
  requestTimeoutMs?: number
  /** Long-poll deadline in milliseconds. */
  longPollTimeoutMs?: number
  /** Delay after one transient poll failure. */
  retryDelayMs?: number
  /** Delay after three consecutive poll failures. */
  backoffDelayMs?: number
  /** Deadline for one Tencent CDN upload or download. */
  mediaTransferTimeoutMs?: number
  /** Expiry for one Weixin approval code. */
  approvalTimeoutMs?: number
  /** Interval between visible long-running-task notices. */
  progressHeartbeatMs?: number
  /** Maximum Unicode code points in one outbound text message. */
  maxReplyChars?: number
  /** Shared local upload directory; defaults to `$DSH_HOME/uploads`. */
  mediaDir?: string
  /** Maximum decrypted bytes accepted or sent for one file. */
  maxMediaBytes?: number
  /** Maximum aggregate bytes retained in the shared upload directory. */
  totalMediaBytes?: number
}

/** Validated plugin configuration. */
export const Config: Schema<Config> = Schema.object({
  stateDir: Schema.string(),
  requestTimeoutMs: Schema.natural().min(1_000).default(15_000),
  longPollTimeoutMs: Schema.natural().min(5_000).default(35_000),
  retryDelayMs: Schema.natural().min(100).default(2_000),
  backoffDelayMs: Schema.natural().min(1_000).default(30_000),
  mediaTransferTimeoutMs: Schema.natural().min(5_000).default(120_000),
  approvalTimeoutMs: Schema.natural().min(10_000).default(180_000),
  progressHeartbeatMs: Schema.natural().min(15_000).default(30_000),
  maxReplyChars: Schema.natural().min(200).default(3_500),
  mediaDir: Schema.string(),
  maxMediaBytes: Schema.natural().min(1).default(DEFAULT_WEIXIN_MEDIA_MAX_BYTES),
  totalMediaBytes: Schema.natural().min(1).default(DEFAULT_WEIXIN_MEDIA_TOTAL_MAX_BYTES),
})

/** Services used by the Host-only channel. */
export const inject = [
  'connection', 'credentials', 'apiProxy', 'agents', 'systemPrompt', 'tools',
  'commands', 'permissionPresets',
]

interface ResolvedConfig {
  stateDir: string
  requestTimeoutMs: number
  longPollTimeoutMs: number
  retryDelayMs: number
  backoffDelayMs: number
  mediaTransferTimeoutMs: number
  approvalTimeoutMs: number
  progressHeartbeatMs: number
  maxReplyChars: number
  mediaDir: string
  maxMediaBytes: number
  totalMediaBytes: number
}

interface ActiveTurn {
  task: WeixinPendingMessage
  startedAt: number
  turn?: number
  text: string
  settled: PromiseWithResolvers<string>
}

interface ApprovalReply {
  action: '确认' | '拒绝'
  code: string
}

interface PendingApproval {
  code: string
  taskId: string
  resolve: (outcome: ApprovalOutcome) => void
  timer: ReturnType<typeof setTimeout>
  removeAbort?: () => void
}

interface PendingPermissionChange {
  code: string
  timer: ReturnType<typeof setTimeout>
}

interface PairingAttempt {
  qrcode: string
  baseUrl: string
  verifyCode: string | undefined
  controller: AbortController
}

interface ConnectedAccount {
  accountId: string
  ownerUserId: string
  baseUrl: string
}

function resolveConfig(config: Config): ResolvedConfig {
  const maxMediaBytes = config.maxMediaBytes ?? DEFAULT_WEIXIN_MEDIA_MAX_BYTES
  const totalMediaBytes = config.totalMediaBytes ?? DEFAULT_WEIXIN_MEDIA_TOTAL_MAX_BYTES
  if (totalMediaBytes < maxMediaBytes) {
    throw new Error('xiaojing-weixin-channel: totalMediaBytes must be at least maxMediaBytes')
  }
  return {
    stateDir: config.stateDir ?? dshHomePath('weixin-channel'),
    requestTimeoutMs: config.requestTimeoutMs ?? 15_000,
    longPollTimeoutMs: config.longPollTimeoutMs ?? 35_000,
    retryDelayMs: config.retryDelayMs ?? 2_000,
    backoffDelayMs: config.backoffDelayMs ?? 30_000,
    mediaTransferTimeoutMs: config.mediaTransferTimeoutMs ?? 120_000,
    approvalTimeoutMs: config.approvalTimeoutMs ?? 180_000,
    progressHeartbeatMs: config.progressHeartbeatMs ?? 30_000,
    maxReplyChars: config.maxReplyChars ?? 3_500,
    mediaDir: config.mediaDir ?? dshHomePath('uploads'),
    maxMediaBytes,
    totalMediaBytes,
  }
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function browserSafeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('另一套小兢会计正在使用此微信连接')
    || message.startsWith('微信任务正在处理')
    || message.startsWith('当前没有等待验证的微信连接')) return message
  if (message === 'iLink request timed out' || /^iLink request failed with HTTP \d{3}$/.test(message)) {
    return '微信网络暂时不可用，请稍后重试。'
  }
  if (message.includes('non-official service address')) return '微信返回了不安全的服务地址，连接已停止。'
  return '微信频道操作失败，请重试。'
}

function parseApprovalReply(text: string | undefined): ApprovalReply | 'malformed' | undefined {
  const value = text?.trim()
  if (value === undefined || value === '') return undefined
  const match = value.match(/^(确认|拒绝)(?:码)?[\s:：-]*([0-9]{6})$/u)
  if (match !== null) return { action: match[1] as ApprovalReply['action'], code: match[2] as string }
  return /^(?:确认|拒绝)(?:码)?[\s:：-]*[0-9]*$/u.test(value) ? 'malformed' : undefined
}

function failed(error: unknown): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: browserSafeError(error),
      details: {},
    },
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => { done(true) }, ms)
    const abort = (): void => { done(false) }
    signal?.addEventListener('abort', abort, { once: true })
    function done(elapsed: boolean): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      resolve(elapsed)
    }
  })
}

function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1_000))} 秒`
  return `${Math.max(1, Math.floor(ms / 60_000))} 分钟`
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

function sourceRpcId(message: UserMessage): string | undefined {
  const value = (message.source as { rpcId?: unknown }).rpcId
  return typeof value === 'string' ? value : undefined
}

function maskAccount(accountId: string): string {
  const at = accountId.indexOf('@')
  const local = at === -1 ? accountId : accountId.slice(0, at)
  const suffix = at === -1 ? '' : accountId.slice(at)
  if (local.length <= 4) return `${local.slice(0, 1)}***${suffix}`
  return `${local.slice(0, 4)}***${local.slice(-2)}${suffix}`
}

function inboundId(message: IlinkIncomingMessage): string {
  if (message.client_id !== undefined && message.client_id !== '') return `client:${message.client_id}`
  if (message.message_id !== undefined) return `message:${String(message.message_id)}`
  const stable = JSON.stringify({
    from: message.from_user_id,
    session: message.session_id,
    seq: message.seq,
    time: message.create_time_ms,
    items: message.item_list,
  })
  return `digest:${createHash('sha256').update(stable).digest('hex')}`
}

function incomingContent(message: IlinkIncomingMessage): {
  text?: string
  mediaItems: IlinkMessageItem[]
  hasUnsupportedMedia: boolean
} {
  const items = message.item_list ?? []
  const text = items
    .filter(item => item.type === 1)
    .map(item => item.text_item?.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
  return {
    ...(text === '' ? {} : { text }),
    mediaItems: items.filter(item => item.type === 2 || item.type === 4),
    hasUnsupportedMedia: items.some(item => item.type !== 1 && item.type !== 2 && item.type !== 4),
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function taskPrompt(task: WeixinPendingMessage): string {
  if (task.attachments.length === 0) return task.text
  const rows = task.attachments.flatMap((attachment, index) => [
    `${index + 1}. ${attachment.kind === 'image' ? '图片' : '文档'}：${attachment.name}`,
    `   类型：${attachment.mediaType}`,
    `   大小：${formatBytes(attachment.bytes)}`,
    `   本机路径：${attachment.path}`,
  ])
  return [
    task.text || '请处理我从微信发送的附件。',
    '',
    '微信附件（已安全保存到本机，未自动打开或执行）：',
    ...rows,
  ].join('\n')
}

function turnFailure(event: Extract<SessionEvent, { type: 'turn/end' }>): string | undefined {
  return event.data.reason.kind === 'error' ? '本轮任务执行失败，请在桌面端查看详细日志。' : undefined
}

function isRetryablePairingError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!(error instanceof Error)) return false
  if (error.message === 'iLink request timed out') return true
  const status = error.message.match(/^iLink request failed with HTTP (\d{3})$/)?.[1]
  if (status === undefined) return false
  const code = Number(status)
  return code === 429 || code >= 500
}

/** Stateful Host adapter; exported for assembled integration tests. */
export class XiaojingWeixinChannel {
  private state: WeixinChannelStateFile = emptyWeixinState()
  private status: WeixinChannelStatus = {
    state: 'disconnected', online: false, verificationRequired: false,
  }
  private readonly store: WeixinStateStore
  private readonly lease: WeixinInstanceLease
  private readonly ilink: IlinkClient
  private readonly mediaStore: WeixinMediaStore
  private monitor: AbortController | undefined
  private monitorTask: Promise<void> | undefined
  private pairing: PairingAttempt | undefined
  private pairingTask: Promise<void> | undefined
  private persistTail: Promise<void> = Promise.resolve()
  private active: ActiveTurn | undefined
  private approval: PendingApproval | undefined
  private permissionChange: PendingPermissionChange | undefined
  private pumping = false
  private pumpTask: Promise<void> | undefined
  private disposed = false
  private suspended = true
  private leaseOwned = false
  private readonly configuredAgents = new Map<Agent, Array<() => void>>()
  private readonly rpcOperations = new Set<Promise<RpcResult<unknown>>>()
  private readonly interruptionNotifiedTasks = new Set<string>()

  /** @param ctx - Host Cordis context. @param config - resolved deployment configuration. */
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {
    this.store = new WeixinStateStore(join(config.stateDir, 'state.json'))
    this.lease = new WeixinInstanceLease(join(config.stateDir, 'channel.lock'))
    this.ilink = new IlinkClient({
      requestTimeoutMs: config.requestTimeoutMs,
      longPollTimeoutMs: config.longPollTimeoutMs,
      mediaTransferTimeoutMs: config.mediaTransferTimeoutMs,
    })
    this.mediaStore = new WeixinMediaStore({
      root: config.mediaDir,
      maxFileBytes: config.maxMediaBytes,
      totalMaxBytes: config.totalMediaBytes,
    })
  }

  /** Load private state, acquire the single-consumer lease, and auto-reconnect. */
  async start(): Promise<void> {
    try {
      this.state = await this.store.load()
      this.leaseOwned = await this.lease.acquire()
      if (!this.leaseOwned) {
        this.setStatus('instance-busy', false, '另一套小兢会计正在使用此微信连接。')
        return
      }
      const token = await this.ctx.credentials.resolve(TOKEN_REF)
      if (token !== undefined && this.account() !== undefined) {
        this.startMonitor()
      } else {
        this.setStatus('disconnected', false)
      }
    } catch (error) {
      this.ctx.logger.warn(`xiaojing-weixin: startup failed: ${error instanceof Error ? error.message : String(error)}`)
      this.setStatus('error', false, '微信频道启动失败，请查看本机日志。')
    }
  }

  /** Register the loopback RPC surface and session/approval correlations. */
  install(): void {
    this.ctx.effect(() => this.ctx.connection.rpc.handle(
      '/xiaojing-weixin',
      (endpoint: string, payload: unknown) => this.dispatchRpc(endpoint, payload),
      { authority: 'loopback' },
    ), 'xiaojing-weixin-channel: loopback RPC')

    this.ctx.on('agent/created', ({ agent }) => { this.configureAgent(agent) })
    this.ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      if (this.active === undefined || !this.owns(agent) || sourceRpcId(message) !== this.active.task.rpcId) return
      this.active.turn = turn
    })
    this.ctx.on('session/event', (session, event: SessionEvent) => {
      const current = this.active
      if (current === undefined || session.header.id !== this.state.sessionId || current.turn === undefined) return
      if (event.type === 'assistant/message' && event.data.turn === current.turn) {
        const text = assistantText(event.data.message)
        if (text !== '') current.text = text
      }
      if (event.type === 'turn/end' && event.data.turn === current.turn) {
        current.settled.resolve(turnFailure(event) ?? (current.text || '任务已执行完成。'))
      }
    })
    this.ctx.on('agent/error', ({ agent, turn }) => {
      if (this.active !== undefined && this.owns(agent) && this.active.turn === turn) {
        this.active.settled.resolve('本轮任务执行失败，请在桌面端查看详细日志。')
      }
    })
    this.ctx.on('agent/disposed', ({ agent }) => {
      if (this.active !== undefined && this.owns(agent)) {
        this.active.settled.resolve('微信助手会话已停止，本轮任务未能完成。')
      }
      this.releaseAgent(agent)
    })
    this.ctx.on('approval/request', (request, next) => {
      if (!this.owns(request.agent) || this.active === undefined) return next()
      return this.requestApproval(request)
    }, { prepend: true })
  }

  /** Stop network work, fail pending approvals closed, and release process ownership. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.suspended = true
    this.cancelPairing()
    this.finishApproval('unavailable')
    this.clearPermissionChange()
    const pairingTask = this.pairingTask
    await Promise.allSettled([
      this.stopMonitor(true),
      pairingTask,
      this.stopActive('应用已关闭，本轮任务未能返回微信。'),
    ].filter((task): task is Promise<void> => task !== undefined))
    await Promise.allSettled([...this.rpcOperations])
    for (const agent of [...this.configuredAgents.keys()]) this.releaseAgent(agent)
    await this.persistTail.catch((error: unknown) => {
      this.ctx.logger.warn(`xiaojing-weixin: final state write failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    await this.lease.release()
  }

  /**
   * Sanitized state suitable for the local settings page.
   * @returns connection state without the bot token or message context values.
   */
  snapshot(): WeixinChannelStatus {
    return structuredClone(this.status)
  }

  private setStatus(state: WeixinChannelStatus['state'], online: boolean, error?: string): void {
    const withoutError = { ...this.status }
    delete withoutError.error
    this.status = {
      ...withoutError,
      state,
      online,
      verificationRequired: state === 'verification-required',
      ...(this.state.accountId === undefined ? {} : { accountLabel: maskAccount(this.state.accountId) }),
      ...(error === undefined ? {} : { error }),
    }
  }

  private account(): ConnectedAccount | undefined {
    const { accountId, ownerUserId, baseUrl } = this.state
    return accountId === undefined || ownerUserId === undefined || baseUrl === undefined
      ? undefined
      : { accountId, ownerUserId, baseUrl }
  }

  private persist(): Promise<void> {
    const snapshot = structuredClone(this.state)
    const next = this.persistTail.catch(() => undefined).then(() => this.store.save(snapshot))
    this.persistTail = next
    return next
  }

  private dispatchRpc(endpoint: string, payload: unknown): Promise<RpcResult<unknown>> {
    const operation = this.handleRpc(endpoint, payload)
    this.rpcOperations.add(operation)
    void operation.finally(() => { this.rpcOperations.delete(operation) })
    return operation
  }

  private async handleRpc(endpoint: string, payload: unknown): Promise<RpcResult<unknown>> {
    try {
      if (this.disposed) throw new Error('微信频道已经停止。')
      switch (endpoint) {
        case 'status':
          z.object({}).parse(payload)
          return ok(this.snapshot())
        case 'pairing/start':
          z.object({}).parse(payload)
          await this.startPairing()
          return ok(this.snapshot())
        case 'pairing/verify': {
          const input = z.object({ code: z.string().regex(/^\d{4,8}$/) }).parse(payload)
          if (this.pairing === undefined) throw new Error('当前没有等待验证的微信连接。')
          this.pairing.verifyCode = input.code
          this.setStatus('pairing', false)
          return ok(this.snapshot())
        }
        case 'pairing/cancel':
          z.object({}).parse(payload)
          await this.cancelPairingAndResume()
          return ok(this.snapshot())
        case 'disconnect':
          z.object({}).parse(payload)
          await this.disconnect()
          return ok(this.snapshot())
        default:
          throw new Error(`未知的微信频道操作：${endpoint}`)
      }
    } catch (error) {
      this.ctx.logger.warn(`xiaojing-weixin: RPC ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`)
      return failed(error)
    }
  }

  private async startPairing(): Promise<void> {
    if (!this.leaseOwned) throw new Error('另一套小兢会计正在使用此微信连接。')
    if (this.active !== undefined || this.state.pending.length > 0) {
      throw new Error('微信任务正在处理，请等待任务完成后再重新连接。')
    }
    const previousPairing = this.pairingTask
    this.cancelPairing()
    await previousPairing?.catch(() => undefined)
    await this.stopMonitor(false)
    this.suspended = true
    const existing = await this.ctx.credentials.resolve(TOKEN_REF)
    let qr: Awaited<ReturnType<IlinkClient['startPairing']>>
    try {
      qr = await this.ilink.startPairing(existing === undefined ? [] : [existing.value])
    } catch (error) {
      if (existing !== undefined && this.account() !== undefined) this.startMonitor()
      else this.setStatus('disconnected', false)
      throw error
    }
    if (this.isDisposed()) throw new Error('微信频道已经停止。')
    const qrCodeDataUrl = await QRCode.toDataURL(qr.qrPayload, {
      errorCorrectionLevel: 'M', margin: 2, width: 280,
    })
    if (this.isDisposed()) throw new Error('微信频道已经停止。')
    const attempt: PairingAttempt = {
      qrcode: qr.qrcode,
      baseUrl: 'https://ilinkai.weixin.qq.com',
      verifyCode: undefined,
      controller: new AbortController(),
    }
    this.pairing = attempt
    this.status = {
      state: 'pairing', online: false, verificationRequired: false,
      qrCodeDataUrl, qrExpiresAt: Date.now() + QR_TTL_MS,
      ...(this.state.accountId === undefined ? {} : { accountLabel: maskAccount(this.state.accountId) }),
    }
    const task = this.pollPairing(attempt).finally(() => {
      if (this.pairingTask === task) this.pairingTask = undefined
    })
    this.pairingTask = task
    void task
  }

  private async pollPairing(attempt: PairingAttempt): Promise<void> {
    let failures = 0
    try {
      while (!attempt.controller.signal.aborted && Date.now() < (this.status.qrExpiresAt ?? 0)) {
        try {
          const result = await this.ilink.pairingStatus(
            attempt.qrcode, attempt.verifyCode, attempt.baseUrl, attempt.controller.signal,
          )
          failures = 0
          if (this.pairingStopped(attempt)) return
          if (await this.consumePairingStatus(attempt, result)) return
          await sleep(500, attempt.controller.signal)
        } catch (error) {
          if (this.pairingStopped(attempt)) return
          if (!isRetryablePairingError(error)) throw error
          failures += 1
          this.status = { ...this.status, error: '微信网络暂时不可用，正在重试…' }
          await sleep(failures >= 3 ? this.config.backoffDelayMs : this.config.retryDelayMs, attempt.controller.signal)
          if (failures >= 3) failures = 0
        }
      }
      if (this.pairing === attempt) {
        this.pairing = undefined
        this.setStatus('expired', false, '二维码已过期，请重新生成。')
      }
    } catch (error) {
      if (attempt.controller.signal.aborted || this.pairing !== attempt) return
      this.pairing = undefined
      this.ctx.logger.warn(`xiaojing-weixin: pairing failed: ${error instanceof Error ? error.message : String(error)}`)
      this.setStatus('error', false, browserSafeError(error))
    }
  }

  private async consumePairingStatus(attempt: PairingAttempt, result: IlinkPairingStatus): Promise<boolean> {
    switch (result.status) {
      case 'wait':
        return false
      case 'scaned':
        attempt.verifyCode = undefined
        this.setStatus('scanned', false)
        return false
      case 'need_verifycode':
        this.setStatus('verification-required', false)
        return false
      case 'scaned_but_redirect':
        if (result.redirect_host === undefined) throw new Error('微信返回了无效的扫码重定向。')
        attempt.baseUrl = normalizeOfficialIlinkBaseUrl(`https://${result.redirect_host}`)
        return false
      case 'expired':
        this.pairing = undefined
        this.setStatus('expired', false, '二维码已过期，请重新生成。')
        return true
      case 'verify_code_blocked':
        this.pairing = undefined
        this.setStatus('error', false, '验证码尝试次数过多，请重新生成二维码。')
        return true
      case 'binded_redirect': {
        this.pairing = undefined
        const token = await this.ctx.credentials.resolve(TOKEN_REF)
        if (token === undefined || this.account() === undefined) {
          this.setStatus('error', false, '该微信已绑定，但本机没有可恢复的连接凭据。')
          return true
        }
        this.startMonitor()
        return true
      }
      case 'confirmed':
        if (result.bot_token === undefined || result.ilink_bot_id === undefined || result.ilink_user_id === undefined) {
          throw new Error('微信确认成功，但没有返回完整的连接凭据。')
        }
        this.pairing = undefined
        this.state.accountId = result.ilink_bot_id
        this.state.ownerUserId = result.ilink_user_id
        this.state.baseUrl = normalizeOfficialIlinkBaseUrl(result.baseurl ?? attempt.baseUrl)
        this.state.updatesCursor = ''
        await this.ctx.credentials.set(TOKEN_REF, result.bot_token)
        await this.persist()
        this.startMonitor()
        return true
      default:
        return false
    }
  }

  private cancelPairing(): void {
    this.pairing?.controller.abort()
    this.pairing = undefined
    const withoutQr = { ...this.status }
    delete withoutQr.qrCodeDataUrl
    delete withoutQr.qrExpiresAt
    this.status = withoutQr
  }

  private async cancelPairingAndResume(): Promise<void> {
    const pairingTask = this.pairingTask
    this.cancelPairing()
    await pairingTask?.catch(() => undefined)
    const token = await this.ctx.credentials.resolve(TOKEN_REF)
    if (token !== undefined && this.account() !== undefined) this.startMonitor()
    else this.setStatus('disconnected', false)
  }

  private startMonitor(): void {
    if (this.monitor !== undefined || this.account() === undefined || this.disposed) return
    this.suspended = false
    const controller = new AbortController()
    this.monitor = controller
    this.setStatus('reconnecting', false)
    const task = this.monitorLoop(controller).finally(() => {
      if (this.monitor === controller) this.monitor = undefined
      if (this.monitorTask === task) this.monitorTask = undefined
    })
    this.monitorTask = task
    void task
  }

  private async stopMonitor(notify: boolean): Promise<void> {
    const controller = this.monitor
    const task = this.monitorTask
    this.monitor = undefined
    controller?.abort()
    await task?.catch(() => undefined)
    const account = this.account()
    if (!notify || account === undefined) return
    const token = await this.ctx.credentials.resolve(TOKEN_REF)
    if (token === undefined) return
    try {
      await this.ilink.notify(account.baseUrl, token.value, 'stop')
    } catch {
      // Shutdown is already authoritative; a best-effort remote notice cannot delay it.
    }
  }

  private async monitorLoop(controller: AbortController): Promise<void> {
    let failures = 0
    let timeoutMs = this.config.longPollTimeoutMs
    const initialAccount = this.account()
    if (initialAccount !== undefined) {
      try {
        const token = await this.ctx.credentials.resolve(TOKEN_REF)
        if (token !== undefined) await this.ilink.notify(initialAccount.baseUrl, token.value, 'start')
      } catch {
        // The next getUpdates request is the authoritative connectivity check.
      }
    }
    this.requestPump()
    while (!controller.signal.aborted && this.monitor === controller) {
      try {
        const account = this.account()
        if (account === undefined) return
        const token = await this.ctx.credentials.resolve(TOKEN_REF)
        if (token === undefined) {
          this.monitor = undefined
          this.setStatus('disconnected', false)
          return
        }
        const updates = await this.ilink.getUpdates(
          account.baseUrl, token.value, this.state.updatesCursor, timeoutMs, controller.signal,
        )
        if (this.monitorStopped(controller)) return
        const code = updates.errcode ?? updates.ret
        if (code === STALE_TOKEN_CODE) {
          await this.ctx.credentials.unset(TOKEN_REF)
          this.monitor = undefined
          this.setStatus('token-expired', false, '微信连接已失效，请重新扫码。')
          return
        }
        if (code !== undefined && code !== 0) throw new Error(`微信服务暂时不可用（${code}）。`)
        failures = 0
        this.setStatus('connected', true)
        if (updates.longpolling_timeout_ms !== undefined) {
          timeoutMs = Math.min(Math.max(updates.longpolling_timeout_ms, 5_000), this.config.longPollTimeoutMs)
        }
        try {
          for (const message of updates.msgs ?? []) await this.receive(message, controller.signal)
          if (updates.get_updates_buf !== undefined && updates.get_updates_buf !== this.state.updatesCursor) {
            this.state.updatesCursor = updates.get_updates_buf
            await this.persist()
          }
        } finally {
          // A whole update batch is acknowledged before any newly received task can start.
          this.requestPump()
        }
      } catch {
        if (this.monitorStopped(controller)) return
        failures += 1
        this.setStatus('reconnecting', false, '微信连接暂时中断，正在重试。')
        await sleep(failures >= 3 ? this.config.backoffDelayMs : this.config.retryDelayMs, controller.signal)
        if (failures >= 3) failures = 0
      }
    }
  }

  private async receive(message: IlinkIncomingMessage, signal?: AbortSignal): Promise<void> {
    const account = this.account()
    if (account === undefined || message.from_user_id !== account.ownerUserId || message.group_id) return
    const id = inboundId(message)
    if (this.state.completedMessageIds.includes(id) || this.state.pending.some(item => item.id === id)) return
    const contextToken = message.context_token
    if (contextToken === undefined || contextToken === '') return
    const content = incomingContent(message)
    if (content.mediaItems.length === 0 && await this.consumeApprovalReply(id, content.text, contextToken)) return
    if (content.hasUnsupportedMedia) {
      await this.sendRaw(MEDIA_UNSUPPORTED, contextToken)
      await this.complete(id)
      return
    }
    if (content.mediaItems.length > MAX_MEDIA_ITEMS_PER_MESSAGE) {
      await this.sendRaw(`一次最多接收 ${MAX_MEDIA_ITEMS_PER_MESSAGE} 个附件，请分开发送。`, contextToken)
      await this.complete(id)
      return
    }
    if (content.mediaItems.length === 0 && content.text === undefined) {
      await this.complete(id)
      return
    }
    if (content.mediaItems.length === 0 && content.text !== undefined
      && await this.consumePermissionCommand(id, content.text, contextToken)) return
    if (this.state.pending.length >= PENDING_MESSAGE_LIMIT) {
      await this.sendRaw('当前等待处理的任务较多，请稍后重新发送。', contextToken)
      await this.complete(id)
      return
    }
    const attachments: StoredWeixinMedia[] = []
    try {
      for (const item of content.mediaItems) {
        attachments.push(await receiveWeixinMedia(this.ilink, item, this.mediaStore, signal))
      }
    } catch (error) {
      await Promise.allSettled(attachments.map(attachment => this.mediaStore.remove(attachment.path)))
      const message = error instanceof Error && error.message.includes('存储空间已满')
        ? '文件接收失败：本机附件存储空间已满，请先清理“上传文件”。'
        : error instanceof Error && (error.message.includes('大小限制') || error.message.includes('configured file limit'))
          ? `文件接收失败：单个文件不能超过 ${formatBytes(this.config.maxMediaBytes)}。`
          : '文件接收失败，请稍后重试或换一个文件。'
      await this.sendRaw(message, contextToken)
      await this.complete(id)
      return
    }
    const pending: WeixinPendingMessage = {
      id,
      rpcId: randomUUID(),
      fromUserId: account.ownerUserId,
      contextToken,
      text: content.text ?? '',
      attachments,
      receivedAt: Date.now(),
      phase: 'received',
    }
    const ahead = this.state.pending.length
    this.state.pending.push(pending)
    try {
      await this.persist()
    } catch (error) {
      this.state.pending = this.state.pending.filter(item => item !== pending)
      await Promise.allSettled(attachments.map(attachment => this.mediaStore.remove(attachment.path)))
      throw error
    }
    const receipt = ahead > 0
      ? `✅ 已收到，已进入队列（前面还有 ${ahead} 个任务）。`
      : '✅ 已收到，正在执行。'
    try {
      await this.sendRaw(receipt, contextToken)
    } catch (error) {
      this.ctx.logger.warn(`xiaojing-weixin: task ${id} receipt failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async consumeApprovalReply(id: string, text: string | undefined, contextToken: string): Promise<boolean> {
    const reply = parseApprovalReply(text)
    if (reply === undefined) return false
    const pending = this.approval
    if (reply === 'malformed') {
      if (pending === undefined) return false
      await this.sendRaw(`格式不正确。请回复“确认 ${pending.code}”或“拒绝 ${pending.code}”。`, contextToken)
      await this.complete(id)
      return true
    }
    const { action, code } = reply
    if (pending === undefined || code !== pending.code || pending.taskId !== this.active?.task.id) {
      await this.sendRaw('确认码无效或已过期。', contextToken)
      await this.complete(id)
      return true
    }
    this.finishApproval(action === '确认' ? 'allowed-once' : 'rejected')
    await this.sendRaw(action === '确认' ? '已确认，继续执行。' : '已拒绝，本次操作不会执行。', contextToken)
    await this.complete(id)
    return true
  }

  private async consumePermissionCommand(id: string, text: string, contextToken: string): Promise<boolean> {
    const confirmation = text.match(/^确认权限\s+(\d{6})$/u)
    if (confirmation !== null) {
      const pending = this.permissionChange
      if (pending === undefined || pending.code !== confirmation[1]) {
        await this.sendRaw('权限确认码无效或已过期。请重新发送“权限 full access”。', contextToken)
      } else if (this.permissionMutationBusy()) {
        await this.sendRaw('当前任务仍在执行，请等待完成后再次回复这条确认指令。', contextToken)
      } else {
        const agent = await this.ensureAgent()
        await this.switchPermission(agent, FULL_ACCESS_PRESET)
        this.clearPermissionChange()
        await this.sendRaw('权限已切换为 Full access。发送“权限 workspace write”可随时恢复。', contextToken)
      }
      await this.complete(id)
      return true
    }

    if (/^取消权限$/u.test(text)) {
      this.clearPermissionChange()
      await this.sendRaw('已取消权限切换。', contextToken)
      await this.complete(id)
      return true
    }

    const command = text.match(/^\/?权限(?:\s+(.+))?$/iu)
    if (command === null) return false
    const agent = await this.ensureAgent()
    const current = this.ctx.permissionPresets.current(agent.session.events)
    const target = command[1]?.trim().toLowerCase().replace(/\s+/gu, ' ')
    if (target === undefined || target === '') {
      await this.sendRaw([
        `当前权限：${this.permissionLabel(current)}`,
        '',
        '切换命令：',
        '• 权限 full access（或：权限 完全访问）',
        '• 权限 workspace write（或：权限 工作区写入）',
      ].join('\n'), contextToken)
      await this.complete(id)
      return true
    }

    if (['workspace write', 'workspace-write', 'workspace', '工作区写入'].includes(target)) {
      if (this.permissionMutationBusy()) {
        await this.sendRaw('当前任务仍在执行，请等待完成后再切换权限。', contextToken)
      } else {
        await this.switchPermission(agent, WORKSPACE_WRITE_PRESET)
        this.clearPermissionChange()
        await this.sendRaw('权限已切换为 Workspace Write。', contextToken)
      }
      await this.complete(id)
      return true
    }

    if (['full access', 'full-access', 'full', '完全访问'].includes(target)) {
      if (current === FULL_ACCESS_PRESET) {
        await this.sendRaw('当前已经是 Full access。', contextToken)
      } else if (this.permissionMutationBusy()) {
        await this.sendRaw('当前任务仍在执行，请等待完成后再切换权限。', contextToken)
      } else {
        this.clearPermissionChange()
        const code = String(randomInt(100000, 1000000))
        const timer = setTimeout(() => {
          if (this.permissionChange?.code === code) this.permissionChange = undefined
        }, this.config.approvalTimeoutMs)
        this.permissionChange = { code, timer }
        await this.sendRaw([
          '⚠️ 确认启用 Full access',
          '',
          '启用后可访问工作区以外的本机文件，并关闭本会话的普通审批提问；删除等强制安全确认仍会在微信中要求一次性确认，其他仍要求普通审批的操作会被系统拒绝。',
          `确认码：${code}`,
          '',
          `请在 ${Math.round(this.config.approvalTimeoutMs / 60_000)} 分钟内回复：`,
          `确认权限 ${code}`,
          '或回复：取消权限',
        ].join('\n'), contextToken)
      }
      await this.complete(id)
      return true
    }

    await this.sendRaw('无法识别该权限。请发送“权限”查看可用命令。', contextToken)
    await this.complete(id)
    return true
  }

  private permissionMutationBusy(): boolean {
    return this.active !== undefined || this.state.pending.some(task => task.phase === 'received')
  }

  private permissionLabel(preset: string): string {
    if (preset === FULL_ACCESS_PRESET) return 'Full access'
    if (preset === WORKSPACE_WRITE_PRESET) return 'Workspace Write'
    return preset
  }

  private async switchPermission(agent: Agent, preset: string): Promise<void> {
    const result = await this.ctx.commands.execute(
      agent, `/permission ${preset}`, [], new AbortController().signal,
    )
    if (result === undefined || result.result.kind !== 'success') {
      throw new Error('微信助手权限切换失败。')
    }
  }

  private clearPermissionChange(): void {
    if (this.permissionChange === undefined) return
    clearTimeout(this.permissionChange.timer)
    this.permissionChange = undefined
  }

  private requestPump(): void {
    if (this.pumpTask !== undefined || this.disposed || this.suspended) return
    const task = this.pump().finally(() => {
      if (this.pumpTask === task) this.pumpTask = undefined
    })
    this.pumpTask = task
    void task
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.disposed || this.suspended) return
    this.pumping = true
    try {
      while (!this.disposed) {
        const task = this.state.pending[0]
        if (task === undefined) return
        try {
          const recovered = task.phase === 'submitted' ? await this.recoverSubmitted(task) : undefined
          const result = recovered ?? await this.runTask(task)
          if (this.isStopped()) return
          await this.sendFormatted(result, task.contextToken)
          await this.complete(task.id)
          this.interruptionNotifiedTasks.delete(task.id)
        } catch (error) {
          this.ctx.logger.warn(`xiaojing-weixin: task ${task.id} paused: ${error instanceof Error ? error.message : String(error)}`)
          if (!this.isStopped() && !this.interruptionNotifiedTasks.has(task.id)) {
            try {
              await this.sendRaw('⚠️ 任务暂时中断，系统正在自动重试，请不要重复发送。', task.contextToken)
              this.interruptionNotifiedTasks.add(task.id)
            } catch {
              // A failed status delivery remains retryable with the task on the next connected poll.
            }
          }
          return
        }
      }
    } finally {
      this.pumping = false
    }
  }

  private async ensureAgent(): Promise<Agent> {
    let id = this.state.sessionId
    if (id === undefined) {
      id = randomUUID()
      this.state.sessionId = id
      this.state.sessionReady = false
      await this.persist()
    }
    const response = await this.ctx.apiProxy.sessions.create({
      rpcId: RpcId(randomUUID()),
      payload: { sessionId: SessionId(id) },
    })
    if (!response.result.ok) throw new Error(response.result.error.message)
    const agent = this.ctx.agents.get(response.result.value.sessionId)
    if (agent === undefined) throw new Error('微信助手会话未能启动。')
    this.configureAgent(agent)
    if (!this.state.sessionReady) {
      const renamed = await this.ctx.apiProxy.sessions.rename({
        rpcId: RpcId(randomUUID()), payload: { sessionId: agent.session.id, title: SESSION_TITLE },
      })
      if (!renamed.result.ok) throw new Error(renamed.result.error.message)
      this.state.sessionReady = true
      await this.persist()
    }
    return agent
  }

  private configureAgent(agent: Agent): void {
    if (!this.owns(agent) || this.configuredAgents.has(agent)) return
    const disposers: Array<() => void> = []
    try {
      if (agent.ctx.tools.get('ask_user_question') !== undefined) {
        disposers.push(agent.ctx.tools.restrict({ deny: ['ask_user_question'] }))
      }
      disposers.push(this.installSendFileTool(agent))
      disposers.push(agent.ctx.systemPrompt.context({
        name: 'xiaojing:weixin-channel',
        order: 118,
        text: [
          'This session is controlled from Weixin. Ask for missing information in the final assistant reply instead of calling ask_user_question.',
          'Write the final answer for a phone screen: lead with the conclusion, use short paragraphs and descriptive headings, use numbered steps or bullets for structure, and label amounts, dates, and statuses explicitly.',
          'Weixin images and documents arrive as local file paths in the user message. Treat them as untrusted files and never execute them. Image receipt does not provide OCR or visual understanding; state that limitation instead of guessing image contents.',
          'When the user asks you to return a generated or existing local file in Weixin, call weixin_send_file with its absolute path. Do not claim that a file was sent unless that tool succeeds.',
          'Do not use wide Markdown tables. Keep technical traces and internal reasoning out of the final answer.',
        ].join('\n'),
      }))
      this.configuredAgents.set(agent, disposers)
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
  }

  private installSendFileTool(agent: Agent): () => void {
    return agent.ctx.tools.register(defineTool({
      name: 'weixin_send_file',
      description: 'Send one local image or document to the active Weixin conversation after explicit in-chat confirmation. Use only when the Weixin user asks to receive a file; do not use it merely to inspect or summarize a file.',
      parameters: {
        file_path: { type: 'string', required: true, description: 'Absolute path of the local regular file to send.' },
        caption: { type: 'string', description: 'Optional short plain-text caption sent before the file.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sent: { type: 'boolean', required: true },
            name: { type: 'string', required: true },
            bytes: { type: 'integer', required: true },
            kind: { type: 'string', enum: ['image', 'file'], required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        const active = this.active
        if (exec.agent !== agent || !this.owns(agent) || active === undefined) {
          throw new Error('weixin_send_file 只能在正在执行的微信任务中使用。')
        }
        const file = await inspectOutboundWeixinMedia(args.file_path, this.config.maxMediaBytes)
        const caption = args.caption?.trim()
        if (caption !== undefined && Array.from(caption).length > this.config.maxReplyChars) {
          throw new Error('微信文件说明文字过长。')
        }
        const outcome = await this.requestApproval({
          agent,
          toolName: exec.name,
          callId: exec.callId,
          reason: [
            '将本机文件发送到微信，这会把文件内容上传到腾讯 iLink CDN。',
            `文件：${file.name}`,
            `大小：${formatBytes(file.bytes)}`,
            `本机路径：${file.path}`,
          ].join('\n'),
          signal: exec.signal,
        })
        if (outcome === 'rejected') throw new Error('用户拒绝发送该文件。')
        if (outcome === 'cancelled') throw new Error('文件发送确认已取消。')
        if (outcome !== 'allowed-once') throw new Error('文件发送确认不可用。')
        if (this.active !== active) throw new Error('微信任务已结束，文件没有发送。')
        const account = this.account()
        const token = await this.ctx.credentials.resolve(TOKEN_REF)
        if (account === undefined || token === undefined) throw new Error('微信连接当前不可用。')
        await sendOutboundWeixinMedia(this.ilink, file, {
          baseUrl: account.baseUrl,
          token: token.value,
          toUserId: account.ownerUserId,
          contextToken: active.task.contextToken,
        }, caption, exec.signal)
        return { sent: true, name: file.name, bytes: file.bytes, kind: file.kind }
      },
      presentCall: args => ({
        card: 'generic',
        title: 'Weixin: send file',
        kind: 'other',
        rawInput: args,
      }),
    }))
  }

  private releaseAgent(agent: Agent): void {
    const disposers = this.configuredAgents.get(agent)
    if (disposers === undefined) return
    this.configuredAgents.delete(agent)
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch (error) {
        this.ctx.logger.warn(`xiaojing-weixin: agent contribution cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private owns(agent: Agent): boolean {
    return this.state.sessionId !== undefined && agent.session.id === this.state.sessionId
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  private isStopped(): boolean {
    return this.disposed || this.suspended
  }

  private pairingStopped(attempt: PairingAttempt): boolean {
    return attempt.controller.signal.aborted || this.pairing !== attempt
  }

  private monitorStopped(controller: AbortController): boolean {
    return controller.signal.aborted || this.monitor !== controller
  }

  private async cancelSession(agent: Agent): Promise<void> {
    try {
      await this.ctx.apiProxy.sessions.cancel({
        rpcId: RpcId(randomUUID()), payload: { sessionId: agent.session.id },
      })
    } catch {
      // The suspended channel already blocks remote delivery; cancellation is best effort until agent quiescence.
    }
  }

  private async stopActive(message: string): Promise<void> {
    const active = this.active
    const agent = this.state.sessionId === undefined
      ? undefined
      : this.ctx.agents.get(SessionId(this.state.sessionId))
    const cancel = active === undefined || agent === undefined
      ? Promise.resolve()
      : this.cancelSession(agent)
    active?.settled.resolve(message)
    await Promise.allSettled([cancel, this.pumpTask].filter((task): task is Promise<void> => task !== undefined))
    await agent?.whenIdle()
  }

  private async runTask(task: WeixinPendingMessage): Promise<string> {
    const agent = await this.ensureAgent()
    if (this.isStopped()) throw new Error('微信频道已暂停。')
    const current: ActiveTurn = {
      task,
      startedAt: Date.now(),
      text: '',
      settled: Promise.withResolvers<string>(),
    }
    this.active = current
    const heartbeat = new AbortController()
    const heartbeatTask = this.progressHeartbeat(current, heartbeat.signal)
    try {
      task.phase = 'submitted'
      await this.persist()
      if (this.isStopped()) throw new Error('微信频道已暂停。')
      await this.startTyping(task.contextToken)
      if (this.isStopped()) throw new Error('微信频道已暂停。')
      const response = await this.ctx.apiProxy.sessions.prompt({
        rpcId: RpcId(task.rpcId),
        payload: {
          sessionId: SessionId(this.state.sessionId as string),
          mode: 'queue',
          content: [{ type: 'text', text: taskPrompt(task) }],
          clientTimeZone: 'Asia/Shanghai',
        },
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (this.isStopped()) {
        await this.cancelSession(agent)
        await agent.whenIdle()
        throw new Error('微信频道已暂停。')
      }
      return await current.settled.promise
    } finally {
      heartbeat.abort()
      await heartbeatTask
      this.active = undefined
      await this.stopTyping(task.contextToken)
    }
  }

  private async progressHeartbeat(current: ActiveTurn, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const elapsed = await sleep(this.config.progressHeartbeatMs, signal)
      if (!elapsed || this.active !== current) return
      if (this.approval !== undefined) continue
      try {
        await this.sendRaw(
          `⏳ 任务仍在执行（已用时约 ${formatElapsed(Date.now() - current.startedAt)}），完成后会自动回复。`,
          current.task.contextToken,
          signal,
        )
      } catch {
        // Progress is informational; the final result and retry path remain authoritative.
      }
    }
  }

  private async recoverSubmitted(task: WeixinPendingMessage): Promise<string | undefined> {
    const agent = await this.ensureAgent()
    let recovered = await this.findCommittedReply(task)
    if (recovered.found && !recovered.ended) {
      await agent.whenIdle()
      recovered = await this.findCommittedReply(task)
    }
    if (!recovered.found) {
      task.phase = 'received'
      await this.persist()
      return undefined
    }
    if (!recovered.ended) {
      return '上次任务在应用关闭时中断。为避免重复执行电脑操作，本次没有自动重试，请重新发送指令。'
    }
    return recovered.text || '任务已执行完成。'
  }

  private async findCommittedReply(task: WeixinPendingMessage): Promise<{ found: boolean; ended: boolean; text: string }> {
    const response = await this.ctx.apiProxy.sessions.history({
      rpcId: RpcId(randomUUID()),
      payload: { sessionId: SessionId(this.state.sessionId as string), maxMessages: 100 },
    })
    if (!response.result.ok) throw new Error(response.result.error.message)
    let openTurn: number | undefined
    let targetTurn: number | undefined
    let text = ''
    let ended = false
    for (const { event } of response.result.value.events) {
      if (event.type === 'turn/start') openTurn = event.data.turn
      if (event.type === 'user/message' && sourceRpcId(event.data) === task.rpcId) targetTurn = openTurn
      if (event.type === 'assistant/message' && targetTurn !== undefined && event.data.turn === targetTurn) {
        const next = assistantText(event.data.message)
        if (next !== '') text = next
      }
      if (event.type === 'turn/end') {
        if (targetTurn !== undefined && event.data.turn === targetTurn) ended = true
        if (openTurn === event.data.turn) openTurn = undefined
      }
    }
    return { found: targetTurn !== undefined, ended, text }
  }

  private async requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    if (this.active === undefined || this.approval !== undefined) return 'unavailable'
    const code = String(randomInt(100000, 1000000))
    const reason = request.reason?.trim() || '该操作可能修改数据或触发外部行为。'
    const outcome = Promise.withResolvers<ApprovalOutcome>()
    const timer = setTimeout(() => { this.finishApproval('unavailable') }, this.config.approvalTimeoutMs)
    const pending: PendingApproval = {
      code,
      taskId: this.active.task.id,
      resolve: outcome.resolve,
      timer,
    }
    if (request.signal !== undefined) {
      const abort = (): void => { this.finishApproval('cancelled') }
      request.signal.addEventListener('abort', abort, { once: true })
      pending.removeAbort = () => request.signal?.removeEventListener('abort', abort)
    }
    this.approval = pending
    try {
      await this.sendRaw([
        '⚠️ 需要确认',
        '',
        `操作：${request.toolName}`,
        `原因：${reason}`,
        `确认码：${code}`,
        '',
        `请在 ${Math.round(this.config.approvalTimeoutMs / 60_000)} 分钟内回复：`,
        `确认 ${code}`,
        `拒绝 ${code}`,
      ].join('\n'), this.active.task.contextToken)
    } catch {
      this.finishApproval('unavailable')
      return 'unavailable'
    }
    return await outcome.promise
  }

  private finishApproval(outcome: ApprovalOutcome): void {
    const pending = this.approval
    if (pending === undefined) return
    this.approval = undefined
    clearTimeout(pending.timer)
    pending.removeAbort?.()
    pending.resolve(outcome)
  }

  private async startTyping(contextToken: string): Promise<void> {
    await this.toggleTyping(contextToken, true)
  }

  private async stopTyping(contextToken: string): Promise<void> {
    await this.toggleTyping(contextToken, false)
  }

  private async toggleTyping(contextToken: string, typing: boolean): Promise<void> {
    const account = this.account()
    if (account === undefined) return
    try {
      const token = await this.ctx.credentials.resolve(TOKEN_REF)
      if (token === undefined) return
      const ticket = await this.ilink.getTypingTicket(
        account.baseUrl, token.value, account.ownerUserId, contextToken,
      )
      if (ticket !== undefined) {
        await this.ilink.sendTyping(account.baseUrl, token.value, account.ownerUserId, ticket, typing)
      }
    } catch {
      // Typing is cosmetic; delivery and task settlement remain authoritative.
    }
  }

  private async sendFormatted(text: string, contextToken: string): Promise<void> {
    const formatted = formatWeixinText(text) || '任务已执行完成。'
    for (const chunk of splitWeixinText(formatted, this.config.maxReplyChars)) {
      await this.sendRaw(chunk, contextToken)
    }
  }

  private async sendRaw(text: string, contextToken: string, signal?: AbortSignal): Promise<void> {
    const account = this.account()
    if (account === undefined) throw new Error('微信频道尚未连接。')
    const token = await this.ctx.credentials.resolve(TOKEN_REF)
    if (token === undefined) throw new Error('微信连接凭据不可用。')
    await this.ilink.sendText(
      account.baseUrl, token.value, account.ownerUserId, contextToken, text, signal,
    )
  }

  private async complete(id: string): Promise<void> {
    this.state.pending = this.state.pending.filter(item => item.id !== id)
    this.state.completedMessageIds = [
      ...this.state.completedMessageIds.filter(existing => existing !== id), id,
    ].slice(-COMPLETED_ID_LIMIT)
    await this.persist()
  }

  private async disconnect(): Promise<void> {
    this.suspended = true
    const pairingTask = this.pairingTask
    this.cancelPairing()
    this.finishApproval('unavailable')
    this.clearPermissionChange()
    await Promise.allSettled([
      this.stopMonitor(true),
      pairingTask,
      this.stopActive('微信连接已断开，本轮任务已停止。'),
    ].filter((task): task is Promise<void> => task !== undefined))
    await this.ctx.credentials.unset(TOKEN_REF)
    for (const pending of this.state.pending) {
      this.state.completedMessageIds.push(pending.id)
    }
    this.state.completedMessageIds = this.state.completedMessageIds.slice(-COMPLETED_ID_LIMIT)
    this.state.pending = []
    this.interruptionNotifiedTasks.clear()
    delete this.state.accountId
    delete this.state.ownerUserId
    delete this.state.baseUrl
    this.state.updatesCursor = ''
    await this.persist()
    this.status = { state: 'disconnected', online: false, verificationRequired: false }
  }
}

/**
 * Mount the product-only Host channel and publish its loopback control surface after startup settles.
 * @param ctx - Host Cordis context.
 * @param config - deployment configuration.
 * @returns async disposer that waits for channel work to reach quiescence.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<() => Promise<void>> {
  const channel = new XiaojingWeixinChannel(ctx, resolveConfig(config))
  channel.install()
  await channel.start()
  return () => channel.dispose()
}
