/** Authenticated loopback bridge to the optional Xiaojing personal Edge extension. */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WebSocketServer, WebSocket } from 'ws'
import type { RawData } from 'ws'
import { BrowserPageId, BrowserWindowId } from './types.ts'
import type {
  BrowserControlStatus,
  BrowserDisposition,
  BrowserPageId as PageId,
  PersonalEdgeState,
  BrowserStepAction,
  BrowserTarget,
  BrowserWindowId as WindowId,
} from './types.ts'

/** Stable unpacked extension ID derived from the manifest public key. */
export const PERSONAL_EDGE_EXTENSION_ID = 'gdaibiaipdgjnkgepfbdllgaejabmfee'
/** Versioned protocol spoken only over the loopback WebSocket bridge. */
export const PERSONAL_EDGE_PROTOCOL_VERSION = 1
/** Fixed loopback discovery range probed by the extension. */
export const PERSONAL_EDGE_PORTS = Object.freeze(Array.from({ length: 10 }, (_value, index) => 53_170 + index))

const SECRET_REF = credentialRef('XIAOJING_EDGE_EXTENSION_TOKEN')
const PAIRING_LIFETIME_MS = 120_000
const MAX_PAIRING_ATTEMPTS = 5
const REQUEST_TIMEOUT_MS = 30_000
const DISCOVERY_TIMEOUT_MS = 1_500
const CONTROL_TIMEOUT_MS = 5_000

/** One personal Edge page reported by the authenticated extension. */
export interface PersonalPageRecord {
  readonly id: PageId
  readonly tabId: number
  readonly windowId: WindowId
  readonly url: string
  readonly title: string
  readonly active: boolean
  readonly openerTabId?: number
}

/** Internal target descriptor understood only by the fixed extension implementation. */
export interface PersonalTargetDescriptor {
  readonly frameId: number
  readonly role: string
  readonly name: string
  readonly context: string
  readonly inputType: string
  readonly ordinal: number
}

/** One personal Edge target before the coordinator assigns an opaque target ID. */
export interface PersonalScannedTarget {
  readonly descriptor: PersonalTargetDescriptor
  readonly target: Omit<BrowserTarget, 'id'>
}

/** Bounded personal Edge observation. */
export interface PersonalPageScan {
  readonly url: string
  readonly title: string
  readonly text: string
  readonly targets: PersonalScannedTarget[]
  readonly truncated: boolean
}

/** Fixed action payload accepted by the extension; selectors and JavaScript are intentionally absent. */
export interface PersonalActionCommand {
  readonly action: BrowserStepAction
  readonly descriptor?: PersonalTargetDescriptor
  readonly semantic?: { readonly role?: string; readonly name?: string; readonly context?: string }
  readonly value?: string
  readonly key?: string
  readonly deltaY?: number
  readonly paths?: readonly string[]
  readonly expectedUrl?: string
  readonly expectedText?: string
  readonly timeoutMs?: number
}

interface PairingAttempt {
  readonly code: string
  readonly expiresAt: number
  attempts: number
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly cleanup: () => void
}

interface ExtensionHello {
  readonly type: 'hello'
  readonly extensionId: string
  readonly protocol: number
  readonly version: string
  readonly nonce: string
  readonly proof?: string
}

interface ExtensionPair {
  readonly type: 'pair'
  readonly code: string
}

interface ExtensionResponse {
  readonly type: 'response'
  readonly id: string
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: string
}

interface ExtensionHeartbeat {
  readonly type: 'heartbeat'
}

type ExtensionMessage = ExtensionHello | ExtensionPair | ExtensionResponse | ExtensionHeartbeat

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function handshakeProof(secret: string, participant: 'extension' | 'host', nonce: string): string {
  return createHmac('sha256', secret).update(`${participant}:${nonce}`).digest('base64url')
}

