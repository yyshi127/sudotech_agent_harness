/** Public, content-free task state consumed by the Xiaojing desktop shell. */

/** Six visual states rendered by the desktop companion. */
export type CompanionState = 'idle' | 'thinking' | 'executing' | 'approval' | 'success' | 'failure'

/** Sanitized aggregate state; it never includes session or task content. */
export interface CompanionSnapshot {
  /** Highest-priority state across all active and recently settled sessions. */
  state: CompanionState
  /** Number of sessions with an open turn. */
  activeTaskCount: number
  /** Number of unresolved approval requests. */
  approvalCount: number
  /** Whether the local Weixin long-poll channel is online. */
  weixinOnline: boolean
  /** Monotonic counter changed only when a public field changes. */
  revision: number
}
