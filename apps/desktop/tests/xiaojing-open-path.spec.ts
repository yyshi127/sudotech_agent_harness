import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  XIAOJING_OPEN_PATH_CHANNEL,
  registerXiaojingOpenPath,
} from '../xiaojing-open-path.mjs'

interface OpenEvent {
  readonly sender: unknown
  readonly senderFrame: unknown
}

type OpenHandler = (event: OpenEvent, path: unknown) => Promise<void>
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-open-path-'))
  roots.push(root)
  return root
}

function createHarness() {
  let registeredHandler: OpenHandler | undefined
  const handle = vi.fn((_channel: string, handler: OpenHandler) => { registeredHandler = handler })
  const openPath = vi.fn<(path: string) => Promise<string>>().mockResolvedValue('')
  const webContents = { mainFrame: {} }
  const windowMock = { webContents, isDestroyed: vi.fn(() => false) }
  registerXiaojingOpenPath({
    ipcMain: { handle },
    shell: { openPath },
    getWindow: () => windowMock as unknown as BrowserWindow,
  })
  if (registeredHandler === undefined) throw new Error('path-open handler was not installed')
  return { handler: registeredHandler, openPath, webContents, window: windowMock }
}

describe('Xiaojing desktop path opener', () => {
  it('opens an existing absolute directory through Electron shell', async () => {
    const directory = await tempRoot()
    const { handler, openPath, webContents } = createHarness()
    await expect(handler({ sender: webContents, senderFrame: webContents.mainFrame }, directory))
      .resolves.toBeUndefined()
    expect(openPath).toHaveBeenCalledExactlyOnceWith(directory)
  })

  it('rejects files, missing paths, relative paths, and unowned renderers', async () => {
    const directory = await tempRoot()
    const file = join(directory, 'file.txt')
    await writeFile(file, 'fixture')
    const { handler, openPath, webContents } = createHarness()
    const event = { sender: webContents, senderFrame: webContents.mainFrame }
    await expect(handler(event, file)).rejects.toThrow('existing directory')
    await expect(handler(event, join(directory, 'missing'))).rejects.toThrow('existing directory')
    await expect(handler(event, 'relative')).rejects.toThrow('must be absolute')
    await expect(handler({ sender: {}, senderFrame: webContents.mainFrame }, directory))
      .rejects.toThrow('unowned renderer')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('surfaces Electron shell failures and uses the dedicated channel', async () => {
    const directory = await tempRoot()
    const { handler, openPath, webContents } = createHarness()
    openPath.mockResolvedValue('no association')
    await expect(handler({ sender: webContents, senderFrame: webContents.mainFrame }, directory))
      .rejects.toThrow('no association')
    expect(XIAOJING_OPEN_PATH_CHANNEL).toBe('dsh-desktop:open-path')
  })
})
