/** Xiaojing tray, transparent companion window, and content-free Host state stream. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import { assertDesktopSender, XIAOJING_DESKTOP_IPC } from './ipc.ts'
import {
  IDLE_COMPANION_SNAPSHOT,
  defaultCompanionBounds,
  isCompanionScale,
  isCompanionSnapshot,
  normalizeCompanionPreferences,
  resolveCompanionBounds,
  type DesktopCompanionBounds,
  type DesktopCompanionPreferences,
  type DesktopCompanionSnapshot,
} from './xiaojing-companion-geometry.ts'
import { XIAOJING_IDENTITY } from './xiaojing-product.ts'

const STREAM_RETRY_MS = 1_000
const PREFERENCES_MODE = 0o600
const PREFERENCES_DIRECTORY_MODE = 0o700

interface ScreenPoint { readonly x: number; readonly y: number }

/** Main-window and lifecycle operations supplied by the Desktop shell. */
export interface XiaojingCompanionOptions {
  readonly getMainWindow: () => BrowserWindow | undefined
  readonly showMainWindow: () => void
  readonly quitApplication: () => void
}

/** Combined local-window and Host state sent to the Xiaojing renderers. */
export interface XiaojingDesktopState {
  readonly available: true
  readonly visible: boolean
  readonly applicationReady: boolean
  readonly scale: number
  readonly snapshot: DesktopCompanionSnapshot
}

/** Owns the Xiaojing tray and companion for one Electron application lifetime. */
export class XiaojingDesktopCompanion {
  private window: BrowserWindow | undefined
  private tray: Tray | undefined
  private streamAbort: AbortController | undefined
  private snapshot: DesktopCompanionSnapshot = { ...IDLE_COMPANION_SNAPSHOT }
  private stateReadable = false
  private applicationReady = false
  private preferences: DesktopCompanionPreferences
  private preferenceWrite = Promise.resolve()
  private dragState: { pointer: ScreenPoint; bounds: DesktopCompanionBounds } | undefined
  private installed = false
  private disposed = false

  constructor(private readonly options: XiaojingCompanionOptions) {
    this.preferences = this.readPreferences()
  }

  /** Register application-lifetime IPC, display recovery, tray, and the saved companion visibility. */
  async install(): Promise<void> {
    if (this.installed) return
    this.installed = true
    this.registerIpc()
    screen.on('display-removed', this.recoverDisplay)
    screen.on('display-metrics-changed', this.recoverDisplay)
    this.createTray()
    if (this.preferences.visible) await this.wake(true)
  }

  /** Mark the application document ready so the one-time greeting can begin. */
  ready(): void {
    if (this.applicationReady) return
    this.applicationReady = true
    this.broadcast()
  }

  /** Connect the companion to the authenticated, content-free Host state stream. */
  connect(hostUrl: string, cookie: string): void {
    this.streamAbort?.abort()
    const controller = new AbortController()
    this.streamAbort = controller
    void this.consumeStateStream(new URL('/xiaojing-desktop-companion/events', hostUrl).href, cookie, controller.signal)
  }

  /** Stop reading Host state and publish an unreadable idle snapshot until the next Host starts. */
  disconnect(): void {
    this.streamAbort?.abort()
    this.streamAbort = undefined
    this.stateReadable = false
    this.snapshot = { ...IDLE_COMPANION_SNAPSHOT }
    this.broadcast()
  }

  /** Hide the main window to the tray and show the one-time background-lifecycle notice. */
  hideMainWindow(): void {
    const window = this.options.getMainWindow()
    if (window === undefined || window.isDestroyed()) return
    window.hide()
    if (this.preferences.trayHintShown) return
    this.preferences.trayHintShown = true
    this.persistPreferences()
    this.tray?.displayBalloon({
      title: '小兢会计仍在运行',
      content: '已最小化到系统托盘，后台任务和微信连接不会中断。',
      iconType: 'info',
    })
  }

