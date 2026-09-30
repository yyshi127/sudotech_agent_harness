/** Existing-directory opener exposed to the Xiaojing application renderer. */

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { ipcMain, shell, type BrowserWindow } from 'electron'
import { assertDesktopSender, XIAOJING_DESKTOP_IPC } from './ipc.ts'

/**
 * Install the application-lifetime directory opener.
 * @param getWindow - Current Xiaojing application window.
 */
export function installXiaojingOpenPath(getWindow: () => BrowserWindow | undefined): void {
  ipcMain.handle(XIAOJING_DESKTOP_IPC.openPath, async (event, path: unknown) => {
    const window = getWindow()
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('xiaojing desktop: rejected path open from an unowned renderer')
    }
    assertDesktopSender(event, ['app'])
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw new Error('xiaojing desktop: opened path must be absolute')
    }
    let directory = false
    try { directory = (await stat(path)).isDirectory() }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!directory) throw new Error('xiaojing desktop: opened path must be an existing directory')
    const failure = await shell.openPath(path)
    if (failure !== '') throw new Error(`xiaojing desktop: failed to open directory: ${failure}`)
  })
}
