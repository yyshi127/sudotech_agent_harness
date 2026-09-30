/** Pure task-state fold for the Xiaojing desktop companion. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { CompanionSnapshot, CompanionState } from './types.ts'

const SUCCESS_DURATION_MS = 2_500
const FAILURE_DURATION_MS = 5_000

interface SessionActivity {
  turn?: number
  readonly toolCalls: Set<string>
  readonly approvals: Set<string>
}

interface TerminalState {
  state: 'success' | 'failure'
  expiresAt: number
}

type SnapshotFields = Omit<CompanionSnapshot, 'revision'>

function sameFields(left: SnapshotFields, right: SnapshotFields): boolean {
  return left.state === right.state
    && left.activeTaskCount === right.activeTaskCount
    && left.approvalCount === right.approvalCount
    && left.weixinOnline === right.weixinOnline
}

function resultCallId(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return String(event.data.message.source.callId)
}

/** Fold session events into a redacted global companion state. */
export class CompanionTracker {
  private readonly sessions = new Map<string, SessionActivity>()
  private readonly terminal = new Map<string, TerminalState>()
  private weixinOnline = false
  private revision = 0
  private fields: SnapshotFields = {
    state: 'idle', activeTaskCount: 0, approvalCount: 0, weixinOnline: false,
  }

  /**
   * Fold one durable session event.
   * @param sessionId - opaque session identity used only for aggregation.
   * @param event - durable event whose content fields are never retained.
   * @param now - current epoch milliseconds for terminal-state expiry.
   * @returns whether the public snapshot changed.
   */
  ingest(sessionId: string, event: SessionEvent, now = Date.now()): boolean {
    const activity = this.sessions.get(sessionId) ?? { toolCalls: new Set(), approvals: new Set() }
    switch (event.type) {
      case 'turn/start':
        activity.turn = event.data.turn
        activity.toolCalls.clear()
        activity.approvals.clear()
        this.terminal.delete(sessionId)
        this.sessions.set(sessionId, activity)
        break
      case 'tool/call':
        if (activity.turn === event.data.turn) activity.toolCalls.add(String(event.data.callId))
        break
      case 'tool/result':
        if (activity.turn === event.data.turn) activity.toolCalls.delete(resultCallId(event))
        break
      case 'approval/asked':
        activity.approvals.add(String(event.data.id))
        break
      case 'approval/decided':
        activity.approvals.delete(String(event.data.id))
        break
      case 'turn/end':
        if (activity.turn !== event.data.turn) break
        delete activity.turn
        activity.toolCalls.clear()
        activity.approvals.clear()
        if (event.data.reason.kind === 'completed') {
          this.terminal.set(sessionId, { state: 'success', expiresAt: now + SUCCESS_DURATION_MS })
        } else if (event.data.reason.kind === 'aborted') {
          this.terminal.delete(sessionId)
        } else {
          this.terminal.set(sessionId, { state: 'failure', expiresAt: now + FAILURE_DURATION_MS })
        }
        break
      default:
        break
    }
    return this.refresh(now)
  }

  /**
   * Remove all transient state owned by a disposed session.
   * @param sessionId - disposed session identity.
   * @param now - current epoch milliseconds.
   * @returns whether the public snapshot changed.
   */
  disposeSession(sessionId: string, now = Date.now()): boolean {
    this.sessions.delete(sessionId)
    this.terminal.delete(sessionId)
    return this.refresh(now)
  }

  /**
   * Update the sanitized Weixin connectivity bit.
   * @param online - whether iLink is currently accepting messages.
   * @param now - current epoch milliseconds.
   * @returns whether the public snapshot changed.
   */
  setWeixinOnline(online: boolean, now = Date.now()): boolean {
    this.weixinOnline = online
    return this.refresh(now)
  }

  /**
   * Read the current redacted snapshot and expire elapsed terminal states.
   * @param now - current epoch milliseconds.
   * @returns immutable snapshot copy.
   */
  snapshot(now = Date.now()): CompanionSnapshot {
    this.refresh(now)
    return { ...this.fields, revision: this.revision }
  }

  /**
   * Find the next terminal-state expiry for timer scheduling.
   * @param now - current epoch milliseconds.
   * @returns future expiry or undefined when no terminal state remains.
   */
  nextExpiry(now = Date.now()): number | undefined {
    this.prune(now)
    let next: number | undefined
    for (const value of this.terminal.values()) {
      if (next === undefined || value.expiresAt < next) next = value.expiresAt
    }
    return next
  }

  private refresh(now: number): boolean {
    this.prune(now)
    let activeTaskCount = 0
    let approvalCount = 0
    let executing = false
    for (const activity of this.sessions.values()) {
      if (activity.turn !== undefined) activeTaskCount += 1
      approvalCount += activity.approvals.size
      if (activity.toolCalls.size > 0) executing = true
    }
    let state: CompanionState = 'idle'
    if (approvalCount > 0) state = 'approval'
    else if ([...this.terminal.values()].some(value => value.state === 'failure')) state = 'failure'
    else if (executing) state = 'executing'
    else if (activeTaskCount > 0) state = 'thinking'
    else if ([...this.terminal.values()].some(value => value.state === 'success')) state = 'success'
    const next = { state, activeTaskCount, approvalCount, weixinOnline: this.weixinOnline }
    if (sameFields(this.fields, next)) return false
    this.fields = next
    this.revision += 1
    return true
  }

  private prune(now: number): void {
    for (const [sessionId, value] of this.terminal) {
      if (value.expiresAt <= now) this.terminal.delete(sessionId)
    }
  }
}