function parseMessage(data: RawData): ExtensionMessage {
  const text = Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(data)).toString('utf8')
      : data.toString('utf8')
  const value = JSON.parse(text) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid extension message')
  const row = value as Record<string, unknown>
  if (row.type === 'hello' && typeof row.extensionId === 'string' && typeof row.protocol === 'number'
    && typeof row.version === 'string' && typeof row.nonce === 'string'
    && /^[A-Za-z0-9_-]{43}$/u.test(row.nonce)
    && (row.proof === undefined || (typeof row.proof === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(row.proof)))) {
    return {
      type: 'hello', extensionId: row.extensionId, protocol: row.protocol, version: row.version, nonce: row.nonce,
      ...(typeof row.proof === 'string' ? { proof: row.proof } : {}),
    }
  }
  if (row.type === 'pair' && typeof row.code === 'string') return { type: 'pair', code: row.code }
  if (row.type === 'heartbeat') return { type: 'heartbeat' }
  if (row.type === 'response' && typeof row.id === 'string' && typeof row.ok === 'boolean'
    && (row.error === undefined || typeof row.error === 'string')) {
    return {
      type: 'response', id: row.id, ok: row.ok,
      ...(row.value === undefined ? {} : { value: row.value }),
      ...(typeof row.error === 'string' ? { error: row.error } : {}),
    }
  }
  throw new Error('invalid extension message')
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) throw new Error('personal Edge extension is disconnected')
  socket.send(JSON.stringify(value))
}

function pageRecord(value: unknown): PersonalPageRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid personal Edge tab')
  const row = value as Record<string, unknown>
  if (!Number.isSafeInteger(row.tabId) || !Number.isSafeInteger(row.windowId)
    || typeof row.url !== 'string' || typeof row.title !== 'string' || typeof row.active !== 'boolean'
    || (row.openerTabId !== undefined && !Number.isSafeInteger(row.openerTabId))) {
    throw new Error('invalid personal Edge tab')
  }
  const tabId = row.tabId as number
  const windowId = row.windowId as number
  return {
    id: BrowserPageId(`bp-personal-${String(tabId)}`),
    tabId,
    windowId: BrowserWindowId(`bw-personal-${String(windowId)}`),
    url: row.url,
    title: row.title,
    active: row.active,
    ...(row.openerTabId === undefined ? {} : { openerTabId: row.openerTabId as number }),
  }
}

/** Personal Edge connection, pairing, discovery, and fixed semantic command transport. */
export class PersonalEdgeAdapter {
  private server: WebSocketServer | undefined
  private socket: WebSocket | undefined
  private authenticated = false
  private paired = false
  private pairing: PairingAttempt | undefined
  private extensionVersion: string | undefined
  private stateError: string | undefined
  private protocolIncompatible = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly attachedTabs = new Set<number>()
  private readonly connections = new Set<WebSocket>()
  private readonly pairingEligible = new WeakSet<WebSocket>()
  private port: number | undefined

  /** @param extensionDir - Absolute unpacked extension folder revealed only through the fixed settings action. */
  constructor(private readonly ctx: Context, readonly extensionDir: string) {}

