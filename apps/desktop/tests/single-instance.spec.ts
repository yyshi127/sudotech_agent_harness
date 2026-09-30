import { describe, expect, it, vi } from 'vitest'
import { claimDesktopSingleInstance, type DesktopSingleInstanceApplication } from '../src/single-instance.ts'

describe('desktop single-instance ownership', () => {
  it('quits a second process without registering lifecycle work', () => {
    const quit = vi.fn()
    const on = vi.fn()
    const application = {
      requestSingleInstanceLock: () => false,
      quit,
      on,
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, vi.fn())).toBe(false)
    expect(quit).toHaveBeenCalledOnce()
    expect(on).not.toHaveBeenCalled()
  })

  it('routes a later launch to the primary process', () => {
    let secondInstance: ((event: unknown, argv: readonly string[]) => void) | undefined
    const focus = vi.fn()
    const application = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: (event: unknown, argv: readonly string[]) => void) => {
        secondInstance = listener
      }),
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, focus)).toBe(true)
    secondInstance?.({}, ['desktop.exe', '--xiaojing-shutdown-for-update'])
    expect(focus).toHaveBeenCalledExactlyOnceWith(['desktop.exe', '--xiaojing-shutdown-for-update'])
  })

  it('requests the lock before forwarding an update-shutdown launch', () => {
    const quit = vi.fn()
    const application = {
      requestSingleInstanceLock: vi.fn(() => false),
      quit,
      on: vi.fn(),
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, vi.fn())).toBe(false)
    expect(application.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })
})
