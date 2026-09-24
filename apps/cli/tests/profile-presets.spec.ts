import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { shippedPresetRoots } from '../src/profile-boot.ts'

const CONFIG_ROOT = fileURLToPath(new URL('../config/', import.meta.url))

function rootNames(profile: string | undefined): string[] {
  return shippedPresetRoots(profile).map((root) => {
    const relativePath = relative(CONFIG_ROOT, root.path).replaceAll('\\', '/')
    return relativePath.startsWith('../') ? 'built-in-agent-presets' : relativePath
  })
}

describe('shipped Agent-preset roots', () => {
  it('keeps product presets out of official and unspecified profiles', () => {
    expect(rootNames(undefined)).toEqual(['built-in-agent-presets'])
    expect(rootNames('official')).toEqual(['built-in-agent-presets'])
    expect(rootNames('unknown')).toEqual(['built-in-agent-presets'])
  })

  it('adds the Xiaojing product root after the official root', () => {
    expect(rootNames('xiaojing')).toEqual(['built-in-agent-presets', 'xiaojing-agent-presets'])
    expect(shippedPresetRoots('xiaojing').every(root => root.trust === 'system')).toBe(true)
  })
})
