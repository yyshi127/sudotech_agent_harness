/** Windows policy checks that must finish before launching Google Chrome. */

import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

const USER_DATA_POLICY_LOCATIONS = [
  'HKLM\\Software\\Policies\\Google\\Chrome',
  'HKCU\\Software\\Policies\\Google\\Chrome',
] as const

function isMissingRegistryValue(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = (error as { code?: unknown }).code
  return code === 1 || code === '1'
}

/**
 * Detect a mandatory Chrome `UserDataDir` policy that overrides Playwright's isolated profile.
 * @param signal - Browser-provider lifecycle cancellation.
 * @param run - No-shell native command runner; replaceable by focused tests.
 * @returns Whether Windows forces every Chrome process into one policy-owned profile.
 */
export async function hasForcedChromeUserDataDir(
  signal: AbortSignal,
  run: NativeCommandRunner = runNativeCommand,
): Promise<boolean> {
  if (process.platform !== 'win32') return false
  return await queryForcedChromeUserDataDir(signal, run)
}

/**
 * Query both Windows policy hives for Chrome's mandatory user-data directory.
 * @param signal - Browser-provider lifecycle cancellation.
 * @param run - No-shell native command runner.
 * @returns Whether either policy hive defines `UserDataDir`.
 */
export async function queryForcedChromeUserDataDir(
  signal: AbortSignal,
  run: NativeCommandRunner,
): Promise<boolean> {
  for (const location of USER_DATA_POLICY_LOCATIONS) {
    try {
      await run('reg.exe', ['query', location, '/v', 'UserDataDir'], signal)
      return true
    } catch (error) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : error
      if (!isMissingRegistryValue(error)) throw error
    }
  }
  return false
}
