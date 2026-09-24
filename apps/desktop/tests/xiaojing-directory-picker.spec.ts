import { resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  XIAOJING_DIRECTORY_PICK_CHANNEL,
  registerXiaojingDirectoryPicker,
} from '../xiaojing-directory-picker.mjs'

interface PickerEvent {
  readonly sender: unknown
  readonly senderFrame: unknown
}

type PickerHandler = (event: PickerEvent, initialPath: unknown) => Promise<string | null>

function createHarness(defaultPath?: string) {
  let registeredHandler: PickerHandler | undefined
  const handle = vi.fn((_channel: string, handler: PickerHandler) => { registeredHandler = handler })
  const showOpenDialog = vi.fn<(
    window: unknown,
    options: Electron.OpenDialogOptions,
  ) => Promise<Electron.OpenDialogReturnValue>>()
  const webContents = { mainFrame: {} }
  const windowMock = {
    webContents,
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
  const window = windowMock as unknown as BrowserWindow
  registerXiaojingDirectoryPicker({
    ipcMain: { handle },
    dialog: { showOpenDialog },
    getWindow: () => window,
    ...(defaultPath === undefined ? {} : { defaultPath }),
  })
  if (registeredHandler === undefined) throw new Error('directory picker handler was not installed')
  return { handler: registeredHandler, showOpenDialog, webContents, window: windowMock }
}

describe('Xiaojing desktop directory picker', () => {
  it('opens an ordinary Workspace pick at the configured Office directory', async () => {
    const officePath = resolve('小兢会计工作区', '办公工作区')
    const { handler, showOpenDialog, webContents, window } = createHarness(officePath)
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(handler({ sender: webContents, senderFrame: webContents.mainFrame }, undefined)).resolves.toBeNull()
    expect(showOpenDialog).toHaveBeenCalledExactlyOnceWith(window, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: officePath,
    })
  })

  it('opens at the requested absolute Finance directory', async () => {
    const officePath = resolve('小兢会计工作区', '办公工作区')
    const { handler, showOpenDialog, webContents, window } = createHarness(officePath)
    const initialPath = resolve('Finance工作区')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [resolve('客户甲')] })
    await expect(handler({ sender: webContents, senderFrame: webContents.mainFrame }, initialPath))
      .resolves.toBe(resolve('客户甲'))
    expect(showOpenDialog).toHaveBeenCalledExactlyOnceWith(window, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: initialPath,
    })
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('returns null on cancellation and rejects invalid callers and paths', async () => {
    const { handler, showOpenDialog, webContents } = createHarness()
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(handler({ sender: webContents, senderFrame: webContents.mainFrame }, undefined)).resolves.toBeNull()
    await expect(handler({ sender: {}, senderFrame: webContents.mainFrame }, resolve('Finance工作区')))
      .rejects.toThrow('unowned renderer')
    await expect(handler({ sender: webContents, senderFrame: webContents.mainFrame }, 'relative'))
      .rejects.toThrow('initial path must be absolute')
  })

  it('coalesces concurrent picker requests for the same application window', async () => {
    const { handler, showOpenDialog, webContents } = createHarness()
    let finish!: (value: { canceled: boolean; filePaths: string[] }) => void
    showOpenDialog.mockReturnValue(new Promise((resolvePromise) => { finish = resolvePromise }))
    const event = { sender: webContents, senderFrame: webContents.mainFrame }
    const first = handler(event, resolve('Finance工作区'))
    const second = handler(event, resolve('other'))
    expect(showOpenDialog).toHaveBeenCalledOnce()
    finish({ canceled: false, filePaths: [resolve('客户乙')] })
    await expect(Promise.all([first, second])).resolves.toEqual([resolve('客户乙'), resolve('客户乙')])
  })

  it('uses the shared client bridge channel', () => {
    expect(XIAOJING_DIRECTORY_PICK_CHANNEL).toBe('dsh-desktop:directory-pick')
  })

  it('rejects a relative configured default before registering IPC', () => {
    expect(() => { createHarness('relative') }).toThrow('default path must be absolute')
  })
})
