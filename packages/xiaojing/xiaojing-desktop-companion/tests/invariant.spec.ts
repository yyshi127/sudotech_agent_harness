import { describe, expect, it, vi } from 'vitest'
import * as invariant from '../src/invariant.ts'

describe('xiaojing-desktop-companion invariant companion', () => {
  it('registers the package-owned ephemeral-state installer', async () => {
    const register = vi.fn().mockReturnValue(() => {})
    const ctx = { invariants: { register } } as never
    const dispose = await invariant.apply(ctx)
    expect(invariant.name).toBe('xiaojing-desktop-companion-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-xiaojing-desktop-companion', expect.any(Function))
    const install = register.mock.calls[0]![1] as () => undefined
    install()
    expect(dispose).toBeTypeOf('function')
  })
})
