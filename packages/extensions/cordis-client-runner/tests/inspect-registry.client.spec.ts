/** Inspect registry shutdown joins owned work and prevents new transport calls. */

import { setImmediate } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import type {
  CordisInspectQueryRequest, CordisInspectRequestId, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  ClientCordisInspectRegistry,
  type ClientCordisInspectHost,
  type ClientCordisInspectProviderRegistration,
} from '../src/client/inspect-registry.ts'

const REQUEST: CordisInspectQueryRequest = {
  agentId: 'inspect-session' as SessionId,
  requestId: 'inspect-request' as CordisInspectRequestId,
  provider: 'Fixture', method: 'read',
}

function provider(
  query: ClientCordisInspectProviderRegistration['query'] = async () => null,
): ClientCordisInspectProviderRegistration {
  return {
    manifest: {
      id: 'Fixture', description: 'Lifecycle fixture.',
      methods: [{ name: 'read', description: 'Read fixture.', inputSchema: {}, outputSchema: {} }],
    },
    query,
  }
}

function host() {
  return { sync: vi.fn(async () => {}), resolve: vi.fn(async () => {}) } satisfies ClientCordisInspectHost
}

describe('Client inspect registry shutdown', () => {
  it('closes a queued publication and rejects later registrations', async () => {
    const transport = host()
    const registry = new ClientCordisInspectRegistry(transport)
    const remove = registry.register(provider())
    await registry.dispose()
    remove()
    remove()
    registry.publish()
    await registry.query(REQUEST)
    await registry.dispose()
    expect(transport.sync).not.toHaveBeenCalled()
    expect(transport.resolve).not.toHaveBeenCalled()
    expect(() => registry.register(provider())).toThrow('registry is disposed')
  })

  it('joins a started sync and discards the publication queued behind it', async () => {
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const transport = host()
    transport.sync = vi.fn(async () => {
      started.resolve(undefined)
      await release.promise
    })
    const registry = new ClientCordisInspectRegistry(transport)
    const remove = registry.register(provider())
    await started.promise
    remove()
    await Promise.resolve()
    let disposed = false
    const disposal = registry.dispose().then(() => { disposed = true })
    try {
      await setImmediate()
      expect(disposed).toBe(false)
    } finally {
      release.resolve(undefined)
      await disposal
    }
    expect(transport.sync).toHaveBeenCalledTimes(1)
  })

  it('cancels a provider query and waits for its cancellation settlement', async () => {
    const started = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<undefined>()
    const transport = host()
    const registry = new ClientCordisInspectRegistry(transport)
    registry.register(provider(async (_method, _input, context) => {
      started.resolve(context.signal)
      await release.promise
      return 'late-provider-data'
    }))
    const query = registry.query(REQUEST)
    const signal = await started.promise
    let disposed = false
    const disposal = registry.dispose().then(() => { disposed = true })
    try {
      expect(signal.aborted).toBe(true)
      await setImmediate()
      expect(disposed).toBe(false)
    } finally {
      release.resolve(undefined)
      await Promise.all([disposal, query])
    }
    expect(transport.resolve).not.toHaveBeenCalled()
  })

  it('joins a query already removed from the active controller map by close', async () => {
    const release = Promise.withResolvers<undefined>()
    const transport = host()
    const registry = new ClientCordisInspectRegistry(transport)
    registry.register(provider(async () => { await release.promise; return null }))
    const query = registry.query(REQUEST)
    registry.close(REQUEST.requestId)
    let disposed = false
    const disposal = registry.dispose().then(() => { disposed = true })
    try {
      await setImmediate()
      expect(disposed).toBe(false)
    } finally {
      release.resolve(undefined)
      await Promise.all([disposal, query])
    }
    expect(transport.resolve).not.toHaveBeenCalled()
  })

  it('joins result delivery after the provider query has settled', async () => {
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const transport = host()
    transport.resolve = vi.fn(async () => {
      started.resolve(undefined)
      await release.promise
    })
    const registry = new ClientCordisInspectRegistry(transport)
    registry.register(provider())
    const query = registry.query(REQUEST)
    await started.promise
    let disposed = false
    const disposal = registry.dispose().then(() => { disposed = true })
    try {
      await setImmediate()
      expect(disposed).toBe(false)
    } finally {
      release.resolve(undefined)
      await Promise.all([disposal, query])
    }
    expect(transport.resolve).toHaveBeenCalledTimes(1)
  })

  it('keeps result-delivery failures visible to query callers', async () => {
    const transport = host()
    const failure = new Error('result delivery failed')
    transport.resolve = vi.fn(async () => { throw failure })
    const registry = new ClientCordisInspectRegistry(transport)
    registry.register(provider())
    try {
      await expect(registry.query(REQUEST)).rejects.toBe(failure)
    } finally {
      await registry.dispose()
    }
  })
})
