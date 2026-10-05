import { expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { assertManagedChromeProfileIsolation } from '../src/native-chrome-policy.ts'

const signal = new AbortController().signal

it.each(['linux', 'darwin'] as const)('does not query Windows policy on %s', async (platform) => {
  const run = vi.fn<NativeCommandRunner>()
  await assertManagedChromeProfileIsolation(signal, platform, run)
  expect(run).not.toHaveBeenCalled()
})

it('queries only fixed machine/user policy values through read-only .NET registry APIs', async () => {
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({ stdout: '{"status":"absent"}', stderr: '' })
  await assertManagedChromeProfileIsolation(signal, 'win32', run)
  const [command, args, passedSignal, window] = run.mock.calls[0] ?? []
  expect(command).toBe('powershell.exe')
  expect(args?.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
  expect(args?.[3]).toContain('[Microsoft.Win32.Registry]::LocalMachine')
  expect(args?.[3]).toContain('[Microsoft.Win32.Registry]::CurrentUser')
  expect(args?.[3]).toContain("OpenSubKey('SOFTWARE\\Policies\\Google\\Chrome')")
  expect(args?.[3]).toContain("GetValue('UserDataDir', $null)")
  expect(args?.[3]).not.toMatch(/(?:SetValue|CreateSubKey|Write-Host \$value)/u)
  expect(passedSignal).toBe(signal)
  expect(window).toBe('hidden')
})

it('refuses a present policy without receiving or exposing a configured profile path', async () => {
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({ stdout: '{"status":"present"}', stderr: '' })
  await expect(assertManagedChromeProfileIsolation(signal, 'win32', run)).rejects.toThrow('use the existing browser connection')
})

it.each(['{}', '{"status":"unknown"}', 'null', 'private path: C:\\Chrome'])('rejects malformed policy reply %s', async (stdout) => {
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({ stdout, stderr: '' })
  await expect(assertManagedChromeProfileIsolation(signal, 'win32', run)).rejects.toThrow('Managed Chrome was not started')
})

it('refuses registry access failures without treating exit 1 as a missing policy', async () => {
  const run = vi.fn<NativeCommandRunner>().mockRejectedValue(Object.assign(new Error('Private output'), { code: 1 }))
  await expect(assertManagedChromeProfileIsolation(signal, 'win32', run)).rejects.toThrow('Could not verify Chrome profile isolation')
  expect(run).toHaveBeenCalledOnce()
})

it('propagates cancellation before running a registry command', async () => {
  const aborted = AbortSignal.abort(new Error('Browser connection canceled'))
  const run = vi.fn<NativeCommandRunner>()
  await expect(assertManagedChromeProfileIsolation(aborted, 'win32', run)).rejects.toThrow('Browser connection canceled')
  expect(run).not.toHaveBeenCalled()
})
