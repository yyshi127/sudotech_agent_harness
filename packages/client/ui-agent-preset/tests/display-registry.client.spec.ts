import { describe, expect, it } from 'vitest'
import { AgentPresetDisplayRegistry } from '../src/client/display-registry.ts'
import { en, type AgentPresetSettingsKey } from '../src/client/locales.ts'

const t = (key: AgentPresetSettingsKey): string => en[key]

describe('AgentPresetDisplayRegistry', () => {
  it('uses a product provider only for the matching system preset', () => {
    const registry = new AgentPresetDisplayRegistry()
    registry.register('finance', () => ({ name: 'Finance mode', description: 'Product copy.' }))

    expect(registry.resolve({ id: 'finance', trust: 'system', name: 'file copy' }, t))
      .toEqual({ name: 'Finance mode', description: 'Product copy.' })
    expect(registry.resolve({ id: 'finance', trust: 'user', name: 'My finance' }, t))
      .toEqual({ name: 'My finance' })
    expect(registry.resolve({ id: 'standard', trust: 'system' }, t).name).toBe('Standard mode')
  })

  it('rejects duplicate owners and restores metadata after disposal', () => {
    const registry = new AgentPresetDisplayRegistry()
    const dispose = registry.register('finance', () => ({ name: 'Finance mode' }))

    expect(() => registry.register('finance', () => ({ name: 'Other' })))
      .toThrow('agent preset display provider already registered: finance')
    dispose()
    dispose()
    expect(registry.resolve({ id: 'finance', trust: 'system', name: 'Finance模式' }, t))
      .toEqual({ name: 'Finance模式' })
  })
})
