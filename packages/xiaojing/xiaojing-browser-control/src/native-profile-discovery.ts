/** Read-only browser profile directory discovery for native existing-browser connections. @module */

import { isAbsolute, win32 } from 'node:path'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

/** A directory selected from deployment configuration, Windows policy, or the stable browser default. */
export interface NativeBrowserProfile {
  /** Absolute user-data directory passed only to the native browser provider. */
  userDataDir: string
  /** Trusted metadata source used to select this directory. */
  source: 'configured' | 'policy' | 'default'
}

const POLICY_KEYS = {
  edge: 'SOFTWARE\\Policies\\Microsoft\\Edge',
  chrome: 'SOFTWARE\\Policies\\Google\\Chrome',
}

const PROFILE_POLICY_QUERY = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$userDataDir = $null
$remoteDebuggingAllowed = $null
foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    try {
      $key = $base.OpenSubKey('__POLICY_KEY__')
      try {
        if ($null -eq $key) { continue }
        $directory = $key.GetValue('UserDataDir', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $debugging = $key.GetValue('RemoteDebuggingAllowed', $null)
        if ($null -ne $directory -and $directory -isnot [string]) { throw 'Invalid browser directory policy type' }
        if ($null -ne $debugging -and ($debugging -isnot [int] -or $debugging -notin @(0, 1))) { throw 'Invalid remote debugging policy type' }
        if ($null -eq $userDataDir -and -not [string]::IsNullOrWhiteSpace($directory)) { $userDataDir = $directory }
        if ($null -eq $remoteDebuggingAllowed -and $null -ne $debugging) { $remoteDebuggingAllowed = $debugging -eq 1 }
      } finally { if ($null -ne $key) { $key.Dispose() } }
    } finally { $base.Dispose() }
  }
}
ConvertTo-Json -Compress -InputObject @{ status = 'ok'; userDataDir = $userDataDir; remoteDebuggingAllowed = $remoteDebuggingAllowed }
`

function absoluteDirectory(directory: string, platform: NodeJS.Platform): string {
  if (!(platform === 'win32' ? win32.isAbsolute(directory) : isAbsolute(directory)) || directory.includes('\0')) {
    throw new Error('The browser userDataDir must be an absolute directory path')
  }
  return directory
}

/**
 * Resolve an existing-browser directory without reading browser profile contents or changing policy.
 * Windows policy must permit remote debugging even when deployment configuration supplies the directory.
 * @param browser - explicitly selected stable Edge or Chrome brand.
 * @param signal - acquisition cancellation, including the caller's deadline.
 * @param configuredUserDataDir - optional deployment-owned absolute directory override.
 * @param platform - host operating system.
 * @param run - shell-free native command runner for read-only registry metadata.
 * @param localAppData - Windows LocalAppData directory used only when no explicit directory or policy exists.
 * @returns the selected absolute directory and its metadata source; browser connection is not attempted.
 */
export async function discoverNativeBrowserProfile(
  browser: 'edge' | 'chrome',
  signal: AbortSignal,
  configuredUserDataDir?: string,
  platform: NodeJS.Platform = process.platform,
  run: NativeCommandRunner = runNativeCommand,
  localAppData: string | undefined = process.env.LOCALAPPDATA,
): Promise<NativeBrowserProfile> {
  signal.throwIfAborted()
  if (configuredUserDataDir !== undefined) absoluteDirectory(configuredUserDataDir, platform)
  if (platform !== 'win32') {
    if (configuredUserDataDir !== undefined) return { userDataDir: configuredUserDataDir, source: 'configured' }
    throw new Error('Existing browser profile discovery requires Windows or an explicit userDataDir')
  }
  let policy: unknown
  try {
    const { stdout } = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', PROFILE_POLICY_QUERY.replace('__POLICY_KEY__', POLICY_KEYS[browser]),
    ], signal, 'hidden')
    policy = JSON.parse(stdout)
  } catch (_error) {
    signal.throwIfAborted()
    throw new Error(`Could not read ${browser} browser profile policy. No browser connection was started.`)
  }
  signal.throwIfAborted()
  if (typeof policy !== 'object' || policy === null || !('status' in policy) || policy.status !== 'ok'
    || !('userDataDir' in policy) || (policy.userDataDir !== null && typeof policy.userDataDir !== 'string')
    || !('remoteDebuggingAllowed' in policy) || (policy.remoteDebuggingAllowed !== null && typeof policy.remoteDebuggingAllowed !== 'boolean')) {
    throw new Error(`Invalid ${browser} browser profile policy response. No browser connection was started.`)
  }
  if (policy.remoteDebuggingAllowed === false) {
    throw new Error(`${browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} remote debugging is disabled by Windows policy (RemoteDebuggingAllowed).`)
  }
  if (configuredUserDataDir !== undefined) return { userDataDir: configuredUserDataDir, source: 'configured' }
  if (policy.userDataDir !== null) return { userDataDir: absoluteDirectory(policy.userDataDir, platform), source: 'policy' }
  if (localAppData === undefined) throw new Error('Windows LocalAppData is unavailable; configure an absolute browser userDataDir')
  const base = absoluteDirectory(localAppData, platform)
  return {
    userDataDir: browser === 'edge' ? win32.join(base, 'Microsoft', 'Edge', 'User Data') : win32.join(base, 'Google', 'Chrome', 'User Data'),
    source: 'default',
  }
}