  /** Report an online or unreadable Weixin connection for the shell quit inspection. */
  hasActiveConnection(): boolean {
    return !this.stateReadable || this.snapshot.weixinOnline
  }

  /** Request the shell-owned quit path, which inspects work and owns the confirmation. */
  requestQuit(): Promise<void> {
    this.options.quitApplication()
    return Promise.resolve()
  }

  /** Release display listeners, stream, companion window, tray, and pending preference writes. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.streamAbort?.abort()
    this.streamAbort = undefined
    screen.off('display-removed', this.recoverDisplay)
    screen.off('display-metrics-changed', this.recoverDisplay)
    if (this.window !== undefined && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
    this.tray?.destroy()
    this.tray = undefined
    await this.preferenceWrite
  }

  private readonly recoverDisplay = (): void => {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const current = window.getBounds()
    const bounds = resolveCompanionBounds(
      { position: { x: current.x, y: current.y, displayId: screen.getDisplayMatching(current).id } },
      screen.getAllDisplays(),
      screen.getPrimaryDisplay(),
    )
    window.setBounds(bounds, false)
    this.persistPosition()
  }

  private createTray(): void {
    const image = nativeImage.createFromPath(this.asset('windows-icon.png')).resize({ width: 24, height: 24 })
    this.tray = new Tray(image)
    this.tray.setToolTip(XIAOJING_IDENTITY.productName)
    this.tray.on('double-click', this.options.showMainWindow)
    this.updateTrayMenu()
  }

  private updateTrayMenu(): void {
    if (this.tray === undefined || this.tray.isDestroyed()) return
    const visible = this.window !== undefined && !this.window.isDestroyed()
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开小兢会计', click: this.options.showMainWindow },
      { label: visible ? '收起桌面小兢' : '唤醒桌面小兢',
        click: () => { if (visible) this.tuck(); else void this.wake() } },
      { label: '重置桌面小兢位置', click: () => { void this.resetPosition() } },
      { type: 'separator' },
      { label: '退出小兢会计', click: () => { void this.requestQuit() } },
    ]))
  }

  private companionContextMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: '打开小兢会计', click: this.options.showMainWindow },
      { label: '收起桌面小兢', click: () => { this.tuck() } },
      { label: '重置桌面位置', click: () => { void this.resetPosition() } },
    ])
  }

  private async wake(startupGreeting = false): Promise<XiaojingDesktopState> {
    if (this.window !== undefined && !this.window.isDestroyed()) {
      this.window.showInactive()
      this.preferences.visible = true
      this.persistPreferences()
      this.broadcast()
      return this.state()
    }
    const placement = this.defaultPlacement()
    const bounds = resolveCompanionBounds(
      this.preferences,
      screen.getAllDisplays(),
      placement.display,
      placement.mainWindowBounds,
    )
    const window = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      title: '桌面小兢',
      icon: this.asset('windows-icon.png'),
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(app.getAppPath(), 'lib', 'preload-xiaojing-companion.cjs'),
      },
    })
    this.window = window
    window.setMenuBarVisibility(false)
    window.setAlwaysOnTop(true, 'floating')
    window.setSkipTaskbar(true)
    window.setIgnoreMouseEvents(true, { forward: true })
    window.on('closed', () => {
      if (this.window === window) this.window = undefined
      this.dragState = undefined
      this.broadcast()
    })
    window.webContents.on('did-finish-load', () => {
      if (window.isDestroyed()) return
      window.webContents.send(XIAOJING_DESKTOP_IPC.companionChanged, this.state())
      window.showInactive()
    })
    await window.loadFile(join(app.getAppPath(), 'companion.html'),
      startupGreeting ? { query: { startupGreeting: '1' } } : undefined)
    this.preferences.visible = true
    this.persistPreferences()
    this.updateTrayMenu()
    return this.state()
  }

  private tuck(): XiaojingDesktopState {
    this.preferences.visible = false
    this.persistPreferences()
    if (this.window !== undefined && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
    this.updateTrayMenu()
    this.broadcast()
    return this.state()
  }

  private setScale(scale: unknown): XiaojingDesktopState {
    if (!isCompanionScale(scale)) throw new TypeError('desktop companion scale must be between 0.3 and 1')
    this.preferences.scale = scale
    this.persistPreferences()
    this.broadcast()
    return this.state()
  }

  private async resetPosition(): Promise<XiaojingDesktopState> {
    const placement = this.defaultPlacement()
    const bounds = defaultCompanionBounds(placement.display, placement.mainWindowBounds)
    this.preferences.position = { x: bounds.x, y: bounds.y, displayId: placement.display.id }
    this.persistPreferences()
    await this.wake()
    this.window?.setBounds(bounds, false)
    this.persistPosition()
    return this.state()
  }

  private defaultPlacement(): { display: Electron.Display; mainWindowBounds?: Electron.Rectangle } {
    const main = this.options.getMainWindow()
    const mainWindowBounds = main === undefined || main.isDestroyed() ? undefined : main.getBounds()
    return {
      ...(mainWindowBounds === undefined ? {} : { mainWindowBounds }),
      display: mainWindowBounds === undefined ? screen.getPrimaryDisplay() : screen.getDisplayMatching(mainWindowBounds),
    }
  }

  private registerIpc(): void {
    ipcMain.handle(XIAOJING_DESKTOP_IPC.applicationInfo, (event) => {
      this.assertMainSender(event)
      return { version: app.isPackaged ? app.getVersion() : XIAOJING_IDENTITY.productVersion }
    })
    ipcMain.handle(XIAOJING_DESKTOP_IPC.companionState, (event) => {
      this.assertProductSender(event)
      return this.state()
    })
    ipcMain.handle(XIAOJING_DESKTOP_IPC.companionWake, (event) => {
      this.assertMainSender(event)
      return this.wake()
    })
    ipcMain.handle(XIAOJING_DESKTOP_IPC.companionTuck, (event) => {
      this.assertMainSender(event)
      return this.tuck()
    })
    ipcMain.handle(XIAOJING_DESKTOP_IPC.companionReset, (event) => {
      this.assertMainSender(event)
      return this.resetPosition()
    })
    ipcMain.handle(XIAOJING_DESKTOP_IPC.companionScale, (event, scale: unknown) => {
      this.assertMainSender(event)
      return this.setScale(scale)
    })
    ipcMain.handle(XIAOJING_DESKTOP_IPC.showMain, (event) => {
      this.assertProductSender(event)
      this.options.showMainWindow()
    })
    ipcMain.on(XIAOJING_DESKTOP_IPC.companionPointer, (event, interactive: unknown) => {
      if (!this.isCompanionSender(event) || typeof interactive !== 'boolean') return
      if (interactive) this.window?.setIgnoreMouseEvents(false)
      else this.window?.setIgnoreMouseEvents(true, { forward: true })
    })
    ipcMain.on(XIAOJING_DESKTOP_IPC.companionDragStart, (event, point: unknown) => {
      if (!this.isCompanionSender(event) || !isScreenPoint(point) || this.window === undefined) return
      this.dragState = { pointer: point, bounds: this.window.getBounds() }
    })
    ipcMain.on(XIAOJING_DESKTOP_IPC.companionDragMove, (event, point: unknown) => {
      if (!this.isCompanionSender(event) || !isScreenPoint(point)
        || this.dragState === undefined || this.window === undefined) return
      this.window.setPosition(
        Math.round(this.dragState.bounds.x + point.x - this.dragState.pointer.x),
        Math.round(this.dragState.bounds.y + point.y - this.dragState.pointer.y),
        false,
      )
    })
    ipcMain.on(XIAOJING_DESKTOP_IPC.companionDragEnd, (event) => {
      if (!this.isCompanionSender(event)) return
      this.dragState = undefined
      this.persistPosition()
    })
    ipcMain.on(XIAOJING_DESKTOP_IPC.companionContextMenu, (event) => {
      if (!this.isCompanionSender(event)) return
      const window = this.window
      this.companionContextMenu().popup(window === undefined ? {} : { window })
    })
  }

  private assertMainSender(event: IpcMainInvokeEvent): void {
    const window = this.options.getMainWindow()
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('xiaojing desktop: rejected IPC from an unowned renderer')
    }
    assertDesktopSender(event, ['app'])
  }

  private assertProductSender(event: IpcMainInvokeEvent): void {
    if (this.isCompanionSender(event)) return
    this.assertMainSender(event)
  }

  private isCompanionSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return this.window !== undefined && !this.window.isDestroyed()
      && event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame
  }

  private state(): XiaojingDesktopState {
    return {
      available: true,
      visible: this.window !== undefined && !this.window.isDestroyed(),
      applicationReady: this.applicationReady,
      scale: this.preferences.scale,
      snapshot: { ...this.snapshot },
    }
  }

  private broadcast(): void {
    const state = this.state()
    for (const window of [this.options.getMainWindow(), this.window]) {
      if (window !== undefined && !window.isDestroyed()) {
        window.webContents.send(XIAOJING_DESKTOP_IPC.companionChanged, state)
      }
    }
    this.updateTrayMenu()
  }

  private persistPosition(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const bounds = window.getBounds()
    this.preferences.position = { x: bounds.x, y: bounds.y, displayId: screen.getDisplayMatching(bounds).id }
    this.persistPreferences()
  }

  private preferencesPath(): string {
    return join(app.getPath('userData'), 'desktop-companion', 'preferences-v1.json')
  }

  private readPreferences(): DesktopCompanionPreferences {
    try { return normalizeCompanionPreferences(JSON.parse(readFileSync(this.preferencesPath(), 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      return normalizeCompanionPreferences(undefined)
    }
  }

  private persistPreferences(): void {
    const content = `${JSON.stringify(this.preferences, undefined, 2)}\n`
    this.preferenceWrite = this.preferenceWrite.then(() => writeFileAtomic(this.preferencesPath(), content, {
      mode: PREFERENCES_MODE,
      dirMode: PREFERENCES_DIRECTORY_MODE,
    })).catch((error: unknown) => {
      console.error('desktop companion: failed to persist preferences', error)
    })
  }

  private async consumeStateStream(url: string, cookie: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(url, { signal, headers: { accept: 'text/event-stream', cookie } })
        if (!response.ok || response.body === null) throw new Error(`state stream returned ${String(response.status)}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          buffer += decoder.decode(part.value, { stream: true }).replaceAll('\r\n', '\n')
          let split = buffer.indexOf('\n\n')
          while (split >= 0) {
            const frame = buffer.slice(0, split)
            buffer = buffer.slice(split + 2)
            const payload = frame.split('\n').filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trimStart()).join('\n')
            if (payload !== '') this.acceptSnapshot(payload)
            split = buffer.indexOf('\n\n')
          }
        }
      } catch (error) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- The signal can abort while fetch or reader.read awaits.
        if (signal.aborted) return
        console.error('desktop companion: state stream disconnected', error)
      }
      this.stateReadable = false
      this.broadcast()
      await waitForRetry(signal)
    }
  }

  private acceptSnapshot(payload: string): void {
    try {
      const next: unknown = JSON.parse(payload)
      if (!isCompanionSnapshot(next)) return
      this.snapshot = next
      this.stateReadable = true
      this.broadcast()
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      // The local Host owns this stream; an incomplete frame is ignored until the connection retries.
    }
  }

  private asset(name: string): string {
    return join(app.getAppPath(), 'assets', name)
  }
}

function isScreenPoint(value: unknown): value is ScreenPoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const point = value as Record<string, unknown>
  return typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y)
}

function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, STREAM_RETRY_MS)
    signal.addEventListener('abort', finish, { once: true })
  })
}
