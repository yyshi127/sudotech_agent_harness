/** Restricted Xiaojing bridges shared by the application and companion preloads. */

import { contextBridge, ipcRenderer } from 'electron'
import { XIAOJING_DESKTOP_IPC } from './ipc.ts'
import type { DesktopCompanionSnapshot } from './xiaojing-companion-geometry.ts'

/** State returned by the product-owned companion bridge. */
export interface XiaojingDesktopState {
  readonly available: true
  readonly visible: boolean
  readonly applicationReady: boolean
  readonly scale: number
  readonly snapshot: DesktopCompanionSnapshot
}

/** Expose only the Xiaojing application and companion operations. */
export function exposeXiaojingDesktopBridge(): void {
  contextBridge.exposeInMainWorld('xiaojingDesktop', {
    getApplicationInfo: () => ipcRenderer.invoke(XIAOJING_DESKTOP_IPC.applicationInfo) as Promise<{ version: string }>,
    getCompanionState: () => ipcRenderer.invoke(XIAOJING_DESKTOP_IPC.companionState) as Promise<XiaojingDesktopState>,
    wakeCompanion: () => ipcRenderer.invoke(XIAOJING_DESKTOP_IPC.companionWake) as Promise<XiaojingDesktopState>,
    tuckCompanion: () => ipcRenderer.invoke(XIAOJING_DESKTOP_IPC.companionTuck) as Promise<XiaojingDesktopState>,
    resetCompanionPosition: () => ipcRenderer.invoke(XIAOJING_DESKTOP_IPC.companionReset) as Promise<XiaojingDesktopState>,
    setCompanionScale: (scale: number) => ipcRenderer.invoke(XIAOJING_DESKTOP_IPC.companionScale, scale) as Promise<XiaojingDesktopState>,
    showMainWindow: () => ipcRenderer.invoke(XIAOJING_DESKTOP_IPC.showMain) as Promise<void>,
    subscribeCompanionState(listener: (state: XiaojingDesktopState) => void) {
      const receive = (_event: Electron.IpcRendererEvent, state: XiaojingDesktopState): void => { listener(state) }
      ipcRenderer.on(XIAOJING_DESKTOP_IPC.companionChanged, receive)
      return () => { ipcRenderer.off(XIAOJING_DESKTOP_IPC.companionChanged, receive) }
    },
  })
}

/** Expose the Xiaojing workspace opener only in the application document. */
export function exposeXiaojingOpenPath(): void {
  contextBridge.exposeInMainWorld('__DSH_OPEN_IN_APP__', {
    openPath: (path: string) => ipcRenderer.invoke(XIAOJING_DESKTOP_IPC.openPath, path) as Promise<void>,
  })
}

function eventHasAttribute(event: Event, attribute: string): boolean {
  return event.composedPath().some(node => node instanceof Element && node.hasAttribute(attribute))
}

/** Install pointer forwarding required by the transparent companion window. */
export function installXiaojingCompanionPointerBridge(): void {
  let interactive = false
  let dragging = false
  window.addEventListener('pointermove', (event) => {
    if (dragging) {
      ipcRenderer.send(XIAOJING_DESKTOP_IPC.companionDragMove, { x: event.screenX, y: event.screenY })
      return
    }
    const next = eventHasAttribute(event, 'data-companion-interactive')
    if (next !== interactive) {
      interactive = next
      ipcRenderer.send(XIAOJING_DESKTOP_IPC.companionPointer, next)
    }
  }, true)
  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !eventHasAttribute(event, 'data-companion-drag')) return
    dragging = true
    if (event.target instanceof Element) event.target.setPointerCapture(event.pointerId)
    ipcRenderer.send(XIAOJING_DESKTOP_IPC.companionDragStart, { x: event.screenX, y: event.screenY })
  }, true)
  window.addEventListener('pointerup', (event) => {
    if (!dragging) return
    dragging = false
    ipcRenderer.send(XIAOJING_DESKTOP_IPC.companionDragEnd)
    const next = eventHasAttribute(event, 'data-companion-interactive')
    if (next !== interactive) {
      interactive = next
      ipcRenderer.send(XIAOJING_DESKTOP_IPC.companionPointer, next)
    }
  }, true)
  window.addEventListener('pointercancel', () => {
    if (!dragging) return
    dragging = false
    interactive = false
    ipcRenderer.send(XIAOJING_DESKTOP_IPC.companionDragEnd)
    ipcRenderer.send(XIAOJING_DESKTOP_IPC.companionPointer, false)
  }, true)
  window.addEventListener('mouseleave', () => {
    if (!dragging && interactive) {
      interactive = false
      ipcRenderer.send(XIAOJING_DESKTOP_IPC.companionPointer, false)
    }
  }, true)
  window.addEventListener('contextmenu', (event) => {
    if (!eventHasAttribute(event, 'data-companion-interactive')) return
    event.preventDefault()
    ipcRenderer.send(XIAOJING_DESKTOP_IPC.companionContextMenu)
  }, true)
}
