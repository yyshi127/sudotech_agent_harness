import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'

const SESSION = 'blocked-session' as SessionId

describe('ComposerBlockRegistry', () => {
  it('republishes only when the copy changes', () => {
    const registry = new ComposerBlockRegistry()
    const listener = vi.fn()
    const store = registry.storeFor(SESSION)
    store.subscribe(listener)

    registry.set(SESSION, { reason: 'select a model first' })
    expect(store.getSnapshot()).toEqual({ reason: 'select a model first' })
    expect(listener).toHaveBeenCalledTimes(1)

    // Identical copy: no publication at all.
    registry.set(SESSION, { reason: 'select a model first' })
    expect(listener).toHaveBeenCalledTimes(1)

    registry.set(SESSION, undefined)
    expect(store.getSnapshot()).toBeUndefined()

    registry.forget(SESSION)
    expect(registry.storeFor(SESSION).getSnapshot()).toBeUndefined()
  })
})

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
