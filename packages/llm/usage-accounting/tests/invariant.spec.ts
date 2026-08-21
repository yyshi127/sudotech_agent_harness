import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { apply } from '../src/invariant.ts'

describe('usage-accounting invariant companion', () => {
  it('accepts monotonic committed revisions and rejects mismatches', async () => {
    let installer!: InvariantInstaller
    const dispose = vi.fn()
    const ctx = {
      invariants: {
        register: vi.fn((_packageName: string, candidate: InvariantInstaller) => {
          installer = candidate
          return dispose
        }),
      },
    } as unknown as Context

    expect(apply(ctx)).toBe(dispose)
    let listener!: (revision: number) => void
    const child = {
      on: vi.fn((_event: string, candidate: (revision: number) => void) => { listener = candidate }),
      get: vi.fn(() => ({ revision: 1 })),
    } as unknown as Context
    const failures: string[] = []
    const fail = (message: string): never => {
      failures.push(message)
      throw new Error(message)
    }
    await installer(child, fail)

    listener(1)
    expect(failures).toEqual([])

    expect(() => { listener(1) }).toThrow(/does not match/u)
    child.get = vi.fn(() => undefined)
    expect(() => { listener(2) }).toThrow(/does not match/u)
    expect(failures).toHaveLength(2)
  })
})
