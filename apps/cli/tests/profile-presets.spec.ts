import { describe, expect, it } from 'vitest'
import { xiaojingPresetPatches } from '../src/profile-boot.ts'

describe('Xiaojing Agent-preset declarations', () => {
  it('keeps the product preset out of official and unspecified profiles', () => {
    expect(xiaojingPresetPatches(undefined)).toEqual([])
    expect(xiaojingPresetPatches('official')).toEqual([])
    expect(xiaojingPresetPatches('unknown')).toEqual([])
  })

  it('loads Finance as a declarative preset for the Xiaojing profile', () => {
    const patches = xiaojingPresetPatches('xiaojing')
    expect(patches).toHaveLength(1)
    expect(patches[0]?.insert).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'preset-finance',
        name: '@deepseek-ai/dsh-agent-preset',
        config: expect.objectContaining({ id: 'finance', name: 'Finance模式', order: 5 }),
      }),
    ]))
  })
})
