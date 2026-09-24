/** Browser-local controller for the loopback-only Edge automation RPC. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { BrowserControlStatus, PersonalEdgeState } from '@deepseek-ai/dsh-xiaojing-browser-control/types'

const PERSONAL_STATES: readonly PersonalEdgeState[] = [
  'not-connected', 'pairing', 'connected', 'incompatible', 'error',
]

/** View state consumed by the browser-control settings section. */
export interface BrowserControlView {
  status: 'idle' | 'loading' | 'ready' | 'error'
  snapshot: BrowserControlStatus | null
  busy: boolean
  error: string | null
}

function parseBrowserControlStatus(value: unknown): BrowserControlStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('浏览器控制返回了无效状态。')
  }
  const row = value as Record<string, unknown>
  if (typeof row.managed !== 'object' || row.managed === null || Array.isArray(row.managed)
    || typeof row.personal !== 'object' || row.personal === null || Array.isArray(row.personal)) {
    throw new Error('浏览器控制返回了无效状态。')
  }
  const managed = row.managed as Record<string, unknown>
  const personal = row.personal as Record<string, unknown>
  const valid = managed.enabled === true && typeof managed.running === 'boolean'
    && typeof personal.state === 'string' && PERSONAL_STATES.includes(personal.state as PersonalEdgeState)
    && typeof personal.extensionId === 'string' && /^[a-p]{32}$/.test(personal.extensionId)
    && typeof personal.connected === 'boolean' && typeof personal.paired === 'boolean'
    && (personal.version === undefined || typeof personal.version === 'string')
    && (personal.pairingCode === undefined || (
      typeof personal.pairingCode === 'string' && /^[A-Z2-9]{8}$/.test(personal.pairingCode)
    ))
    && (personal.pairingExpiresAt === undefined || (
      typeof personal.pairingExpiresAt === 'number' && Number.isSafeInteger(personal.pairingExpiresAt)
    ))
    && (personal.error === undefined || typeof personal.error === 'string')
  if (!valid) throw new Error('浏览器控制返回了无效状态。')
  return {
    managed: { enabled: true, running: managed.running as boolean },
    personal: {
      state: personal.state as PersonalEdgeState,
      extensionId: personal.extensionId as string,
      connected: personal.connected as boolean,
      paired: personal.paired as boolean,
      ...(personal.version === undefined ? {} : { version: personal.version as string }),
      ...(personal.pairingCode === undefined ? {} : { pairingCode: personal.pairingCode as string }),
      ...(personal.pairingExpiresAt === undefined ? {} : { pairingExpiresAt: personal.pairingExpiresAt as number }),
      ...(personal.error === undefined ? {} : { error: personal.error as string }),
    },
  }
}

/** Shared operation and refresh owner for the browser-control settings page. */
export class BrowserControlController {
  /** Observable state consumed through the slot runtime hook. */
  readonly store: SnapshotStore<BrowserControlView> = createSnapshotStore({
    status: 'idle', snapshot: null, busy: false, error: null,
  })

  private generation = 0

  /** @param rpc - Generic Connection caller restricted by the Host to loopback. */
  constructor(private readonly rpc: ClientConnectionRpc) {}

  /** Refresh the sanitized managed and personal Edge status. */
  async load(): Promise<void> {
    if (this.store.getSnapshot().busy) return
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    await this.call('status', {}, generation, false)
  }

  /** Create a short-lived code for the unpacked extension popup. */
  startPairing(): Promise<void> {
    return this.action('pairing/start')
  }

  /** Cancel the active pairing code without deleting an existing authorization. */
  cancelPairing(): Promise<void> {
    return this.action('pairing/cancel')
  }

  /** Revoke the personal Edge extension secret and disconnect it. */
  disconnect(): Promise<void> {
    return this.action('disconnect')
  }

  /** Reveal the packaged unpacked extension folder in Explorer. */
  revealExtension(): Promise<void> {
    return this.action('extension/reveal')
  }

  /** Open the Microsoft Edge extension manager. */
  openExtensionManager(): Promise<void> {
    return this.action('extension/open-manager')
  }

  private async action(endpoint: string): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.busy = true; state.error = null })
    await this.call(endpoint, {}, generation, true)
  }

  private async call(endpoint: string, payload: unknown, generation: number, action: boolean): Promise<void> {
    try {
      const result = await this.rpc.call('/xiaojing-browser-control', endpoint, payload)
      if (generation !== this.generation) return
      if (!result.ok) throw new Error(result.error.message)
      const snapshot = parseBrowserControlStatus(result.value)
      this.store.set({ status: 'ready', snapshot, busy: false, error: null })
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
