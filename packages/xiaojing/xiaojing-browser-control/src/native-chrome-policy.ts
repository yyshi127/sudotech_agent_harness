/** Read-only managed Chrome profile checks for Windows deployments. @module */

import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

const PROFILE_POLICY_QUERY = `
$ErrorActionPreference = 'Stop'
foreach ($hive in @([Microsoft.Win32.Registry]::LocalMachine, [Microsoft.Win32.Registry]::CurrentUser)) {
  $key = $hive.OpenSubKey('SOFTWARE\\Policies\\Google\\Chrome')
  try {
    $value = if ($null -eq $key) { $null } else { $key.GetValue('UserDataDir', $null) }
    if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) {
      '{"status":"present"}'
      exit 0
    }
  } finally { if ($null -ne $key) { $key.Dispose() } }
}
'{"status":"absent"}'
`

/**
 * Refuse managed Chrome when Windows policy can override its isolated profile.
 * Registry queries never modify policy and never expose configured profile paths.
 * @param signal - browser acquisition cancellation.
 * @param platform - host operating system.
 * @param run - shell-free native command runner.
 * @returns when profile isolation is not overridden by a nonempty UserDataDir policy.
 */
export async function assertManagedChromeProfileIsolation(
  signal: AbortSignal,
  platform: NodeJS.Platform = process.platform,
  run: NativeCommandRunner = runNativeCommand,
): Promise<void> {
  if (platform !== 'win32') return
  signal.throwIfAborted()
  let result: unknown
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROFILE_POLICY_QUERY], signal, 'hidden')
    result = JSON.parse(stdout)
  } catch (_error) {
    signal.throwIfAborted()
    throw new Error('Could not verify Chrome profile isolation. Managed Chrome was not started; use the existing browser connection.')
  }
  if (typeof result !== 'object' || result === null || !('status' in result)
    || (result.status !== 'absent' && result.status !== 'present')) {
    throw new Error('Invalid Chrome profile policy response. Managed Chrome was not started; use the existing browser connection.')
  }
  if (result.status === 'present') {
    throw new Error('Chrome UserDataDir policy overrides isolated profiles. Managed Chrome was not started; use the existing browser connection.')
  }
}
