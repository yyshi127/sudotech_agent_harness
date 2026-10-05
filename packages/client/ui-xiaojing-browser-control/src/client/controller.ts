/** Browser-local controller for authenticated native browser settings. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type {
  NativeBrowser, NativeBrowserControlStatus, NativeBrowserState, NativeBrowserStatus,
} from '@deepseek-ai/dsh-xiaojing-browser-control/native-settings-types'

const STATES: readonly NativeBrowserState[] = [
  'disabled', 'setup-required', 'ready', 'connecting', 'connected', 'disconnected',
]

/** View state consumed by the browser-control settings section. */
export interface BrowserControlView {
  status: 'idle' | 'loading' | 'ready' | 'error'
  snapshot: NativeBrowserControlStatus | null
  busy: boolean
  error: string | null
}

function parseStatus(value: unknown, invalidStatusMessage: string): NativeBrowserControlStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(invalidStatusMessage)
  const status = value as Record<string, unknown>
  if (typeof status.canOpenSettings !== 'boolean' || !Array.isArray(status.browsers) || status.browsers.length !== 2) throw new Error(invalidStatusMessage)
  const browsers = status.browsers.map((value: unknown): NativeBrowserStatus => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(invalidStatusMessage)
    const row = value as Record<string, unknown>
    if ((row.browser !== 'edge' && row.browser !== 'chrome')
      || (typeof row.installed !== 'boolean' && row.installed !== null)
      || typeof row.enabled !== 'boolean' || typeof row.setupReady !== 'boolean'
      || typeof row.state !== 'string' || !STATES.includes(row.state as NativeBrowserState)
      || (row.error !== undefined && typeof row.error !== 'string')) throw new Error(invalidStatusMessage)
    return {
      browser: row.browser,
      installed: row.installed,
      enabled: row.enabled,
      setupReady: row.setupReady,
      state: row.state as NativeBrowserState,
      ...(row.error === undefined ? {} : { error: row.error }),
    }
  })
  if (browsers[0]?.browser === browsers[1]?.browser) throw new Error(invalidStatusMessage)
  return { canOpenSettings: status.canOpenSettings, browsers: browsers.sort(a => a.browser === 'chrome' ? -1 : 1) }
}

/** Refresh and write owner that retains the last valid Host status after failures. */
export class BrowserControlController {
  /** Observable state consumed through the slot runtime hook. */
  readonly store: SnapshotStore<BrowserControlView> = createSnapshotStore({
    status: 'idle', snapshot: null, busy: false, error: null,
  })

  private generation = 0
  private loading = false

  /**
   * @param rpc - authenticated Connection operator caller.
   * @param invalidStatusMessage - localized message for malformed Host responses.
   */
  constructor(private readonly rpc: ClientConnectionRpc, private readonly invalidStatusMessage: string) {}

  /**
   * Refresh installation, operator permission, and observed native connection state.
   * @returns after a non-overlapping refresh settles; existing content stays visible.
   */
  async load(): Promise<void> {
    if (this.loading || this.store.getSnapshot().busy) return
    this.loading = true
    const generation = ++this.generation
    this.store.update((state) => {
      if (state.snapshot === null) { state.status = 'loading'; state.error = null }
    })
    try {
      await this.call('status', {}, generation)
    } finally {
      this.loading = false
    }
  }

  /**
   * Change permission to control existing tabs without claiming a live connection.
   * @param browser - browser brand whose permission is changed.
   * @param enabled - requested operator permission.
   * @returns confirmed Host status, or null when the write fails or is superseded.
   */
  async setEnabled(browser: NativeBrowser, enabled: boolean): Promise<NativeBrowserControlStatus | null> {
    if (this.store.getSnapshot().busy) return null
    const generation = ++this.generation
    this.store.update((state) => { state.busy = true; state.error = null })
    return this.call('set-enabled', { browser, enabled }, generation)
  }

  /**
   * Open the selected browser's own settings page and wait for Host verification.
   * @param browser - fixed browser brand selected by the operator.
   * @returns whether the Host observed the actual inspect page in its new window.
   */
  async openSettings(browser: NativeBrowser): Promise<boolean> {
    if (this.store.getSnapshot().busy) return false
    const generation = ++this.generation
    this.store.update((state) => { state.busy = true; state.error = null })
    return await this.call('open-settings', { browser }, generation) !== null
  }

  private async call(endpoint: string, payload: unknown, generation: number): Promise<NativeBrowserControlStatus | null> {
    try {
      const result = await this.rpc.call('/xiaojing-native-browser-control', endpoint, payload)
      if (generation !== this.generation) return null
      if (!result.ok) throw new Error(result.error.message)
      const snapshot = parseStatus(result.value, this.invalidStatusMessage)
      this.store.set({ status: 'ready', snapshot, busy: false, error: null })
      return snapshot
    } catch (error) {
      if (generation !== this.generation) return null
      this.store.update((state) => {
        state.status = state.snapshot === null ? 'error' : 'ready'
        state.busy = false
        state.error = error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }
}
