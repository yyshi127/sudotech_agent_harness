import { describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { hasForcedChromeUserDataDir, queryForcedChromeUserDataDir } from '../src/chrome-policy.ts'

function missingValue(): Error & { code: number } {
  return Object.assign(new Error('registry value was not found'), { code: 1 })
}

describe('Chrome Windows policy preflight', () => {
  it('skips registry probing outside Windows', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const run = vi.fn<NativeCommandRunner>()

    await expect(hasForcedChromeUserDataDir(new AbortController().signal, run)).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
    platform.mockRestore()
  })

  it('uses the native runner by default on Windows', async () => {
    await expect(hasForcedChromeUserDataDir(new AbortController().signal)).resolves.toEqual(expect.any(Boolean))
  })

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

  it('accepts the string form of the missing-value exit code', async () => {
    const run = vi.fn<NativeCommandRunner>().mockRejectedValue(Object.assign(new Error('missing'), { code: '1' }))

    await expect(queryForcedChromeUserDataDir(new AbortController().signal, run)).resolves.toBe(false)
  })

  it('does not mistake primitive failures for a missing registry value', async () => {
    const run = vi.fn<NativeCommandRunner>().mockRejectedValue('reg.exe failed')

    await expect(queryForcedChromeUserDataDir(new AbortController().signal, run)).rejects.toBe('reg.exe failed')
  })

  it.each([
    [new Error('cancelled'), 'cancelled'],
    ['cancelled without Error', 'registry failed'],
  ])('propagates an aborted query without checking the second hive', async (reason, expected) => {
    const controller = new AbortController()
    controller.abort(reason)
    const run = vi.fn<NativeCommandRunner>().mockRejectedValue(new Error('registry failed'))

    await expect(queryForcedChromeUserDataDir(controller.signal, run)).rejects.toThrow(expected)
    expect(run).toHaveBeenCalledOnce()
  })
})
