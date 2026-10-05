/** Companion drag messages preserve screen coordinates accepted by Electron's native integer converter. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { XIAOJING_DESKTOP_IPC } from '../src/ipc.ts'
import { normalizeCompanionPreferences } from '../src/xiaojing-companion-geometry.ts'
import { XiaojingDesktopCompanion } from '../src/xiaojing-companion.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const ipc = Object.assign(new EventEmitter(), {
    handle: vi.fn<(channel: string, handler: (event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>) => unknown) => void>(),
  })
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => [display], getPrimaryDisplay: () => display, getDisplayMatching: () => display,
  })
  const windows: FakeWindow[] = []
  const preferences = { json: '{}' }
  class FakeWindow extends EventEmitter {
    destroyed = false
    visible = false
    minimized = false
    topmost = true
    readonly webContents = Object.assign(new EventEmitter(), { mainFrame: { url: 'dsh-app://app/' }, send: vi.fn() })
    bounds: { x: number; y: number; width: number; height: number }
    readonly getBounds = () => ({ ...this.bounds })
    readonly getContentBounds = this.getBounds
    readonly setBounds = vi.fn((bounds: typeof this.bounds) => { this.bounds = { ...bounds } })
    readonly setContentBounds = vi.fn((bounds: typeof this.bounds) => { this.bounds = { ...bounds } })
    readonly setPosition = vi.fn((x: number, y: number) => {
      for (const value of [x, y]) {
        if (!Number.isInteger(value) || Object.is(value, -0) || value < -0x80000000 || value > 0x7fffffff) {
          throw new TypeError('Native window coordinate conversion failed')
        }
      }
      this.bounds = { ...this.bounds, x, y }
    })
    readonly setMenuBarVisibility = vi.fn()
    readonly setAlwaysOnTop = vi.fn((value: boolean) => { this.topmost = value })
    readonly isAlwaysOnTop = () => this.topmost
    readonly moveTop = vi.fn()
    readonly setSkipTaskbar = vi.fn()
    readonly setIgnoreMouseEvents = vi.fn()
    readonly showInactive = vi.fn(() => { this.visible = true; this.emit('show') })
    readonly loadFile = vi.fn(async () => {})
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    isMinimized() { return this.minimized }
    destroy() { this.destroyed = true; this.emit('closed') }
    constructor(bounds: { x: number; y: number; width: number; height: number }) {
      super(); this.bounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; windows.push(this)
    }
  }
  class FakeTray {
    readonly setToolTip = vi.fn()
    readonly setContextMenu = vi.fn()
    readonly on = vi.fn()
    readonly destroy = vi.fn()
    isDestroyed() { return false }
  }
  return { ipc, screen, windows, preferences, FakeWindow, FakeTray }
})

vi.mock('electron', () => ({
  app: { getPath: () => 'owned-companion-test', getAppPath: () => 'owned-companion-app' },
  BrowserWindow: native.FakeWindow, Tray: native.FakeTray, ipcMain: native.ipc, screen: native.screen,
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  Menu: { buildFromTemplate: () => ({ popup: vi.fn() }) },
}))
vi.mock('@deepseek-ai/dsh-atomic-write', () => ({
  writeFileAtomic: vi.fn(async (_path: string, content: string) => { native.preferences.json = content }),
}))
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  readFileSync: (path: string | URL) => {
    if (String(path).endsWith('preferences-v1.json')) return native.preferences.json
    throw new Error('Unexpected companion file read')
  },
}))
vi.mock('../src/xiaojing-product.ts', () => ({ XIAOJING_IDENTITY: { productName: 'Companion test' } }))

let companion: XiaojingDesktopCompanion

beforeEach(async () => {
  vi.useFakeTimers()
  native.windows.length = 0
  native.preferences.json = '{}'
  native.ipc.removeAllListeners()
  companion = new XiaojingDesktopCompanion({ getMainWindow: () => undefined, showMainWindow: vi.fn(), quitApplication: vi.fn() })
  await companion.install()
})
afterEach(async () => {
  await companion.dispose()
  native.ipc.removeAllListeners()
  vi.useRealTimers()
})

describe('desktop companion stays above applications', () => {
  it('raises the displayed companion without activating a window', () => {
    const window = native.windows[0]!
    expect(window.moveTop).not.toHaveBeenCalled()
    window.webContents.emit('did-finish-load')
    expect(window.showInactive).toHaveBeenCalledOnce()
    expect(window.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'screen-saver')
    expect(window.moveTop).toHaveBeenCalledOnce()
    expect(window.showInactive.mock.invocationCallOrder[0]).toBeLessThan(window.moveTop.mock.invocationCallOrder[0]!)
  })

  it('restores the companion after another topmost application changes the stacking order', () => {
    const window = native.windows[0]!
    window.webContents.emit('did-finish-load')
    window.moveTop.mockClear()
    window.setAlwaysOnTop.mockClear()
    vi.advanceTimersByTime(1_000)
    expect(window.setAlwaysOnTop).not.toHaveBeenCalled()
    expect(window.moveTop).toHaveBeenCalledOnce()
    expect(window.showInactive).toHaveBeenCalledOnce()
  })

  it('restores the topmost flag only when it was lost', () => {
    const window = native.windows[0]!
    window.webContents.emit('did-finish-load')
    window.setAlwaysOnTop.mockClear()
    window.topmost = false
    vi.advanceTimersByTime(1_000)
    expect(window.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true, 'screen-saver')
  })

  it('does not raise a hidden companion and releases the refresh when its window closes', () => {
    const window = native.windows[0]!
    vi.advanceTimersByTime(1_000)
    expect(window.moveTop).not.toHaveBeenCalled()
    window.webContents.emit('did-finish-load')
    window.destroy()
    window.moveTop.mockClear()
    vi.advanceTimersByTime(5_000)
    expect(window.moveTop).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

function drag(x: number, y: number): void {
  const window = native.windows[0]!
  window.bounds = { x: 60, y: 80, width: 320, height: 380 }
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  native.ipc.emit(XIAOJING_DESKTOP_IPC.companionDragStart, event, { x: 100, y: 200 })
  native.ipc.emit(XIAOJING_DESKTOP_IPC.companionDragMove, event, { x, y })
}

describe('desktop companion drag IPC', () => {
  it('rounds pointer deltas while retaining negative display positions', () => {
    drag(-20.4, 204.7)
    expect(native.windows[0]!.setPosition).toHaveBeenCalledWith(-60, 85, false)
  })

  it.each([
    [39.75, 200, 0, 80],
    [100, 119.75, 60, 0],
  ])('moves through a fractional screen origin without native conversion errors (%s, %s)', (x, y, expectedX, expectedY) => {
    expect(() => { drag(x, y) }).not.toThrow()
    expect(native.windows[0]!.setPosition).toHaveBeenCalledWith(expectedX, expectedY, false)
  })

  it.each([
    [Number.MAX_VALUE, 200], [100, -Number.MAX_VALUE], [NaN, 200], [100, Infinity],
  ])('discards coordinates outside the native range (%s, %s)', (x, y) => {
    expect(() => { drag(x, y) }).not.toThrow()
    expect(native.windows[0]!.setPosition).not.toHaveBeenCalled()
  })

  it('ignores messages from another renderer and stops moving after the drag ends', () => {
    const window = native.windows[0]!
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionDragStart, { ...event, sender: {} }, { x: 100, y: 200 })
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionDragMove, event, { x: 120, y: 220 })
    expect(window.setPosition).not.toHaveBeenCalled()
    drag(100, 200)
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionDragEnd, event)
    window.setPosition.mockClear()
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionDragMove, event, { x: 120, y: 220 })
    expect(window.setPosition).not.toHaveBeenCalled()
  })
})

describe('desktop companion launch position', () => {
  async function launch(json: string): Promise<BrowserWindow> {
    await companion.dispose()
    native.windows.length = 0
    native.ipc.handle.mockClear()
    native.preferences.json = json
    const main = new BrowserWindow({ x: 180, y: 70, width: 1440, height: 900 })
    native.windows.length = 0
    companion = new XiaojingDesktopCompanion({ getMainWindow: () => main, showMainWindow: vi.fn(), quitApplication: vi.fn() })
    await companion.install()
    return main
  }

  async function invoke(main: BrowserWindow, channel: string): Promise<void> {
    const registration = native.ipc.handle.mock.calls.find(call => call[0] === channel)
    expect(registration).toBeDefined()
    await registration![1]({ sender: main.webContents, senderFrame: main.webContents.mainFrame })
  }

  function moveTo(x: number, y: number): void {
    const window = native.windows[0]!
    const bounds = window.getBounds()
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionDragStart, event, { x: 100, y: 100 })
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionDragMove, event, { x: x + 100 - bounds.x, y: y + 100 - bounds.y })
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionDragEnd, event)
  }

  it('starts at the same bottom-right position for fresh and previously dragged installations', async () => {
    for (const json of ['{}', JSON.stringify({ position: { x: 40, y: 60, displayId: 1 }, scale: 0.75 })]) {
      await launch(json)
      expect(native.windows[0]!.getBounds()).toEqual({ x: 1284, y: 574, width: 320, height: 380 })
    }
    expect(normalizeCompanionPreferences(JSON.parse(native.preferences.json)).scale).toBe(0.75)
  })

  it('keeps a drag during the running application but returns to the default after quitting and relaunching', async () => {
    const main = await launch('{}')
    moveTo(350, 230)
    await invoke(main, XIAOJING_DESKTOP_IPC.companionTuck)
    await invoke(main, XIAOJING_DESKTOP_IPC.companionWake)
    expect(native.windows[1]!.getBounds()).toEqual({ x: 350, y: 230, width: 320, height: 380 })
    await companion.dispose()
    await launch(native.preferences.json)
    expect(native.windows[0]!.getBounds()).toEqual({ x: 1284, y: 574, width: 320, height: 380 })
  })

  it('resets a dragged companion to the same position as a new launch', async () => {
    const main = await launch('{}')
    const window = native.windows[0]!
    moveTo(350, 230)
    await invoke(main, XIAOJING_DESKTOP_IPC.companionReset)
    expect(window.getBounds()).toEqual({ x: 1284, y: 574, width: 320, height: 380 })
  })

  it('keeps a tucked companion hidden at startup and uses the default position when awakened', async () => {
    const main = await launch(JSON.stringify({ visible: false, position: { x: 40, y: 60, displayId: 1 } }))
    expect(native.windows).toHaveLength(0)
    await invoke(main, XIAOJING_DESKTOP_IPC.companionWake)
    expect(native.windows[0]!.getBounds()).toEqual({ x: 1284, y: 574, width: 320, height: 380 })
  })

  it('coalesces main-window movement and layout updates, then preserves a manual drag', async () => {
    const main = await launch('{}')
    const window = native.windows[0]!
    const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    const layout = { viewportWidth: 1440, viewportHeight: 900, composerRight: 1220, composerTop: 730 }
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, layout)
    vi.advanceTimersByTime(150)
    expect(window.getBounds()).toEqual({ x: 1280, y: 566, width: 320, height: 380 })
    main.setBounds({ x: 80, y: 40, width: 1440, height: 900 })
    main.emit('move')
    expect(window.getBounds().x).toBe(1280)
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, { ...layout, composerRight: 1200 })
    main.emit('resize')
    expect(window.getBounds()).toEqual({ x: 1280, y: 566, width: 320, height: 380 })
    window.setContentBounds.mockClear()
    for (let i = 0; i < 80; i++) {
      main.emit('move')
      main.emit('resize')
      native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, { ...layout, composerRight: 1100 + i })
    }
    expect(window.setContentBounds).not.toHaveBeenCalled()
    vi.advanceTimersByTime(149)
    expect(window.setContentBounds).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(window.setContentBounds).toHaveBeenCalledExactlyOnceWith({ x: 1160, y: 536, width: 320, height: 380 }, false)
    moveTo(350, 230)
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, { ...layout, composerRight: 1200 })
    main.emit('resize')
    expect(window.getBounds()).toEqual({ x: 350, y: 230, width: 320, height: 380 })
    await invoke(main, XIAOJING_DESKTOP_IPC.companionReset)
    expect(window.getBounds().x).toBe(1170)
    await invoke(main, XIAOJING_DESKTOP_IPC.companionTuck)
    await invoke(main, XIAOJING_DESKTOP_IPC.companionWake)
    expect(native.windows[1]!.getBounds().x).toBe(1170)
    await companion.dispose()
    for (const name of ['move', 'resize', 'will-move', 'will-resize', 'moved', 'resized']) {
      expect(main.listenerCount(name)).toBe(0)
    }
    expect(native.ipc.listenerCount(XIAOJING_DESKTOP_IPC.companionLayout)).toBe(0)
  })

  it('normalizes the native canvas on reset without feeding its resize back into placement', async () => {
    const main = await launch('{}')
    const window = native.windows[0]!
    const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    const layout = { viewportWidth: 1440, viewportHeight: 900, composerRight: 1220, composerTop: 730 }
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, layout)
    vi.advanceTimersByTime(150)
    window.bounds.width = 380
    window.bounds.height = 424
    window.emit('resize')
    expect(window.getBounds()).toEqual({ x: 1280, y: 566, width: 380, height: 424 })
    vi.advanceTimersByTime(1_000)
    expect(window.getBounds()).toEqual({ x: 1280, y: 566, width: 380, height: 424 })
    await invoke(main, XIAOJING_DESKTOP_IPC.companionReset)
    expect(window.getBounds()).toEqual({ x: 1280, y: 566, width: 320, height: 380 })
    expect(window.getBounds().x + window.getBounds().width - 20 - 70).toBe(1510)
    expect(window.getBounds().y + window.getBounds().height).toBe(946)
    expect(window.setBounds).not.toHaveBeenCalled()
    window.setContentBounds.mockClear()
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, layout)
    expect(window.setContentBounds).not.toHaveBeenCalled()
  })

  it('keeps the companion in place while minimized and resumes placement on restore', async () => {
    const main = await launch('{}')
    const window = native.windows[0]!
    const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    const layout = { viewportWidth: 1440, viewportHeight: 900, composerRight: 1220, composerTop: 730 }
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, layout)
    vi.advanceTimersByTime(150)
    const before = window.getBounds()
    window.setContentBounds.mockClear()
    main.emit('resize')
    vi.advanceTimersByTime(50)
    const minimized = vi.spyOn(main, 'isMinimized').mockReturnValue(true)
    main.setBounds({ x: -32000, y: -32000, width: 160, height: 28 })
    main.emit('minimize')
    main.emit('move')
    main.emit('resize')
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, layout)
    vi.advanceTimersByTime(1000)
    expect(window.getBounds()).toEqual(before)
    expect(window.setContentBounds).not.toHaveBeenCalled()
    minimized.mockReturnValue(false)
    main.setBounds({ x: 80, y: 40, width: 1440, height: 900 })
    main.emit('restore')
    vi.advanceTimersByTime(150)
    expect(window.getBounds()).toEqual({ x: 1180, y: 536, width: 320, height: 380 })
    await companion.dispose()
    expect(main.listenerCount('restore')).toBe(0)
  })

  it.each([['will-move', 'moved'], ['will-resize', 'resized']])(
    'does not move or restack the companion during a native %s interaction, even when paused', async (begin, end) => {
      const main = await launch('{}')
      const window = native.windows[0]!
      const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
      const layout = { viewportWidth: 1440, viewportHeight: 900, composerRight: 1220, composerTop: 730 }
      window.webContents.emit('did-finish-load')
      native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, layout)
      vi.advanceTimersByTime(150)
      window.setContentBounds.mockClear()
      window.moveTop.mockClear()
      window.setAlwaysOnTop.mockClear()
      main.emit(begin)
      for (let i = 0; i < 30; i++) {
        main.setBounds({ x: 180 + i, y: 70, width: 1440, height: 900 })
        main.emit('move')
        main.emit('resize')
        native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, { ...layout, composerRight: 1200 })
        vi.advanceTimersByTime(200)
      }
      expect(window.setContentBounds).not.toHaveBeenCalled()
      expect(window.moveTop).not.toHaveBeenCalled()
      expect(window.setAlwaysOnTop).not.toHaveBeenCalled()
      main.emit(end)
      vi.advanceTimersByTime(150)
      expect(window.setContentBounds).toHaveBeenCalledExactlyOnceWith({ x: 1299, y: 566, width: 320, height: 380 }, false)
      vi.advanceTimersByTime(1_000)
      expect(window.moveTop).toHaveBeenCalledOnce()
    },
  )

  it('cancels a pending placement when dragged, tucked or disposed', async () => {
    const main = await launch('{}')
    const window = native.windows[0]!
    const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    const layout = { viewportWidth: 1440, viewportHeight: 900, composerRight: 1220, composerTop: 730 }
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, layout)
    moveTo(350, 230)
    window.setContentBounds.mockClear()
    vi.advanceTimersByTime(150)
    expect(window.setContentBounds).not.toHaveBeenCalled()
    await invoke(main, XIAOJING_DESKTOP_IPC.companionReset)
    main.emit('resize')
    await invoke(main, XIAOJING_DESKTOP_IPC.companionTuck)
    expect(vi.getTimerCount()).toBe(0)
    await invoke(main, XIAOJING_DESKTOP_IPC.companionWake)
    main.emit('resize')
    await companion.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores malformed layout and layout sent by the companion or another frame', async () => {
    const main = await launch('{}')
    const window = native.windows[0]!
    const before = window.getBounds()
    const layout = { viewportWidth: 1440, viewportHeight: 900, composerRight: 1220, composerTop: 730 }
    const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, event, { ...layout, composerRight: NaN })
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, { sender: window.webContents, senderFrame: window.webContents.mainFrame }, layout)
    native.ipc.emit(XIAOJING_DESKTOP_IPC.companionLayout, { ...event, senderFrame: {} }, layout)
    expect(window.getBounds()).toEqual(before)
  })
})
