/** Xiaojing Host plugin that publishes redacted desktop-companion task state. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-xiaojing-weixin-channel'
import { CompanionTracker } from './tracker.ts'
import type { CompanionSnapshot } from './types.ts'

export type * from './types.ts'
export { CompanionTracker } from './tracker.ts'

const STATE_PATH = '/xiaojing-desktop-companion/state'
const EVENTS_PATH = '/xiaojing-desktop-companion/events'
const HEARTBEAT_MS = 20_000

declare module '@deepseek-ai/cordis' {
  interface Context {
    xiaojingDesktopCompanion: XiaojingDesktopCompanion
  }
}

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function reject(request: IncomingMessage, response: ServerResponse): boolean {
  if (!isLoopback(request)) {
    response.writeHead(403).end()
    return true
  }
  if (request.method !== 'GET') {
    response.writeHead(405, { allow: 'GET' }).end()
    return true
  }
  return false
}

function sse(snapshot: CompanionSnapshot): string {
  return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
}

/** Aggregate task lifecycle events and expose a loopback-only snapshot stream. */
export class XiaojingDesktopCompanion extends Service {
  static inject = ['webServer']

  private readonly tracker = new CompanionTracker()
  private readonly clients = new Set<ServerResponse>()
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  private lastPublishedRevision = -1

  /** Register state observers and the local Electron transport. @param ctx - Host Cordis context. */
  constructor(ctx: Context) {
    super(ctx, 'xiaojingDesktopCompanion')
    this.tracker.setWeixinOnline(ctx.get('xiaojingWeixinChannel')?.snapshot().online ?? false)
    ctx.on('session/event', (session, event: SessionEvent) => {
      this.update(this.tracker.ingest(String(session.header.id), event))
    }, { global: true })
    ctx.on('session/disposed', (session) => {
      this.update(this.tracker.disposeSession(String(session.header.id)))
    }, { global: true })
    ctx.on('xiaojing-weixin/status', (status) => {
      this.update(this.tracker.setWeixinOnline(status.online))
    })
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path: STATE_PATH, handler: (request, response) => {
        this.handleState(request, response)
      },
    }), 'xiaojing-desktop-companion: state route')
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path: EVENTS_PATH, handler: (request, response) => {
        this.handleEvents(request, response)
      },
    }), 'xiaojing-desktop-companion: event stream')
    const heartbeat = setInterval(() => { this.heartbeat() }, HEARTBEAT_MS)
    heartbeat.unref()
    ctx.effect(() => () => {
      clearInterval(heartbeat)
      if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer)
      for (const response of this.clients) response.end()
      this.clients.clear()
    }, 'xiaojing-desktop-companion: stream lifecycle')
    this.armExpiry()
  }

  /**
   * Return the current content-free aggregate state.
   * @returns The current redacted snapshot.
   */
  snapshot(): CompanionSnapshot {
    return this.tracker.snapshot()
  }

  private handleState(request: IncomingMessage, response: ServerResponse): void {
    if (reject(request, response)) return
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(JSON.stringify(this.snapshot()))
  }

  private handleEvents(request: IncomingMessage, response: ServerResponse): void {
    if (reject(request, response)) return
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    response.write(sse(this.snapshot()))
    this.clients.add(response)
    response.once('close', () => { this.clients.delete(response) })
  }

  private update(changed: boolean): void {
    this.armExpiry()
    if (changed) this.publish()
  }

  private publish(): void {
    const snapshot = this.snapshot()
    if (snapshot.revision === this.lastPublishedRevision) return
    this.lastPublishedRevision = snapshot.revision
    const payload = sse(snapshot)
    for (const response of [...this.clients]) {
      try {
        response.write(payload)
      } catch {
        // A dropped local Electron connection owns no durable state; remove it.
        this.clients.delete(response)
        response.destroy()
      }
    }
  }

  private heartbeat(): void {
    for (const response of [...this.clients]) {
      try {
        response.write(': heartbeat\n\n')
      } catch {
        // A dropped local Electron connection owns no durable state; remove it.
        this.clients.delete(response)
        response.destroy()
      }
    }
  }

  private armExpiry(): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer)
    const next = this.tracker.nextExpiry()
    if (next === undefined) {
      this.expiryTimer = undefined
      return
    }
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined
      const before = this.lastPublishedRevision
      const snapshot = this.snapshot()
      if (snapshot.revision !== before) this.publish()
      this.armExpiry()
    }, Math.max(0, next - Date.now()))
    this.expiryTimer.unref()
  }
}

export default XiaojingDesktopCompanion
