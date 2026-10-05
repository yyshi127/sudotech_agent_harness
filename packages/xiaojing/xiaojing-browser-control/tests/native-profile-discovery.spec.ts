import { expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { discoverNativeBrowserProfile } from '../src/native-profile-discovery.ts'

const signal = new AbortController().signal
const localAppData = 'C:\\Users\\Fixture\\AppData\\Local'
function runner(userDataDir: string | null = null, remoteDebuggingAllowed: boolean | null = null) {
  return vi.fn<NativeCommandRunner>().mockResolvedValue({
    stdout: JSON.stringify({ status: 'ok', userDataDir, remoteDebuggingAllowed }), stderr: '',
  })
}

it.each(['edge', 'chrome'] as const)('discovers the stable %s directory from LocalAppData without scanning browser files', async (browser) => {
  const run = runner()
  expect(await discoverNativeBrowserProfile(browser, signal, undefined, 'win32', run, localAppData)).toEqual({
    userDataDir: `${localAppData}\\${browser === 'edge' ? 'Microsoft\\Edge' : 'Google\\Chrome'}\\User Data`, source: 'default',
  })
  const [command, args, receivedSignal, window] = run.mock.calls[0] ?? []
  expect(command).toBe('powershell.exe')
  expect(args?.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
  expect(args?.[3]).toContain(`OpenSubKey('SOFTWARE\\Policies\\${browser === 'edge' ? 'Microsoft\\Edge' : 'Google\\Chrome'}')`)
  expect(args?.[3]).toContain('RegistryView]::Registry64')
  expect(args?.[3]).toContain('RegistryView]::Registry32')
  expect(args?.[3]).not.toMatch(/(?:SetValue|CreateSubKey|Preferences|Cookie|Get-ChildItem)/u)
  expect(receivedSignal).toBe(signal)
  expect(window).toBe('hidden')
})

it('uses an absolute deployment override ahead of Windows policy but still checks debugging permission', async () => {
  const run = runner('D:\\PolicyChrome')
  expect(await discoverNativeBrowserProfile('chrome', signal, 'E:\\ExplicitChrome', 'win32', run, localAppData))
    .toEqual({ userDataDir: 'E:\\ExplicitChrome', source: 'configured' })
  expect(run).toHaveBeenCalledOnce()
})

it('uses an absolute Windows policy directory ahead of the stable default', async () => {
  expect(await discoverNativeBrowserProfile('chrome', signal, undefined, 'win32', runner('D:\\中文用户资料'), localAppData))
    .toEqual({ userDataDir: 'D:\\中文用户资料', source: 'policy' })
})

it.each(['edge', 'chrome'] as const)('refuses disabled %s debugging even with a deployment override', async (browser) => {
  await expect(discoverNativeBrowserProfile(browser, signal, 'E:\\ExplicitProfile', 'win32', runner(null, false), localAppData))
    .rejects.toThrow('RemoteDebuggingAllowed')
})

it.each(['{}', 'null', '{"status":"failed"}', '{"status":"ok","userDataDir":4,"remoteDebuggingAllowed":null}',
  '{"status":"ok","userDataDir":null,"remoteDebuggingAllowed":0}', 'Private profile: D:\\Secret'])
('rejects malformed profile policy metadata %s', async (stdout) => {
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({ stdout, stderr: '' })
  await expect(discoverNativeBrowserProfile('chrome', signal, undefined, 'win32', run, localAppData)).rejects.toThrow('profile policy')
})

it('fails on registry access errors without exposing private output or assuming policy is absent', async () => {
  const run = vi.fn<NativeCommandRunner>().mockRejectedValue(new Error('D:\\PrivateProfile access denied'))
  await expect(discoverNativeBrowserProfile('edge', signal, undefined, 'win32', run, localAppData))
    .rejects.toThrow('Could not read edge browser profile policy')
})

it.each(['relative/profile', '%LOCALAPPDATA%\\Custom', '${local_app_data}\\Custom'])('refuses unresolved policy directories %j', async (directory) => {
  await expect(discoverNativeBrowserProfile('chrome', signal, undefined, 'win32', runner(directory), localAppData))
    .rejects.toThrow('absolute directory path')
})

it('refuses relative deployment directories before querying metadata', async () => {
  const run = runner()
  await expect(discoverNativeBrowserProfile('edge', signal, 'relative/profile', 'win32', run, localAppData)).rejects.toThrow('absolute directory path')
  expect(run).not.toHaveBeenCalled()
})

it('requires a known LocalAppData directory when no profile is configured', async () => {
  await expect(discoverNativeBrowserProfile('edge', signal, undefined, 'win32', runner(), 'relative')).rejects.toThrow('absolute directory path')
})

it('propagates cancellation before querying the registry', async () => {
  const run = runner()
  await expect(discoverNativeBrowserProfile('chrome', AbortSignal.abort(new Error('Canceled profile discovery')), undefined, 'win32', run, localAppData))
    .rejects.toThrow('Canceled profile discovery')
  expect(run).not.toHaveBeenCalled()
})

it('accepts an explicit profile on other platforms without inventing a stable directory or reading Windows metadata', async () => {
  const run = runner()
  expect(await discoverNativeBrowserProfile('chrome', signal, '/fixture/profile', 'linux', run, localAppData))
    .toEqual({ userDataDir: '/fixture/profile', source: 'configured' })
  await expect(discoverNativeBrowserProfile('edge', signal, undefined, 'linux', run, localAppData)).rejects.toThrow('requires Windows')
  expect(run).not.toHaveBeenCalled()
})
