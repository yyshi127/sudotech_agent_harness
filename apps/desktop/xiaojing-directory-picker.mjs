import { isAbsolute } from 'node:path'

/** Directory picker channel consumed by the bundled Web client. */
export const XIAOJING_DIRECTORY_PICK_CHANNEL = 'dsh-desktop:directory-pick'

/**
 * Register the application-window directory picker used by Xiaojing workspace creation.
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   dialog: Pick<typeof import('electron').dialog, 'showOpenDialog'>,
 *   getWindow: () => import('electron').BrowserWindow | undefined,
 *   defaultPath?: string,
 * }} dependencies Desktop-owned Electron services.
 */
export function registerXiaojingDirectoryPicker({ ipcMain, dialog, getWindow, defaultPath }) {
  if (defaultPath !== undefined && !isAbsolute(defaultPath)) {
    throw new Error('xiaojing desktop: directory picker default path must be absolute')
  }
  const pending = new WeakMap()
  ipcMain.handle(XIAOJING_DIRECTORY_PICK_CHANNEL, async (event, initialPath) => {
    const window = getWindow()
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('xiaojing desktop: rejected directory picker from an unowned renderer')
    }
    if (initialPath !== undefined && (typeof initialPath !== 'string' || !isAbsolute(initialPath))) {
      throw new Error('xiaojing desktop: directory picker initial path must be absolute')
    }
    const existing = pending.get(window)
    if (existing !== undefined) return existing
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    const resolvedPath = initialPath ?? defaultPath
    const result = dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      ...(resolvedPath === undefined ? {} : { defaultPath: resolvedPath }),
    }).then(
      ({ canceled, filePaths }) => window.isDestroyed() || canceled ? null : filePaths[0] ?? null,
    ).finally(() => { pending.delete(window) })
    pending.set(window, result)
    return result
  })
}
