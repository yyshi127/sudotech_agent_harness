import { describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { queryForcedChromeUserDataDir } from '../src/chrome-policy.ts'

function missingValue(): Error & { code: number } {
  return Object.assign(new Error('registry value was not found'), { code: 1 })
}

describe('Chrome Windows policy preflight', () => {
  it('stops after finding a machine policy', async () => {
    const run = vi.fn<NativeCommandRunner>(() => Promise.resolve({ stdout: 'UserDataDir', stderr: '' }))

    await expect(queryForcedChromeUserDataDir(new AbortController().signal, run)).resolves.toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[1]).toEqual([
      'query', 'HKLM\\Software\\Policies\\Google\\Chrome', '/v', 'UserDataDir',
    ])
  })

  it('checks the user policy after an absent machine value', async () => {
    const run = vi.fn<NativeCommandRunner>()
      .mockRejectedValueOnce(missingValue())
      .mockResolvedValueOnce({ stdout: 'UserDataDir', stderr: '' })

    await expect(queryForcedChromeUserDataDir(new AbortController().signal, run)).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('allows an isolated profile when neither policy hive defines the value', async () => {
    const run = vi.fn<NativeCommandRunner>().mockRejectedValue(missingValue())

    await expect(queryForcedChromeUserDataDir(new AbortController().signal, run)).resolves.toBe(false)
  })

  it('does not hide an unexpected registry-command failure', async () => {
    const run = vi.fn<NativeCommandRunner>().mockRejectedValue(Object.assign(new Error('reg.exe unavailable'), {
      code: 'ENOENT',
    }))

    await expect(queryForcedChromeUserDataDir(new AbortController().signal, run)).rejects.toThrow('reg.exe unavailable')
  })
})