  /** Bind the first available fixed loopback port and load pairing state. */
  async start(): Promise<void> {
    this.paired = await this.ctx.credentials.resolve(SECRET_REF) !== undefined
    for (const port of PERSONAL_EDGE_PORTS) {
      const server = await this.tryListen(port)
      if (server === undefined) continue
      this.server = server
      this.port = port
      server.on('connection', (socket, request) => {
        if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1'
          && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
          socket.close(1008, 'loopback only')
          return
        }
        this.accept(socket)
      })
      return
    }
    throw new Error(`personal Edge bridge could not bind ports ${PERSONAL_EDGE_PORTS[0]}-${PERSONAL_EDGE_PORTS.at(-1)}`)
  }

  /**
   * Sanitized status for the loopback settings Client.
   * @param managedRunning - Whether the dedicated Edge route is currently running.
   * @returns Public settings state without credentials or page content.
   */
  snapshot(managedRunning: boolean): BrowserControlStatus {
    const now = Date.now()
    if (this.pairing !== undefined && this.pairing.expiresAt <= now) this.pairing = undefined
    let state: PersonalEdgeState = 'not-connected'
    if (this.authenticated) state = 'connected'
    else if (this.protocolIncompatible) state = 'incompatible'
    else if (this.stateError !== undefined) state = 'error'
    else if (this.pairing !== undefined) state = 'pairing'
    return {
      managed: { enabled: true, running: managedRunning },
      personal: {
        state,
        extensionId: PERSONAL_EDGE_EXTENSION_ID,
        connected: this.authenticated,
        paired: this.paired,
        ...(this.extensionVersion === undefined ? {} : { version: this.extensionVersion }),
        ...(this.pairing === undefined ? {} : {
          pairingCode: this.pairing.code,
          pairingExpiresAt: this.pairing.expiresAt,
        }),
        ...(this.stateError === undefined ? {} : { error: this.stateError }),
      },
    }
  }

  /**
   * Preserve an optional-route startup failure for settings without taking down managed Edge.
   * @param error - Loopback bridge startup failure.
   */
  reportStartupFailure(error: unknown): void {
    this.stateError = error instanceof Error ? error.message : String(error)
  }

  /** Mint a short-lived code that must be typed into the extension popup. */
  startPairing(): void {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = randomBytes(8)
    let code = ''
    for (const byte of bytes) code += alphabet.charAt(byte % alphabet.length)
    this.pairing = { code, expiresAt: Date.now() + PAIRING_LIFETIME_MS, attempts: 0 }
    this.stateError = undefined
    this.protocolIncompatible = false
  }

  /** Cancel a pending code without revoking an established secret. */
  cancelPairing(): void {
    this.pairing = undefined
  }

  /** Revoke the stored secret and close the authenticated connection. */
  async disconnect(): Promise<void> {
    this.pairing = undefined
    this.paired = false
    this.authenticated = false
    this.protocolIncompatible = false
    await this.ctx.credentials.unset(SECRET_REF)
    const socket = this.socket
    this.socket = undefined
    this.attachedTabs.clear()
    socket?.close(4001, 'authorization revoked')
    this.rejectPending(new Error('personal Edge authorization was revoked'))
  }

  /**
   * Discover normal HTTP(S) tabs without attaching to them.
   * @returns Validated personal Edge tab records, or an empty list while disconnected.
   */
  async pages(): Promise<PersonalPageRecord[]> {
    if (!this.authenticated) return []
    const value = await this.request('tabs', {}, undefined, DISCOVERY_TIMEOUT_MS)
    if (!Array.isArray(value)) throw new Error('personal Edge returned an invalid tab list')
    return value.map(pageRecord)
  }

  /**
   * Open a personal Edge tab or top-level window when the user explicitly chose that route.
   * @param url - Absolute HTTP or HTTPS destination.
   * @param disposition - Whether to create a tab or top-level window.
   * @returns The newly opened tab record.
   */
  async open(url: string, disposition: BrowserDisposition): Promise<PersonalPageRecord> {
    const value = await this.request('open', { url, disposition }, undefined, CONTROL_TIMEOUT_MS)
    return pageRecord(value)
  }

  /**
   * Attach the debugger to the selected tab for this task.
   * @param record - Personal Edge tab selected by the coordinator.
   */
  async acquire(record: PersonalPageRecord): Promise<void> {
    if (this.attachedTabs.has(record.tabId)) return
    await this.request('attach', { tabId: record.tabId }, undefined, CONTROL_TIMEOUT_MS)
    this.attachedTabs.add(record.tabId)
  }

  /**
   * Detach the debugger when a task ends, fails, or is cancelled.
   * @param record - Personal Edge tab whose task lease ended.
   */
  async release(record: PersonalPageRecord): Promise<void> {
    if (!this.attachedTabs.delete(record.tabId) || !this.authenticated) return
    await this.request('detach', { tabId: record.tabId }, undefined, CONTROL_TIMEOUT_MS).catch(() => undefined)
  }

  /**
   * Read one page through the extension's fixed semantic scanner.
   * @param record - Attached personal Edge tab.
   * @param maxTargets - Maximum semantic controls to return.
   * @param maxTextChars - Maximum visible text characters to return.
   * @returns Validated bounded semantic page state.
   */
  async observe(record: PersonalPageRecord, maxTargets: number, maxTextChars: number): Promise<PersonalPageScan> {
    const value = await this.request(
      'observe',
      { tabId: record.tabId, maxTargets, maxTextChars },
      undefined,
      CONTROL_TIMEOUT_MS,
    )
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid personal Edge observation')
    const row = value as Record<string, unknown>
    if (typeof row.url !== 'string' || typeof row.title !== 'string' || typeof row.text !== 'string'
      || typeof row.truncated !== 'boolean' || !Array.isArray(row.targets)) {
      throw new Error('invalid personal Edge observation')
    }
    const targets = row.targets.map((candidate): PersonalScannedTarget => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        throw new Error('invalid personal Edge target')
      }
      const target = candidate as Record<string, unknown>
      if (!Number.isSafeInteger(target.frameId) || typeof target.role !== 'string' || typeof target.name !== 'string'
        || typeof target.context !== 'string' || typeof target.inputType !== 'string'
        || !Number.isSafeInteger(target.ordinal) || typeof target.disabled !== 'boolean' || !Array.isArray(target.actions)
        || !target.actions.every(action => typeof action === 'string')) {
        throw new Error('invalid personal Edge target')
      }
      return {
        descriptor: {
          frameId: target.frameId as number,
          role: target.role,
          name: target.name,
          context: target.context,
          inputType: target.inputType,
          ordinal: target.ordinal as number,
        },
        target: {
          role: target.role,
          name: target.name,
          ...(target.context === '' ? {} : { context: target.context }),
          ...(typeof target.value === 'string' ? { value: target.value } : {}),
          disabled: target.disabled,
          ...(typeof target.checked === 'boolean' ? { checked: target.checked } : {}),
          actions: target.actions as BrowserStepAction[],
        },
      }
    })
    return { url: row.url, title: row.title, text: row.text, truncated: row.truncated, targets }
  }

  /**
   * Execute one fixed semantic command on an attached personal Edge tab.
   * @param record - Attached personal Edge tab.
   * @param command - Validated semantic command.
   * @param signal - Optional task cancellation signal.
   */
  async act(record: PersonalPageRecord, command: PersonalActionCommand, signal?: AbortSignal): Promise<void> {
    const timeout = Math.max(REQUEST_TIMEOUT_MS, (command.timeoutMs ?? 0) + 1_000)
    await this.request('act', { tabId: record.tabId, command }, signal, timeout)
  }

  /**
   * Show an already selected personal Edge page.
   * @param record - Personal Edge tab to activate.
   */
  async show(record: PersonalPageRecord): Promise<void> {
    await this.request(
      'show',
      { tabId: record.tabId, windowId: Number(record.windowId.replace('bw-personal-', '')) },
      undefined,
      CONTROL_TIMEOUT_MS,
    )
  }

  /**
   * Close a personal Edge page.
   * @param record - Personal Edge tab to close.
   */
  async closePage(record: PersonalPageRecord): Promise<void> {
    this.attachedTabs.delete(record.tabId)
    await this.request('close', { tabId: record.tabId }, undefined, CONTROL_TIMEOUT_MS)
  }

  /** Stop the bridge, reject waiting calls, and detach every controlled tab. */
  async close(): Promise<void> {
    const attached = [...this.attachedTabs]
    const detachController = new AbortController()
    const detachTimer = setTimeout(() => {
      detachController.abort(new Error('personal Edge detach timed out during shutdown'))
    }, 1_000)
    detachTimer.unref()
    await Promise.allSettled(attached.map(tabId => this.request(
      'detach',
      { tabId },
      detachController.signal,
      CONTROL_TIMEOUT_MS,
    )))
    clearTimeout(detachTimer)
    this.attachedTabs.clear()
    this.rejectPending(new Error('personal Edge bridge stopped'))
    this.socket?.close(1001, 'host stopped')
    this.socket = undefined
    this.authenticated = false
    for (const connection of this.connections) connection.terminate()
    this.connections.clear()
    const server = this.server
    this.server = undefined
    if (server !== undefined) await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }

  private async tryListen(port: number): Promise<WebSocketServer | undefined> {
    const server = new WebSocketServer({ host: '127.0.0.1', port })
    return await new Promise((resolve, reject) => {
      const onListening = () => {
        server.off('error', onError)
        resolve(server)
      }
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening)
        if (error.code === 'EADDRINUSE') resolve(undefined)
        else reject(error)
      }
      server.once('listening', onListening)
      server.once('error', onError)
    })
  }

  private accept(socket: WebSocket): void {
    let hello = false
    this.connections.add(socket)
    socket.on('message', (data) => {
      let parsed: ExtensionMessage
      try {
        parsed = parseMessage(data)
      } catch {
        socket.close(1008, 'invalid message')
        return
      }
      void this.handleMessage(socket, parsed, () => { hello = true }).catch(() => {
        socket.close(1011, 'message handling failed')
      })
    })
    socket.on('close', () => {
      this.connections.delete(socket)
      this.pairingEligible.delete(socket)
      if (this.socket !== socket) return
      this.socket = undefined
      this.authenticated = false
      this.attachedTabs.clear()
      this.rejectPending(new Error('personal Edge extension disconnected'))
    })
    setTimeout(() => {
      if (!hello && socket.readyState === WebSocket.OPEN) socket.close(1008, 'hello timeout')
    }, 5_000).unref()
  }

  private async handleMessage(socket: WebSocket, message: ExtensionMessage, markHello: () => void): Promise<void> {
    if (message.type === 'hello') {
      markHello()
      if (message.extensionId !== PERSONAL_EDGE_EXTENSION_ID) {
        socket.close(1008, 'wrong extension')
        return
      }
      this.extensionVersion = message.version
      if (message.protocol !== PERSONAL_EDGE_PROTOCOL_VERSION) {
        this.protocolIncompatible = true
        this.stateError = '扩展协议版本不兼容，请更新小兢会计 Edge 扩展。'
        send(socket, { type: 'hello-result', state: 'incompatible', protocol: PERSONAL_EDGE_PROTOCOL_VERSION })
        return
      }
      this.pairingEligible.add(socket)
      const stored = await this.ctx.credentials.resolve(SECRET_REF)
      this.protocolIncompatible = false
      if (stored !== undefined && message.proof !== undefined
        && safeEqual(handshakeProof(stored.value, 'extension', message.nonce), message.proof)) {
        this.activate(socket)
        send(socket, {
          type: 'hello-result', state: 'connected', port: this.port,
          hostProof: handshakeProof(stored.value, 'host', message.nonce),
        })
        return
      }
      send(socket, { type: 'hello-result', state: 'pairing-required', port: this.port })
      return
    }
    if (message.type === 'pair') {
      if (!this.pairingEligible.has(socket)) {
        socket.close(1008, 'hello required')
        return
      }
      const attempt = this.pairing
      if (attempt === undefined || attempt.expiresAt <= Date.now()) {
        this.pairing = undefined
        send(socket, { type: 'pair-result', ok: false, error: 'pairing-expired' })
        return
      }
      attempt.attempts += 1
      if (!safeEqual(attempt.code, message.code.toUpperCase())) {
        if (attempt.attempts >= MAX_PAIRING_ATTEMPTS) this.pairing = undefined
        send(socket, { type: 'pair-result', ok: false, error: 'pairing-code-invalid' })
        return
      }
      const secret = randomBytes(32).toString('base64url')
      await this.ctx.credentials.set(SECRET_REF, secret)
      this.paired = true
      this.pairing = undefined
      this.activate(socket)
      send(socket, { type: 'pair-result', ok: true, secret })
      return
    }
    if (message.type === 'response') {
      if (socket !== this.socket || !this.authenticated) return
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      pending.cleanup()
      if (message.ok) pending.resolve(message.value)
      else pending.reject(new Error(message.error ?? 'personal Edge command failed'))
      return
    }
    return
  }

  private activate(socket: WebSocket): void {
    if (this.socket !== undefined && this.socket !== socket) {
      this.rejectPending(new Error('personal Edge extension connection was replaced'))
      this.attachedTabs.clear()
      this.socket.close(4000, 'replaced')
    }
    this.socket = socket
    this.authenticated = true
    this.stateError = undefined
    this.protocolIncompatible = false
  }

  private request(
    method: string,
    payload: unknown,
    signal?: AbortSignal,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const socket = this.socket
    if (socket === undefined || !this.authenticated) {
      return Promise.reject(new Error('个人 Edge 扩展未连接；请在“浏览器控制”设置中安装并配对扩展。'))
    }
    if (signal?.aborted === true) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('browser operation cancelled'))
    }
    const id = `edge-${randomUUID()}`
    return new Promise((resolve, reject) => {
      const aborted = () => {
        const pending = this.pending.get(id)
        if (pending === undefined) return
        this.pending.delete(id)
        clearTimeout(pending.timer)
        pending.cleanup()
        try {
          send(socket, { type: 'cancel', id })
        } catch {
          // The socket close handler rejects all pending requests; this request is already rejected below.
        }
        reject(signal?.reason instanceof Error ? signal.reason : new Error('browser operation cancelled'))
      }
      const cleanup = () => { signal?.removeEventListener('abort', aborted) }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        cleanup()
        reject(new Error(`personal Edge command ${method} timed out`))
      }, timeoutMs)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer, cleanup })
      signal?.addEventListener('abort', aborted, { once: true })
      try {
        send(socket, { type: 'request', id, method, payload })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.cleanup()
      pending.reject(error)
    }
    this.pending.clear()
  }
}
