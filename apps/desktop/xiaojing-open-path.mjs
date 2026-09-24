import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** Local-directory channel consumed by the bundled Web client. */
export const XIAOJING_OPEN_PATH_CHANNEL = 'dsh-desktop:open-path'

/**
 * Register the application-window directory opener used by the header action.
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   shell: Pick<typeof import('electron').shell, 'openPath'>,
 *   getWindow: () => import('electron').BrowserWindow | undefined,
 * }} dependencies Desktop-owned Electron services.
 */
export function registerXiaojingOpenPath({ ipcMain, shell, getWindow }) {
  ipcMain.handle(XIAOJING_OPEN_PATH_CHANNEL, async (event, path) => {
    const window = getWindow()
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('xiaojing desktop: rejected path open from an unowned renderer')
    }
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw new Error('xiaojing desktop: opened path must be absolute')
    }
    let directory = false
    try {
      directory = (await stat(path)).isDirectory()
    } catch {
      // A missing or unreadable path is not eligible for a desktop handoff.
    }
    if (!directory) throw new Error('xiaojing desktop: opened path must be an existing directory')
    const failure = await shell.openPath(path)
    if (failure !== '') throw new Error(`xiaojing desktop: failed to open directory: ${failure}`)
  })
}
