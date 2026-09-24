import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'

const sessionId = 'session-1' as SessionId

describe('ComposerBlockRegistry', () => {
  it('keeps independent feature blockers and restores the remaining reason', () => {
    const blocks = new ComposerBlockRegistry()
    blocks.setOwned('finance', sessionId, { reason: 'select a period' })
    blocks.set(sessionId, { reason: 'select a model' })
    expect(blocks.storeFor(sessionId).getSnapshot()).toEqual({ reason: 'select a model' })
    blocks.set(sessionId, undefined)
    expect(blocks.storeFor(sessionId).getSnapshot()).toEqual({ reason: 'select a period' })
    blocks.setOwned('finance', sessionId, undefined)
    expect(blocks.storeFor(sessionId).getSnapshot()).toBeUndefined()
  })

  it('forgets both the public store and owner state', () => {
    const blocks = new ComposerBlockRegistry()
    blocks.setOwned('finance', sessionId, { reason: 'select a period' })
    const first = blocks.storeFor(sessionId)
    blocks.forget(sessionId)
    const second = blocks.storeFor(sessionId)
    expect(second).not.toBe(first)
    expect(second.getSnapshot()).toBeUndefined()
  })
})
