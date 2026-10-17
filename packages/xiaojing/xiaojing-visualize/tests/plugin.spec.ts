/** Plugin registration and bundled skill behavior. */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import { apply, Config, inject, name } from '../src/index.ts'
import { visualizeSkillProvider } from '../src/skill.ts'

describe('xiaojing visualize plugin', () => {
  it('declares its identity, validates defaults, and registers both contributions', () => {
    const register = vi.fn()
    const registerProvider = vi.fn<(provider: () => unknown) => void>()
    const ctx = {
      tools: { register },
      skills: { registerProvider },
    } as unknown as Context

    expect(name).toBe('xiaojing-visualize')
    expect(inject).toEqual(['tools', 'skills', 'fs', 'workingDirectory'])
    expect(Config({} as unknown as import('../src/index.ts').Config)).toEqual({ maxFragmentBytes: 1_000_000 })
    apply(ctx, { maxFragmentBytes: 1234 })
    expect(register).toHaveBeenCalledTimes(1)
    expect(registerProvider).toHaveBeenCalledTimes(1)
    const providerFactory = registerProvider.mock.calls[0]?.[0]
    expect(providerFactory?.()).toBe(visualizeSkillProvider)
  })

  it('lists and loads the bundled authoring skill', async () => {
    const listed = await visualizeSkillProvider.list({})
    const candidates: readonly SkillCandidate[] = 'candidates' in listed ? listed.candidates : listed
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      name: 'visualize',
      provider: 'dsh-visualize',
      source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
    })
    const candidate = candidates[0]
    if (candidate === undefined) throw new Error('visualize provider returned no candidate')
    const definition = await visualizeSkillProvider.get(candidate, {})
    if (definition === undefined) throw new Error('visualize provider did not load its candidate')
    expect(definition).toMatchObject({
      name: 'visualize',
      provider: 'dsh-visualize',
      source: 'bundled',
    })
    expect(definition.content).toContain('# Visualize')
    expect(definition.resourceBase?.kind).toBe('directory')
  })
})
