/** Browser-local controller for the restricted Xiaojing desktop bridge. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CompanionSnapshot, CompanionState } from '@deepseek-ai/dsh-xiaojing-desktop-companion/types'
import type { DesktopCompanionBridge, DesktopCompanionDesktopState } from './bridge.ts'

const STATES: readonly CompanionState[] = ['idle', 'thinking', 'executing', 'approval', 'success', 'failure']
const IDLE: CompanionSnapshot = {
  state: 'idle', activeTaskCount: 0, approvalCount: 0, weixinOnline: false, revision: 0,
}
const DEFAULT_SCALE = 0.5
const MIN_SCALE = 0.3
const MAX_SCALE = 1

/** View state consumed by the desktop-companion settings section. */
export interface DesktopCompanionView {
  available: boolean
  visible: boolean
  scale: number
  snapshot: CompanionSnapshot
  busy: boolean
  error: string | null
}

function isSnapshot(value: unknown): value is CompanionSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.state === 'string' && STATES.includes(row.state as CompanionState)
    && typeof row.activeTaskCount === 'number' && Number.isSafeInteger(row.activeTaskCount) && row.activeTaskCount >= 0
    && typeof row.approvalCount === 'number' && Number.isSafeInteger(row.approvalCount) && row.approvalCount >= 0
    && typeof row.weixinOnline === 'boolean'
    && typeof row.revision === 'number' && Number.isSafeInteger(row.revision) && row.revision >= 0
}

function isDesktopState(value: unknown): value is DesktopCompanionDesktopState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return row.available === true && typeof row.visible === 'boolean'
    && typeof row.scale === 'number' && Number.isFinite(row.scale)
    && row.scale >= MIN_SCALE && row.scale <= MAX_SCALE
    && isSnapshot(row.snapshot)
}

/** Shared operation and subscription owner for one mounted desktop-companion page. */
export class DesktopCompanionController {
  /** Observable state consumed through the slot runtime hook. */
  readonly store: SnapshotStore<DesktopCompanionView> = createSnapshotStore({
    available: false, visible: false, scale: DEFAULT_SCALE, snapshot: IDLE, busy: false, error: null,
  })

  private readonly bridge: DesktopCompanionBridge | undefined
  private readonly unsubscribe: (() => void) | undefined
  private generation = 0

  constructor() {
    this.bridge = window.xiaojingDesktop
    if (this.bridge !== undefined) {
      this.store.update((state) => { state.available = true })
    }
    this.unsubscribe = this.bridge?.subscribeCompanionState((state) => {
      if (!isDesktopState(state)) return
      this.generation += 1
      this.store.set({
        available: true, visible: state.visible, scale: state.scale, snapshot: state.snapshot, busy: false, error: null,
      })
    })
  }

  /** Read current availability, visibility, and redacted task state. */
  async load(): Promise<void> {
    if (this.bridge === undefined) return
    await this.run(() => this.bridge?.getCompanionState())
  }

  /** Create or reveal the desktop companion window. */
  async wake(): Promise<void> {
    if (this.bridge === undefined) return
    await this.run(() => this.bridge?.wakeCompanion())
  }

  /** Destroy the desktop companion window without stopping the application. */
  async tuck(): Promise<void> {
    if (this.bridge === undefined) return
    await this.run(() => this.bridge?.tuckCompanion())
  }

  /** Restore the default visible position and wake the companion if necessary. */
  async resetPosition(): Promise<void> {
    if (this.bridge === undefined) return
    await this.run(() => this.bridge?.resetCompanionPosition())
  }

  /**
   * Set the visual scale without resizing the transparent native window.
   * @param scale - Visual scale accepted by the desktop companion bridge.
   */
  async setScale(scale: number): Promise<void> {
    if (this.bridge === undefined) return
    await this.run(() => this.bridge?.setCompanionScale(scale))
  }

  /** Release the Electron state subscription when the Client plugin is disposed. */
  dispose(): void {
    this.unsubscribe?.()
  }

  private async run(operation: () => Promise<DesktopCompanionDesktopState> | undefined): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.busy = true; state.error = null })
    try {
      const result = await operation()
      if (generation !== this.generation || result === undefined) return
      if (!isDesktopState(result)) throw new Error('桌面小兢返回了无效状态。')
      this.store.set({
        available: true, visible: result.visible, scale: result.scale, snapshot: result.snapshot, busy: false, error: null,
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.busy = false
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }
}
