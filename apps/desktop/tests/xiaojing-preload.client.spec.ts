// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'

const source = readFileSync('apps/desktop/preload.cjs', 'utf8')

function runPreload(platform = 'win32', argv: string[] = []): {
  readonly exposeInMainWorld: ReturnType<typeof vi.fn<(name: string, api: unknown) => void>>
  readonly invoke: ReturnType<typeof vi.fn<(channel: string, initialPath?: string) => Promise<unknown>>>
} {
  const exposeInMainWorld = vi.fn<(name: string, api: unknown) => void>()
  const invoke = vi.fn<(channel: string, initialPath?: string) => Promise<unknown>>().mockResolvedValue(null)
  new Script(source).runInNewContext({
    require: () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke } }),
    process: { platform, argv },
    document,
    window,
  })
  return { exposeInMainWorld, invoke }
}

afterEach(() => {
  document.documentElement.removeAttribute('data-windows-titlebar')
  document.documentElement.style.removeProperty('--dsh-windows-titlebar-height')
  vi.restoreAllMocks()
})

it('reserves the native caption before the main application renders', () => {
  runPreload()
  expect(document.documentElement.hasAttribute('data-windows-titlebar')).toBe(true)
  expect(document.documentElement.style.getPropertyValue('--dsh-windows-titlebar-height')).toBe('40px')
})

it('marks a document whose root is not available at preload time', () => {
  const root = document.documentElement
  const getter = vi.spyOn(document, 'documentElement', 'get').mockReturnValueOnce(null as unknown as HTMLElement)
  runPreload()
  getter.mockRestore()
  window.dispatchEvent(new Event('DOMContentLoaded'))
  expect(root.hasAttribute('data-windows-titlebar')).toBe(true)
  expect(root.style.getPropertyValue('--dsh-windows-titlebar-height')).toBe('40px')
})

it.each(['darwin', 'linux'])('does not reserve a Windows caption on %s', (platform) => {
  runPreload(platform)
  window.dispatchEvent(new Event('DOMContentLoaded'))
  expect(document.documentElement.hasAttribute('data-windows-titlebar')).toBe(false)
})

it('keeps the transparent companion free of main-window caption geometry', () => {
  const { exposeInMainWorld } = runPreload('win32', ['--xiaojing-companion'])
  window.dispatchEvent(new Event('DOMContentLoaded'))
  expect(document.documentElement.hasAttribute('data-windows-titlebar')).toBe(false)
  expect(exposeInMainWorld).not.toHaveBeenCalledWith('__DSH_DIRECTORY_PICKER__', expect.anything())
  expect(exposeInMainWorld).not.toHaveBeenCalledWith('__DSH_OPEN_IN_APP__', expect.anything())
})

it('forwards local-directory opens from the main application renderer', async () => {
  const { exposeInMainWorld, invoke } = runPreload()
  const exposure = exposeInMainWorld.mock.calls.find(([name]) => name === '__DSH_OPEN_IN_APP__')
  expect(exposure).toBeDefined()
  const opener = exposure?.[1] as { openPath(path: string): Promise<void> }
  await opener.openPath('C:\\Users\\Administrator\\Documents\\小兢会计工作区\\办公工作区')
  expect(invoke).toHaveBeenCalledExactlyOnceWith(
    'dsh-desktop:open-path',
    'C:\\Users\\Administrator\\Documents\\小兢会计工作区\\办公工作区',
  )
})

it('forwards the optional initial directory from the main application renderer', async () => {
  const { exposeInMainWorld, invoke } = runPreload()
  const exposure = exposeInMainWorld.mock.calls.find(([name]) => name === '__DSH_DIRECTORY_PICKER__')
  expect(exposure).toBeDefined()
  const picker = exposure?.[1] as { pick(initialPath?: string): Promise<string | null> }
  await picker.pick('C:\\Users\\Administrator\\Documents\\小兢会计工作区\\Finance工作区')
  expect(invoke).toHaveBeenCalledExactlyOnceWith(
    'dsh-desktop:directory-pick',
    'C:\\Users\\Administrator\\Documents\\小兢会计工作区\\Finance工作区',
  )
})
