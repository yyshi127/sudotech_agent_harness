import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

/** Local-directory channel consumed by the bundled Web client. */
export const XIAOJING_OPEN_PATH_CHANNEL: 'dsh-desktop:open-path'

/** Narrow Electron services owned by the Xiaojing desktop main process. */
export interface XiaojingOpenPathDependencies {
  readonly ipcMain: {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, path: unknown) => Promise<void>,
    ): void
  }
  readonly shell: {
    openPath(path: string): Promise<string>
  }
  readonly getWindow: () => BrowserWindow | undefined
}

/** Register the application-window directory opener used by the header action. */
export function registerXiaojingOpenPath(dependencies: XiaojingOpenPathDependencies): void
