const { contextBridge, ipcRenderer } = require('electron')

const channels = {
  applicationInfo: 'xiaojing-desktop:application-info',
  state: 'xiaojing-desktop:companion-state',
  wake: 'xiaojing-desktop:wake-companion',
  tuck: 'xiaojing-desktop:tuck-companion',
  reset: 'xiaojing-desktop:reset-companion-position',
  scale: 'xiaojing-desktop:set-companion-scale',
  showMain: 'xiaojing-desktop:show-main-window',
  changed: 'xiaojing-desktop:companion-state-changed',
  pointer: 'xiaojing-desktop:companion-pointer',
  dragStart: 'xiaojing-desktop:companion-drag-start',
  dragMove: 'xiaojing-desktop:companion-drag-move',
  dragEnd: 'xiaojing-desktop:companion-drag-end',
  contextMenu: 'xiaojing-desktop:companion-context-menu',
}

contextBridge.exposeInMainWorld('xiaojingDesktop', {
  getApplicationInfo: () => ipcRenderer.invoke(channels.applicationInfo),
  getCompanionState: () => ipcRenderer.invoke(channels.state),
  wakeCompanion: () => ipcRenderer.invoke(channels.wake),
  tuckCompanion: () => ipcRenderer.invoke(channels.tuck),
  resetCompanionPosition: () => ipcRenderer.invoke(channels.reset),
  setCompanionScale: scale => ipcRenderer.invoke(channels.scale, scale),
  showMainWindow: () => ipcRenderer.invoke(channels.showMain),
  subscribeCompanionState: (listener) => {
    const receive = (_event, state) => { listener(state) }
    ipcRenderer.on(channels.changed, receive)
    return () => { ipcRenderer.removeListener(channels.changed, receive) }
  },
})

if (process.argv.includes('--xiaojing-companion')) {
  let interactive = false
  let dragging = false
  const isInteractive = event => event.composedPath().some(node => node instanceof Element
    && node.hasAttribute('data-companion-interactive'))
  const isDragHandle = event => event.composedPath().some(node => node instanceof Element
    && node.hasAttribute('data-companion-drag'))

  window.addEventListener('pointermove', event => {
    if (dragging) {
      ipcRenderer.send(channels.dragMove, { x: event.screenX, y: event.screenY })
      return
    }
    const next = isInteractive(event)
    if (next !== interactive) {
      interactive = next
      ipcRenderer.send(channels.pointer, next)
    }
  }, true)
  window.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !isDragHandle(event)) return
    dragging = true
    if (event.target instanceof Element) event.target.setPointerCapture(event.pointerId)
    ipcRenderer.send(channels.dragStart, { x: event.screenX, y: event.screenY })
  }, true)
  window.addEventListener('pointerup', event => {
    if (!dragging) return
    dragging = false
    ipcRenderer.send(channels.dragEnd)
    const next = isInteractive(event)
    if (next !== interactive) {
      interactive = next
      ipcRenderer.send(channels.pointer, next)
    }
  }, true)
  window.addEventListener('pointercancel', () => {
    if (!dragging) return
    dragging = false
    interactive = false
    ipcRenderer.send(channels.dragEnd)
    ipcRenderer.send(channels.pointer, false)
  }, true)
  window.addEventListener('mouseleave', () => {
    if (!dragging && interactive) {
      interactive = false
      ipcRenderer.send(channels.pointer, false)
    }
  }, true)
  window.addEventListener('contextmenu', event => {
    if (!isInteractive(event)) return
    event.preventDefault()
    ipcRenderer.send(channels.contextMenu)
  }, true)
}
