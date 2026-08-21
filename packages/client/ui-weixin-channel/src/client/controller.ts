/** Browser-local controller for the loopback-only Weixin channel RPC. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { WeixinChannelStatus, WeixinConnectionState } from '@deepseek-ai/dsh-xiaojing-weixin-channel/types'

const STATES: readonly WeixinConnectionState[] = [
  'disconnected', 'pairing', 'scanned', 'verification-required', 'connected',
  'reconnecting', 'expired', 'token-expired', 'instance-busy', 'error',
]

/** View state consumed by the settings section. */
export interface WeixinChannelView {
  status: 'idle' | 'loading' | 'ready' | 'error'
  snapshot: WeixinChannelStatus | null
  busy: boolean
  error: string | null
}

function isStatus(value: unknown): value is WeixinChannelStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.state === 'string' && STATES.includes(row.state as WeixinConnectionState)
    && typeof row.online === 'boolean' && typeof row.verificationRequired === 'boolean'
    && (row.accountLabel === undefined || typeof row.accountLabel === 'string')
    && (row.qrCodeDataUrl === undefined || (
      typeof row.qrCodeDataUrl === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(row.qrCodeDataUrl)
    ))
    && (row.qrExpiresAt === undefined || (typeof row.qrExpiresAt === 'number' && Number.isSafeInteger(row.qrExpiresAt)))
    && (row.error === undefined || typeof row.error === 'string')
}

/** Shared operation and refresh owner for one mounted channel page. */
export class WeixinChannelController {
  /** Observable state consumed through the slot runtime hook. */
  readonly store: SnapshotStore<WeixinChannelView> = createSnapshotStore({
    status: 'idle', snapshot: null, busy: false, error: null,
  })

  private generation = 0

  /** @param rpc - generic Connection caller restricted by the Host to loopback. */
  constructor(private readonly rpc: ClientConnectionRpc) {}

  /** Refresh the sanitized status snapshot. */
  async load(): Promise<void> {
    if (this.store.getSnapshot().busy) return
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    await this.call('status', {}, generation, false)
  }

  /** Start or restart QR pairing. */
  startPairing(): Promise<void> {
    return this.action('pairing/start', {})
  }

  /**
   * Submit the phone-provided pairing code.
   * @param code - numeric code displayed by Weixin during pairing.
   */
  verify(code: string): Promise<void> {
    return this.action('pairing/verify', { code })
  }

  /** Cancel the current QR flow without deleting a previous valid connection. */
  cancelPairing(): Promise<void> {
    return this.action('pairing/cancel', {})
  }

  /** Remove the local token and stop receiving messages. */
  disconnect(): Promise<void> {
    return this.action('disconnect', {})
  }

  private async action(endpoint: string, payload: unknown): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.busy = true; state.error = null })
    await this.call(endpoint, payload, generation, true)
  }

  private async call(endpoint: string, payload: unknown, generation: number, action: boolean): Promise<void> {
    try {
      const result = await this.rpc.call('/xiaojing-weixin', endpoint, payload)
      if (generation !== this.generation) return
      if (!result.ok) throw new Error(result.error.message)
      if (!isStatus(result.value)) throw new Error('微信频道返回了无效状态。')
      this.store.set({ status: 'ready', snapshot: result.value, busy: false, error: null })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = action && state.snapshot !== null ? 'ready' : 'error'
        state.busy = false
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }
}
