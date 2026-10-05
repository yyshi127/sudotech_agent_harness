/** Trusted Windows Chrome installation discovery for native browser providers. @module */

import { access } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

const APP_PATHS_QUERY = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$paths = @()
foreach ($hive in @([Microsoft.Win32.Registry]::LocalMachine, [Microsoft.Win32.Registry]::CurrentUser)) {
  $key = $hive.OpenSubKey('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe')
  try {
    if ($null -ne $key) { $value = $key.GetValue(''); if ($value -is [string]) { $paths += $value } }
  } finally { if ($null -ne $key) { $key.Dispose() } }
}
ConvertTo-Json -Compress -InputObject @{ paths = @($paths) }
`

/**
 * Locate Chrome in standard installations or read-only Windows App Paths.
 * Only existing absolute chrome.exe paths from trusted installation records are returned.
 * @param signal - browser acquisition cancellation, including its deadline.
 * @param platform - host operating system.
 * @param run - shell-free native command runner.
 * @returns an installed Chrome executable, or undefined outside Windows or when absent.
 */
export async function findWindowsChromeExecutable(
  signal: AbortSignal,
  platform: NodeJS.Platform = process.platform,
  run: NativeCommandRunner = runNativeCommand,
): Promise<string | undefined> {
  if (platform !== 'win32') return undefined
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter((root): root is string => root !== undefined && win32.isAbsolute(root))
  for (const root of roots) {
    signal.throwIfAborted()
    const candidate = join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')
    try {
      await access(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  signal.throwIfAborted()
  let result: unknown
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', APP_PATHS_QUERY], signal, 'hidden')
    result = JSON.parse(stdout)
  } catch (_error) {
    signal.throwIfAborted()
    throw new Error('Could not discover the Windows Chrome installation')
  }
  if (typeof result !== 'object' || result === null || !('paths' in result) || !Array.isArray(result.paths)
    || !result.paths.every((path): path is string => typeof path === 'string')) {
    throw new Error('Invalid Windows Chrome installation response')
  }
  for (const candidate of result.paths) {
    signal.throwIfAborted()
    if (!win32.isAbsolute(candidate) || win32.basename(candidate).toLowerCase() !== 'chrome.exe') continue
    try {
      await access(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return undefined
}
