/** Built preloads must execute with only Electron's sandbox-supported require. */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const preload = (name: string): string => fileURLToPath(new URL(`../lib/${name}.cjs`, import.meta.url))

/**
 * Browser globals a sandboxed Electron preload sees. A preload runs while the
 * document is still loading, so the theme preload defers its first read to
 * `DOMContentLoaded` and observes later `html[data-ds-theme-source]` changes.
 * @returns context globals plus the root attribute transitions the Web UI performs.
 */
function browserEnvironment() {
  const attributes = new Map<string, string>()
  const listeners = new Map<string, Array<() => void>>()
  const observers = new Set<() => void>()
  const frames = new Map<number, () => void>()
  let nextFrame = 1
  const composer = { getBoundingClientRect: () => ({ width: 750, height: 130, right: 1050, top: 640 }) }
  const resizeDisconnected = vi.fn()
  const document = {
    readyState: 'loading',
    querySelectorAll: () => [composer],
    documentElement: {
      dataset: {} as Record<string, string>,
      getAttribute: (name: string): string | null => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string): void => { attributes.set(name, value) },
    },
  }
  const window = {
    innerWidth: 1280,
    innerHeight: 820,
    requestAnimationFrame(callback: () => void): number {
      const frame = nextFrame++
      frames.set(frame, callback)
      return frame
    },
    cancelAnimationFrame: (frame: number): void => { frames.delete(frame) },
    addEventListener: (type: string, listener: () => void): void => {
      listeners.set(type, [...listeners.get(type) ?? [], listener])
    },
    removeEventListener: (type: string, listener: () => void): void => {
      listeners.set(type, (listeners.get(type) ?? []).filter(current => current !== listener))
    },
  }
  class SandboxMutationObserver {
    constructor(private readonly callback: () => void) { observers.add(callback) }
    disconnect(): void { observers.delete(this.callback) }
    observe(): void {}
  }
  class SandboxResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect = resizeDisconnected
  }
  return {
    globals: { document, window, MutationObserver: SandboxMutationObserver, ResizeObserver: SandboxResizeObserver },
    resizeDisconnected,
    /** Settle the browser's queued companion measurement without scheduling another frame. */
    flushFrame(): number {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
      return pending.length
    },
    /** Dispatch window lifecycle events to the currently registered preload listeners. */
    dispatch(type: string): void {
      for (const listener of listeners.get(type) ?? []) listener()
    },
    /** Writes the theme root attribute and settles the document, as the theme bootstrap does before DOMContentLoaded. */
    loadTheme(value: string): void {
      attributes.set('data-ds-theme-source', value)
      for (const listener of listeners.get('DOMContentLoaded') ?? []) listener()
    },
    /** Applies a later theme preference change through the observer the preload registered. */
    changeTheme(value: string): void {
      attributes.set('data-ds-theme-source', value)
      for (const observer of observers) observer()
    },
  }
}

describe.skipIf(!existsSync(preload('preload-app')))('built sandboxed Desktop preloads', () => {
  it.each(['preload-app', 'preload-welcome'])('%s loads without filesystem module access', async (name) => {
    const exposed = new Map<string, Record<string, unknown>>()
    const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve({ languages: ['en-US'], preference: 'zh' }))
    const send = vi.fn()
    const browser = browserEnvironment()
    const electron = {
      contextBridge: { exposeInMainWorld: (key: string, value: Record<string, unknown>) => { exposed.set(key, value) } },
      ipcRenderer: { invoke, send, on: vi.fn(), off: vi.fn() },
    }
    runInNewContext(readFileSync(preload(name), 'utf8'), {
      ...browser.globals,
      require: (id: string) => {
        if (id !== 'electron') throw new Error(`sandbox cannot load ${id}`)
        return electron
      },
      process: { argv: ['electron', '--dsh-welcome-locale=en'], isMainFrame: true },
      location: new URL('dsh-app://app/'),
      exports: {},
    })
    if (name === 'preload-app') {
      const product = exposed.get('dshDesktop') as { deviceInfo(): Promise<string> }
      invoke.mockResolvedValueOnce('platform=darwin; memory_gib=32.0')
      await expect(product.deviceInfo()).resolves.toBe('platform=darwin; memory_gib=32.0')
      expect(invoke).toHaveBeenCalledWith('dsh-desktop:device-info')
      browser.loadTheme('dark')
      expect(send).toHaveBeenCalledWith('dsh-desktop:native-theme-set', 'dark')
      browser.changeTheme('light')
      expect(send).toHaveBeenCalledWith('dsh-desktop:native-theme-set', 'light')
      const bridge = exposed.get('__DSH_LOCALE__') as { read(): unknown; onChange(locale: string): void }
      bridge.read()
      expect(invoke).toHaveBeenCalledWith('dsh-desktop:locale-bootstrap')
      bridge.onChange('zh')
      expect(send).toHaveBeenCalledWith('dsh-desktop:locale-changed', 'zh')
      expect(browser.flushFrame()).toBe(1)
      expect(send).toHaveBeenCalledWith('xiaojing-desktop:companion-layout', {
        viewportWidth: 1280, viewportHeight: 820, composerRight: 1050, composerTop: 640,
      })
      browser.dispatch('resize')
      browser.dispatch('beforeunload')
      expect(browser.resizeDisconnected).toHaveBeenCalledOnce()
      expect(browser.flushFrame()).toBe(0)
      browser.dispatch('resize')
      expect(browser.flushFrame()).toBe(0)
    } else {
      expect(exposed.has('dshWelcome')).toBe(true)
      const bridge = exposed.get('dshWelcome') as { takeNotice(): Promise<unknown> }
      void bridge.takeNotice()
      expect(invoke).toHaveBeenCalledWith('dsh-welcome:take-notice')
    }
  })
})
