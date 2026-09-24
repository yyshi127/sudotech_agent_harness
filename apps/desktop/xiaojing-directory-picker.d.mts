import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

/** Directory picker channel consumed by the bundled Web client. */
export const XIAOJING_DIRECTORY_PICK_CHANNEL: 'dsh-desktop:directory-pick'

/** Narrow Electron services owned by the Xiaojing desktop main process. */
export interface XiaojingDirectoryPickerDependencies {
  readonly ipcMain: {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, initialPath: unknown) => Promise<string | null>,
    ): void
  }
  readonly dialog: {
    showOpenDialog(
      window: BrowserWindow,
      options: Electron.OpenDialogOptions,
    ): Promise<Electron.OpenDialogReturnValue>
  }
  readonly getWindow: () => BrowserWindow | undefined
  readonly defaultPath?: string
}

/** Register the application-window directory picker used by Xiaojing workspace creation. */
export function registerXiaojingDirectoryPicker(
  dependencies: XiaojingDirectoryPickerDependencies,
): void
