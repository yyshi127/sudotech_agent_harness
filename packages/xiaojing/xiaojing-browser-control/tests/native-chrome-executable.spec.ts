import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { findWindowsChromeExecutable } from '../src/native-chrome-executable.ts'

vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), access: vi.fn(),
}))

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })
const signal = new AbortController().signal
const missing = Object.assign(new Error('Fixture executable not found'), { code: 'ENOENT' })

it('does not inspect Windows installations on another operating system', async () => {
  const run = vi.fn<NativeCommandRunner>()
  expect(await findWindowsChromeExecutable(signal, 'linux', run)).toBeUndefined()
  expect(access).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
})

it('uses an installed standard executable without querying App Paths or browser profiles', async () => {
  vi.stubEnv('ProgramFiles', 'C:\\Programs')
  vi.stubEnv('ProgramFiles(x86)', '')
  vi.stubEnv('LOCALAPPDATA', '')
  vi.mocked(access).mockResolvedValue(undefined)
  const run = vi.fn<NativeCommandRunner>()
  expect(await findWindowsChromeExecutable(signal, 'win32', run)).toBe(join('C:\\Programs', 'Google', 'Chrome', 'Application', 'chrome.exe'))
  expect(run).not.toHaveBeenCalled()
})

it('queries fixed read-only App Paths and verifies custom executables exist', async () => {
  const executable = 'D:\\Applications\\Chrome\\chrome.exe'
  vi.mocked(access).mockImplementation(async (path) => { if (path !== executable) throw missing })
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({ stdout: JSON.stringify({ paths: [executable] }), stderr: '' })
  expect(await findWindowsChromeExecutable(signal, 'win32', run)).toBe(executable)
  const [command, args, passedSignal, window] = run.mock.calls[0] ?? []
  expect(command).toBe('powershell.exe')
  expect(args?.[3]).toContain("App Paths\\chrome.exe')")
  expect(args?.[3]).toContain('[Microsoft.Win32.Registry]::LocalMachine')
  expect(args?.[3]).toContain('[Microsoft.Win32.Registry]::CurrentUser')
  expect(args?.[3]).not.toMatch(/(?:SetValue|CreateSubKey)/u)
  expect(passedSignal).toBe(signal)
  expect(window).toBe('hidden')
})

it('skips relative, non-Chrome, and missing App Paths records', async () => {
  vi.stubEnv('ProgramFiles', '')
  vi.stubEnv('ProgramFiles(x86)', '')
  vi.stubEnv('LOCALAPPDATA', '')
  vi.mocked(access).mockRejectedValue(missing)
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({
    stdout: JSON.stringify({ paths: ['chrome.exe', 'C:\\Other.exe', 'D:\\Missing\\chrome.exe'] }), stderr: '',
  })
  expect(await findWindowsChromeExecutable(signal, 'win32', run)).toBeUndefined()
  expect(access).toHaveBeenCalledExactlyOnceWith('D:\\Missing\\chrome.exe')
})

it.each(['{}', '{"paths":[42]}', '{"paths":"C:\\Chrome"}'])('rejects malformed installation reply %s', async (stdout) => {
  vi.mocked(access).mockRejectedValue(missing)
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({ stdout, stderr: '' })
  await expect(findWindowsChromeExecutable(signal, 'win32', run)).rejects.toThrow('Chrome installation')
})

it('does not hide permission errors for a standard installation', async () => {
  vi.stubEnv('ProgramFiles', 'C:\\Programs')
  vi.mocked(access).mockRejectedValue(Object.assign(new Error('Fixture denied'), { code: 'EACCES' }))
  const run = vi.fn<NativeCommandRunner>()
  await expect(findWindowsChromeExecutable(signal, 'win32', run)).rejects.toThrow('Fixture denied')
  expect(run).not.toHaveBeenCalled()
})
