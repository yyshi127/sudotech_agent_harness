/** Restricted Electron bridge available only in the Xiaojing Windows desktop application. */

import type { CompanionSnapshot } from '@deepseek-ai/dsh-xiaojing-desktop-companion/types'

/** Combined Electron window and Host state returned to trusted renderers. */
export interface DesktopCompanionDesktopState {
  available: true
  visible: boolean
  scale: number
  snapshot: CompanionSnapshot
}

/** Exact desktop operations exposed by the Electron preload. */
export interface DesktopCompanionBridge {
  getApplicationInfo(): Promise<{ version: string }>
  getCompanionState(): Promise<DesktopCompanionDesktopState>
  wakeCompanion(): Promise<DesktopCompanionDesktopState>
  tuckCompanion(): Promise<DesktopCompanionDesktopState>
  resetCompanionPosition(): Promise<DesktopCompanionDesktopState>
  setCompanionScale(scale: number): Promise<DesktopCompanionDesktopState>
  showMainWindow(): Promise<void>
  subscribeCompanionState(listener: (state: DesktopCompanionDesktopState) => void): () => void
}

declare global {
  interface Window {
    xiaojingDesktop?: DesktopCompanionBridge
  }
}
