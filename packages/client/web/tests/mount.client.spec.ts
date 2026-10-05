// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { mountClient } from '../src/mount.ts'

/** Provide a fake `uiRenderer` from its own plugin fiber so it can be replaced. */
function provideRenderer(ctx: Context, mount: (container: HTMLElement) => () => void) {
  return ctx.plugin({ apply: (scope: Context) => { scope.reflect.provide('uiRenderer', { mount }) } })
}

describe('mountClient', () => {
  it('mounts into the container and unmounts when the tree is disposed', async () => {
    const ctx = new Context()
    const unmount = vi.fn()
    const mount = vi.fn((_container: HTMLElement) => unmount)
    provideRenderer(ctx, mount)
    const container = document.createElement('div')

    await mountClient(ctx, container)

    expect(mount).toHaveBeenCalledExactlyOnceWith(container)
    expect(unmount).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
    expect(unmount).toHaveBeenCalledOnce()
  })

  it('remounts when uiRenderer is replaced', async () => {
    const ctx = new Context()
    const container = document.createElement('div')
    const first = { unmount: vi.fn(), mount: vi.fn(() => first.unmount) }
    const second = { unmount: vi.fn(), mount: vi.fn(() => second.unmount) }

    await mountClient(ctx, container)
    expect(first.mount).not.toHaveBeenCalled()

    const renderer = provideRenderer(ctx, first.mount)
    await vi.waitFor(() => { expect(first.mount).toHaveBeenCalledExactlyOnceWith(container) })

    await renderer.dispose()
    expect(first.unmount).toHaveBeenCalledOnce()

    provideRenderer(ctx, second.mount)
    await vi.waitFor(() => { expect(second.mount).toHaveBeenCalledExactlyOnceWith(container) })
    await ctx.fiber.dispose()
    expect(second.unmount).toHaveBeenCalledOnce()
  })

  it('stops remounting after the awaited mount disposer and unmounts only once', async () => {
    const ctx = new Context()
    const first = { unmount: vi.fn(), mount: vi.fn(() => first.unmount) }
    const second = { unmount: vi.fn(), mount: vi.fn(() => second.unmount) }
    const renderer = provideRenderer(ctx, first.mount)
    const stop = await mountClient(ctx, document.createElement('div'))
    await stop()
    expect(first.unmount).toHaveBeenCalledOnce()
    await stop()
    await renderer.dispose()
    await provideRenderer(ctx, second.mount)
    expect(second.mount).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
    expect(first.unmount).toHaveBeenCalledOnce()
  })

  it('waits for renderer cleanup before the mount disposer resolves', async () => {
    const ctx = new Context()
    const started = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    provideRenderer(ctx, () => async () => {
      started.resolve(undefined)
      await finish.promise
    })
    const stop = await mountClient(ctx, document.createElement('div'))
    let stopped = false
    const stopping = stop().then(() => { stopped = true })
    try {
      await started.promise
      expect(stopped).toBe(false)
      expect(ctx.get('uiRenderer')).toBeDefined()
    } finally {
      finish.resolve(undefined)
      await stopping
      await ctx.fiber.dispose()
    }
    expect(stopped).toBe(true)
  })
})
