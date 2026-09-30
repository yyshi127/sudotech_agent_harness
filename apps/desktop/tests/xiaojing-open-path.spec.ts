import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { XIAOJING_DESKTOP_IPC } from '../src/ipc.ts'

type OpenHandler = (event: IpcMainInvokeEvent, path: unknown) => Promise<void>

const electron = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, handler: OpenHandler) => void>(),
  openPath: vi.fn<(path: string) => Promise<string>>().mockResolvedValue(''),
}))
vi.mock('electron', () => ({ ipcMain: { handle: electron.handle }, shell: { openPath: electron.openPath } }))
const { installXiaojingOpenPath } = await import('../src/xiaojing-open-path.ts')

const roots: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  electron.openPath.mockResolvedValue('')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-open-path-'))
  roots.push(root)
  return root
}

function fixture() {
  const frame = { url: 'dsh-app://app/' }
  const webContents = { mainFrame: frame }
  const window = { webContents, isDestroyed: vi.fn(() => false) }
  installXiaojingOpenPath(() => window as unknown as BrowserWindow)
  expect(electron.handle.mock.calls.at(-1)?.[0]).toBe(XIAOJING_DESKTOP_IPC.openPath)
  const handler = electron.handle.mock.calls.at(-1)?.[1]
  if (handler === undefined) throw new Error('path-open handler was not installed')
  return {
    handler,
    event: { sender: webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent,
  }
}

describe('Xiaojing desktop path opener', () => {
  it('opens an existing absolute directory through Electron shell', async () => {
    const directory = await tempRoot()
    const { handler, event } = fixture()
    await expect(handler(event, directory)).resolves.toBeUndefined()
    expect(electron.openPath).toHaveBeenCalledExactlyOnceWith(directory)
  })

  it('rejects files, missing paths, relative paths, and unowned renderers', async () => {
    const directory = await tempRoot()
    const file = join(directory, 'file.txt')
    await writeFile(file, 'fixture')
    const { handler, event } = fixture()
    await expect(handler(event, file)).rejects.toThrow('existing directory')
    await expect(handler(event, join(directory, 'missing'))).rejects.toThrow('existing directory')
    await expect(handler(event, 'relative')).rejects.toThrow('must be absolute')
    await expect(handler({ ...event, sender: {} } as IpcMainInvokeEvent, directory)).rejects.toThrow('unowned renderer')
    expect(electron.openPath).not.toHaveBeenCalled()
  })

  it('surfaces Electron shell failures', async () => {
    const directory = await tempRoot()
    const { handler, event } = fixture()
    electron.openPath.mockResolvedValue('no association')
    await expect(handler(event, directory)).rejects.toThrow('no association')
  })
})
