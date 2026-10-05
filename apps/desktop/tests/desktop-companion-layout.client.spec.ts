// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installXiaojingCompanionLayout } from '../src/xiaojing-companion-layout.ts'
import type { DesktopCompanionLayout } from '../src/xiaojing-companion-geometry.ts'

let dispose: (() => void) | undefined
let resized: (() => void) | undefined
const disconnect = vi.fn()
const observe = vi.fn()
const unobserve = vi.fn()
const send = vi.fn<(layout: DesktopCompanionLayout) => void>()
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe = observe
    unobserve = unobserve
    disconnect = disconnect
  })
  vi.stubGlobal('innerWidth', 1280)
  vi.stubGlobal('innerHeight', 820)
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useRealTimers()
})

function card(rect: DOMRect): HTMLDivElement {
  const element = document.createElement('div')
  element.setAttribute('data-composer-card', '')
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect)
  document.body.append(element)
  return element
}
async function flush(): Promise<void> { await vi.advanceTimersByTimeAsync(40) }

describe('main preload companion layout observation', () => {
  it('waits for the composer to mount and reports its actual edge once', async () => {
    dispose = installXiaojingCompanionLayout(send)
    await flush()
    expect(send).not.toHaveBeenCalled()
    const rect = new DOMRect(300, 640, 750, 130)
    const element = card(rect)
    await flush()
    expect(send).toHaveBeenCalledExactlyOnceWith({ viewportWidth: 1280, viewportHeight: 820, composerRight: 1050, composerTop: 640 })
    document.body.setAttribute('class', 'changed-without-geometry')
    resized?.()
    await flush()
    expect(send).toHaveBeenCalledOnce()
    expect(observe).toHaveBeenCalledExactlyOnceWith(element)
    rect.width = 700
    resized?.()
    await flush()
    expect(send).toHaveBeenLastCalledWith({ viewportWidth: 1280, viewportHeight: 820, composerRight: 1000, composerTop: 640 })
    element.remove()
    await flush()
    expect(unobserve).toHaveBeenCalledExactlyOnceWith(element)
  })

  it('uses the largest visible composer and refreshes after window resizing', async () => {
    card(new DOMRect(0, 0, 0, 0))
    card(new DOMRect(1000, 200, 200, 100))
    card(new DOMRect(300, 640, 750, 130))
    dispose = installXiaojingCompanionLayout(send)
    await flush()
    expect(send.mock.lastCall?.[0].composerRight).toBe(1050)
    vi.stubGlobal('innerWidth', 1440)
    window.dispatchEvent(new Event('resize'))
    await flush()
    expect(send.mock.lastCall?.[0].viewportWidth).toBe(1440)
  })

  it('releases pending measurements and cannot restart after disposal', async () => {
    card(new DOMRect(300, 640, 750, 130))
    dispose = installXiaojingCompanionLayout(send)
    dispose()
    resized?.()
    window.dispatchEvent(new Event('resize'))
    await flush()
    expect(send).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
