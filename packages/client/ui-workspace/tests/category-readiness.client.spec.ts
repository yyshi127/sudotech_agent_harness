import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { WorkspaceCategoryRegistry, type WorkspaceCategoryState } from '../src/client/category-registry.ts'

describe('Workspace category membership loading', () => {
  it('projects readiness, failures, and only the registered retry action until removal', () => {
    const registry = new WorkspaceCategoryRegistry()
    const source = createSnapshotStore<WorkspaceCategoryState>({
      label: 'Owned category', ready: false, workspaceIds: [], newSessionDisabledWorkspaceIds: [],
    })
    const retryLoad = vi.fn(() => {
      const next = { ...source.getSnapshot() }
      delete next.loadError
      source.set(next)
    })
    const changed = vi.fn()
    const stop = registry.store.subscribe(changed)
    const dispose = registry.register({
      id: 'owned', order: 10, source, retryLoad, activate: async () => {},
    })
    expect(registry.store.getSnapshot().categories).toEqual([{
      ...source.getSnapshot(), id: 'owned', retryLoadAvailable: true,
    }])
    source.set({ ...source.getSnapshot(), loadError: 'owned membership unavailable' })
    expect(registry.store.getSnapshot().categories[0]?.loadError).toBe('owned membership unavailable')
    registry.retryLoad('owned')
    expect(retryLoad).toHaveBeenCalledOnce()
    expect(registry.store.getSnapshot().categories[0]?.ready).toBe(false)
    expect(registry.store.getSnapshot().categories[0]?.loadError).toBeUndefined()
    source.set({ ...source.getSnapshot(), ready: true })
    expect(registry.store.getSnapshot().categories[0]?.ready).toBe(true)
    dispose()
    dispose()
    expect(registry.store.getSnapshot().categories).toEqual([])
    changed.mockClear()
    source.set({ ...source.getSnapshot(), ready: false })
    expect(changed).not.toHaveBeenCalled()
    expect(() => { registry.retryLoad('owned') }).toThrow('unknown workspace category: owned')
    stop()
  })

  it('keeps omitted readiness compatible and refuses a provider without reload support', () => {
    const registry = new WorkspaceCategoryRegistry()
    registry.register({
      id: 'owned', order: 10, activate: async () => {},
      source: createSnapshotStore<WorkspaceCategoryState>({
        label: 'Owned category', workspaceIds: [], newSessionDisabledWorkspaceIds: [],
      }),
    })
    expect(registry.store.getSnapshot().categories[0]).not.toHaveProperty('ready')
    expect(registry.store.getSnapshot().categories[0]).not.toHaveProperty('retryLoadAvailable')
    expect(() => { registry.retryLoad('owned') }).toThrow('workspace category does not support retrying load: owned')
    expect(() => { registry.retryLoad('missing') }).toThrow('unknown workspace category: missing')
  })
})
