import { expect, it, vi } from 'vitest'
import { link, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { openNativeBrowserSettings } from '../src/native-settings-open.ts'

const signal = new AbortController().signal
const observed = (browser: 'chrome' | 'edge') => ({ browser, url: `${browser}://inspect/#remote-debugging`,
  documentTitle: `Inspect with ${browser === 'chrome' ? 'Chrome' : 'Edge'} Developer Tools`, opened: true })

it.skipIf(process.platform !== 'win32')('parses the shipped PowerShell helper and identifies executable hardlinks without matching another file', async ({ onTestFinished }) => {
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({ stdout: JSON.stringify(observed('chrome')), stderr: '' })
  await openNativeBrowserSettings('chrome', 'C:\\Chrome\\chrome.exe', 30_000, signal, 'win32', run)
  const helper = Buffer.from(run.mock.calls[0]![1][3]!, 'base64').toString('utf16le')
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-settings-executable-id-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const original = join(root, 'chrome.exe'), alias = join(root, 'hardlink.exe'), other = join(root, 'different.exe')
  await writeFile(original, 'owned installation identity fixture')
  await link(original, alias)
  await writeFile(other, 'another file must not inherit browser identity')
  const request = Buffer.from(JSON.stringify({ helper, paths: [original, alias, other] }), 'utf8').toString('base64')
  const script = `$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request}')) | ConvertFrom-Json
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$tokens = $null; $errors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($request.helper, [ref]$tokens, [ref]$errors)
$source = [regex]::Match($request.helper, "(?s)Add-Type -TypeDefinition @'\\r?\\n(.*?)\\r?\\n'@").Groups[1].Value
Add-Type -TypeDefinition $source
ConvertTo-Json -Compress -InputObject @{ parseErrors = $errors.Count;
  original = [BrowserSettingsWindow]::ExecutableId($request.paths[0]);
  alias = [BrowserSettingsWindow]::ExecutableId($request.paths[1]); other = [BrowserSettingsWindow]::ExecutableId($request.paths[2]) }
`
  const { stdout } = await runNativeCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], signal, 'hidden')
  const result: unknown = JSON.parse(stdout)
  if (typeof result !== 'object' || result === null || !('original' in result) || !('alias' in result) || !('other' in result)) {
    throw new Error('Native executable identity fixture returned invalid data')
  }
  expect(result).toHaveProperty('parseErrors', 0)
  expect(typeof result.original).toBe('string')
  expect(result.alias).toBe(result.original)
  expect(result.other).not.toBe(result.original)
})

it.each(['chrome', 'edge'] as const)('accepts only a verified %s inspect document and URL', async (browser) => {
  const path = browser === 'chrome' ? 'C:\\Applications\\Chrome\\chrome.exe' : 'C:\\Applications\\Edge\\msedge.exe'
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({
    stdout: JSON.stringify(observed(browser)), stderr: '',
  })
  await openNativeBrowserSettings(browser, path, 30_000, signal, 'win32', run)
  const [command, args, passedSignal, visibility] = run.mock.calls[0]!
  expect(command).toBe('powershell.exe')
  expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  expect(passedSignal).toBe(signal)
  expect(visibility).toBe('hidden')
})

it.each(['linux', 'darwin'] as const)('refuses settings navigation on %s without launching a process', async (platform) => {
  const run = vi.fn<NativeCommandRunner>()
  await expect(openNativeBrowserSettings('chrome', 'C:\\Chrome\\chrome.exe', 30_000, signal, platform, run)).rejects.toThrow('only on Windows')
  expect(run).not.toHaveBeenCalled()
})

it.each(['chrome.exe', 'relative\\chrome.exe', 'C:\\Other\\msedge.exe', 'C:\\Other\\cmd.exe'])(
  'refuses untrusted Chrome executable %s without dispatching navigation', async (path) => {
    const run = vi.fn<NativeCommandRunner>()
    await expect(openNativeBrowserSettings('chrome', path, 30_000, signal, 'win32', run)).rejects.toThrow('verify the browser installation')
    expect(run).not.toHaveBeenCalled()
  },
)

it('keeps executable data out of executable PowerShell text', async () => {
  const path = "C:\\Browser's files\\$()\\chrome.exe"
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({
    stdout: JSON.stringify(observed('chrome')), stderr: '',
  })
  await openNativeBrowserSettings('chrome', path, 30_000, signal, 'win32', run)
  const script = Buffer.from(run.mock.calls[0]![1][3]!, 'base64').toString('utf16le')
  expect(script).not.toContain(path)
  const request = /FromBase64String\('([A-Za-z\d+/=]+)'\)/u.exec(script)?.[1]
  expect(JSON.parse(Buffer.from(request!, 'base64').toString('utf8'))).toEqual({ browser: 'chrome', executablePath: path, timeoutMs: 30_000 })
})

it.each([
  { ...observed('chrome'), documentTitle: 'New tab' },
  { browser: 'edge', url: 'edge://inspect/#remote-debugging', opened: true },
  { browser: 'chrome', url: 'about:blank', opened: true },
  { browser: 'chrome', url: 'chrome://inspect/#remote-debugging', opened: false },
  { browser: 'chrome', url: 'chrome://inspect/#remote-debugging' },
  null,
])('does not acknowledge an unverified native navigation reply %#', async (reply) => {
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({ stdout: JSON.stringify(reply), stderr: '' })
  await expect(openNativeBrowserSettings('chrome', 'C:\\Chrome\\chrome.exe', 30_000, signal, 'win32', run)).rejects.toThrow('confirm the browser settings page')
})

it.each(['', 'not-json'])('does not acknowledge malformed native output %j', async (stdout) => {
  const run = vi.fn<NativeCommandRunner>().mockResolvedValue({ stdout, stderr: '' })
  await expect(openNativeBrowserSettings('chrome', 'C:\\Chrome\\chrome.exe', 30_000, signal, 'win32', run)).rejects.toThrow('confirm the browser settings page')
})

it('reports native focus/navigation failure without returning a false opened result', async () => {
  const failure = new Error('Native window focus was refused')
  const run = vi.fn<NativeCommandRunner>().mockRejectedValue(failure)
  const error: unknown = await openNativeBrowserSettings('chrome', 'C:\\Chrome\\chrome.exe', 30_000, signal, 'win32', run)
    .catch((error: unknown) => error)
  if (!(error instanceof Error)) throw new Error('Native navigation failure unexpectedly succeeded')
  expect(error.message).toContain('Windows desktop unlocked')
  expect(error.cause).toBe(failure)
})

it('refuses a pre-canceled settings action without opening a browser', async () => {
  const controller = new AbortController()
  controller.abort(new Error('Operator canceled'))
  const run = vi.fn<NativeCommandRunner>()
  await expect(openNativeBrowserSettings('edge', 'C:\\Edge\\msedge.exe', 30_000, controller.signal, 'win32', run)).rejects.toThrow('Operator canceled')
  expect(run).not.toHaveBeenCalled()
})

it('does not report successful opening when cancellation arrives before verification settles', async () => {
  const controller = new AbortController()
  const run = vi.fn<NativeCommandRunner>().mockImplementation(async () => {
    controller.abort(new Error('Settings disposed'))
    return { stdout: JSON.stringify(observed('edge')), stderr: '' }
  })
  await expect(openNativeBrowserSettings('edge', 'C:\\Edge\\msedge.exe', 30_000, controller.signal, 'win32', run)).rejects.toThrow('Settings disposed')
})
