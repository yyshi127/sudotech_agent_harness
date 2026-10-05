/** Console attachment precedes native handler registration without requiring a background console. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installWindowsCliSignals } from '../src/windows-cli-signals.ts'

const native = vi.hoisted(() => ({
  codePage: vi.fn(() => 437),
  attach: vi.fn(() => 1),
  lastError: vi.fn(() => 6),
  install: vi.fn(() => 1),
  register: vi.fn((callback: (event: number) => number) => callback),
  unregister: vi.fn(),
}))

vi.mock('koffi', () => ({ default: {
  load: () => ({ func: (signature: string) => {
    if (signature.includes('GetConsoleCP')) return native.codePage
    if (signature.includes('AttachConsole')) return native.attach
    if (signature.includes('GetLastError')) return native.lastError
    if (signature.includes('SetConsoleCtrlHandler')) return native.install
    throw new Error(`Unexpected Windows call: ${signature}`)
  } }),
  proto: () => 'handler',
  pointer: (type: string) => type,
  register: native.register,
  unregister: native.unregister,
} }))

describe('Windows CLI console setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.codePage.mockReturnValue(437)
    native.attach.mockReturnValue(1)
    native.lastError.mockReturnValue(6)
    native.install.mockReturnValue(1)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('retains an already attached console', async () => {
    await installWindowsCliSignals()
    expect(native.attach).not.toHaveBeenCalled()
    expect(native.install).toHaveBeenCalledOnce()
  })

  it('joins the parent console before registering its handler', async () => {
    native.codePage.mockReturnValue(0)
    await installWindowsCliSignals()
    expect(native.attach).toHaveBeenCalledWith(0xffffffff)
    expect(native.attach.mock.invocationCallOrder[0]).toBeLessThan(native.register.mock.invocationCallOrder[0]!)
  })

  it.each([6, 87])('keeps background commands usable when parent attachment returns %s', async (error) => {
    native.codePage.mockReturnValue(0)
    native.attach.mockReturnValue(0)
    native.lastError.mockReturnValue(error)
    await installWindowsCliSignals()
    expect(native.install).toHaveBeenCalledOnce()
  })

  it('reports an unexpected attachment failure before allocating a callback', async () => {
    native.codePage.mockReturnValue(0)
    native.attach.mockReturnValue(0)
    native.lastError.mockReturnValue(5)
    await expect(installWindowsCliSignals()).rejects.toThrow('cannot attach the parent console (5)')
    expect(native.register).not.toHaveBeenCalled()
  })

  it('unregisters its callback if native handler installation fails', async () => {
    native.install.mockReturnValue(0)
    await expect(installWindowsCliSignals()).rejects.toThrow('cannot register the Windows console handler')
    expect(native.unregister).toHaveBeenCalledWith(native.register.mock.results[0]?.value)
  })

  it('delegates known console events to CLI listeners and retains unknown handling', async () => {
    await installWindowsCliSignals()
    const callback = native.register.mock.calls[0]?.[0]
    if (callback === undefined) throw new Error('Console callback was not registered')
    const emitter: NodeJS.EventEmitter = process
    const emit = vi.spyOn(emitter, 'emit').mockReturnValue(true)
    expect(callback(0)).toBe(1)
    expect(emit).toHaveBeenLastCalledWith('SIGINT')
    expect(callback(1)).toBe(1)
    expect(emit).toHaveBeenLastCalledWith('SIGBREAK')
    emit.mockReturnValue(false)
    expect(callback(0)).toBe(0)
    expect(callback(1)).toBe(0)
    expect(callback(2)).toBe(0)
  })
})
