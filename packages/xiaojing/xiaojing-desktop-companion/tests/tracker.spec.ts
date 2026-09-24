import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import { CompanionTracker } from '../src/tracker.ts'

function event<T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent<T> {
  return { type, seq: 0, time: 0, data } as SessionEvent<T>
}

describe('CompanionTracker', () => {
  it('folds thinking, tool execution, approval, failure, and expiry in priority order', () => {
    const tracker = new CompanionTracker()
    const approvalId = ApprovalRequestId('approval-1')
    tracker.ingest('a', event('turn/start', { turn: 1 }), 0)
    expect(tracker.snapshot(0)).toMatchObject({ state: 'thinking', activeTaskCount: 1, approvalCount: 0 })

    tracker.ingest('a', event('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('call-1'), name: 'read', arguments: '{}',
    }), 10)
    expect(tracker.snapshot(10).state).toBe('executing')

    tracker.ingest('a', event('approval/asked', { id: approvalId, toolName: 'delete' }), 20)
    expect(tracker.snapshot(20)).toMatchObject({ state: 'approval', approvalCount: 1 })

    tracker.ingest('a', event('approval/decided', { id: approvalId, outcome: 'rejected' }), 30)
    expect(tracker.snapshot(30).state).toBe('executing')

    tracker.ingest('a', event('turn/end', {
      turn: 1, reason: { kind: 'error', error: { message: 'private failure', code: 'TEST' } },
    }), 40)
    expect(tracker.snapshot(5_039)).toMatchObject({ state: 'failure', activeTaskCount: 0 })
    expect(tracker.snapshot(5_040).state).toBe('idle')
  })

  it('keeps failures above parallel execution and counts concurrent tasks', () => {
    const tracker = new CompanionTracker()
    tracker.ingest('a', event('turn/start', { turn: 1 }), 0)
    tracker.ingest('a', event('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('call-a'), name: 'read', arguments: '{}',
    }), 0)
    tracker.ingest('b', event('turn/start', { turn: 1 }), 0)
    tracker.ingest('c', event('turn/start', { turn: 1 }), 0)
    tracker.ingest('c', event('turn/end', { turn: 1, reason: { kind: 'blocked' } }), 0)

    expect(tracker.snapshot(1)).toMatchObject({ state: 'failure', activeTaskCount: 2 })
    expect(tracker.snapshot(5_000)).toMatchObject({ state: 'executing', activeTaskCount: 2 })
  })

  it('shows success for 2.5 seconds and treats an explicit abort as idle', () => {
    const tracker = new CompanionTracker()
    tracker.ingest('a', event('turn/start', { turn: 1 }), 0)
    tracker.ingest('a', event('turn/end', { turn: 1, reason: { kind: 'completed' } }), 0)
    expect(tracker.snapshot(2_499).state).toBe('success')
    expect(tracker.nextExpiry(2_499)).toBe(2_500)
    expect(tracker.snapshot(2_500).state).toBe('idle')

    tracker.ingest('a', event('turn/start', { turn: 2 }), 3_000)
    tracker.ingest('a', event('turn/end', {
      turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } },
    }), 3_001)
    expect(tracker.snapshot(3_001).state).toBe('idle')
  })

  it('publishes only content-free fields and tracks Weixin connectivity', () => {
    const tracker = new CompanionTracker()
    expect(tracker.setWeixinOnline(true, 0)).toBe(true)
    expect(tracker.setWeixinOnline(true, 1)).toBe(false)
    tracker.ingest('secret-session-title', event('turn/start', { turn: 1 }), 2)
    tracker.ingest('secret-session-title', event('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('secret-call'), name: 'secret-tool', arguments: '{"secret":true}',
    }), 3)
    const snapshot = tracker.snapshot(3)
    expect(snapshot).toEqual({
      state: 'executing', activeTaskCount: 1, approvalCount: 0, weixinOnline: true, revision: 3,
    })
    expect(JSON.stringify(snapshot)).not.toContain('secret')
    expect(tracker.disposeSession('secret-session-title', 4)).toBe(true)
    expect(tracker.snapshot(4).state).toBe('idle')
  })
})
