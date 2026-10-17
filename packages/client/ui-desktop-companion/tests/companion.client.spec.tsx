// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { DesktopCompanionBridge, DesktopCompanionDesktopState } from '../src/client/bridge.ts'
import { DesktopCompanionController } from '../src/client/controller.ts'
import { DesktopCompanionSection } from '../src/client/DesktopCompanionSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'xiaojingDesktop', { configurable: true, value: undefined })
})

const t = (key: keyof typeof zh): string => zh[key]
const unusedHook = (() => { throw new Error('unused by the desktop companion section') }) as never
const kit = {
  ...allowAllAccess,
  useSessions: unusedHook, useWorkspaces: unusedHook, usePanelInfo: unusedHook,
  useSessionStatus: unusedHook, useSessionRetainInfo: unusedHook, useResource: unusedHook,
}

function state(visible = false, taskState: DesktopCompanionDesktopState['snapshot']['state'] = 'idle'): DesktopCompanionDesktopState {
  return {
    available: true,
    visible,
    scale: 0.5,
    snapshot: {
      state: taskState,
      activeTaskCount: taskState === 'idle' ? 0 : 2,
      approvalCount: taskState === 'approval' ? 1 : 0,
      weixinOnline: false,
      revision: 1,
    },
  }
}

function bridge(initial = state(false)) {
  let listener: ((value: DesktopCompanionDesktopState) => void) | undefined
  const getCompanionState = vi.fn(async (): Promise<DesktopCompanionDesktopState> => initial)
  const wakeCompanion = vi.fn(async (): Promise<DesktopCompanionDesktopState> => state(true))
  const tuckCompanion = vi.fn(async (): Promise<DesktopCompanionDesktopState> => state(false))
  const resetCompanionPosition = vi.fn(async (): Promise<DesktopCompanionDesktopState> => state(true))
  const setCompanionScale = vi.fn(async (scale: number): Promise<DesktopCompanionDesktopState> => ({
    ...state(true), scale,
  }))
  const api: DesktopCompanionBridge = {
    getApplicationInfo: vi.fn(async () => ({ version: '0.2.2' })),
    getCompanionState,
    wakeCompanion,
    tuckCompanion,
    resetCompanionPosition,
    setCompanionScale,
    showMainWindow: vi.fn(async (): Promise<void> => {}),
    subscribeCompanionState: vi.fn((next: (value: DesktopCompanionDesktopState) => void) => {
      listener = next
      return () => { listener = undefined }
    }),
  }
  return {
    api,
    getCompanionState,
    wakeCompanion,
    tuckCompanion,
    resetCompanionPosition,
    setCompanionScale,
    publish: (value: DesktopCompanionDesktopState) => { listener?.(value) },
  }
}

function props(controller: DesktopCompanionController) {
  return {
    ...kit,
    close: () => {},
    useCompanion: bindSnapshotSelector(controller.store),
    actions: controller,
    t,
  }
}

describe('desktop companion settings', () => {
  it('shows a desktop-only notice without controls in an ordinary browser', () => {
    const controller = new DesktopCompanionController()
    render(<DesktopCompanionSection {...props(controller)} />)
    expect(screen.getByText(zh.unavailable)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    controller.dispose()
  })

  it('wakes, tucks, resets, and resizes the desktop companion through the restricted bridge', async () => {
    const fixture = bridge()
    Object.defineProperty(window, 'xiaojingDesktop', { configurable: true, value: fixture.api })
    const controller = new DesktopCompanionController()
    render(<DesktopCompanionSection {...props(controller)} />)
    await act(async () => { await controller.load() })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.wake })) })
    expect(fixture.wakeCompanion).toHaveBeenCalledOnce()
    expect(screen.getByText(zh.awake)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.tuck })) })
    expect(fixture.tuckCompanion).toHaveBeenCalledOnce()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.reset })) })
    expect(fixture.resetCompanionPosition).toHaveBeenCalledOnce()
    await act(async () => {
      fireEvent.change(screen.getByRole('slider', { name: zh.size }), { target: { value: '75' } })
    })
    expect(fixture.setCompanionScale).toHaveBeenCalledWith(0.75)
    expect(screen.getByText('75%')).toBeTruthy()
    controller.dispose()
  })

  it('updates task status immediately from Electron subscription events', async () => {
    const fixture = bridge(state(true))
    Object.defineProperty(window, 'xiaojingDesktop', { configurable: true, value: fixture.api })
    const controller = new DesktopCompanionController()
    render(<DesktopCompanionSection {...props(controller)} />)
    await act(async () => { fixture.publish(state(true, 'approval')) })
    expect(screen.getByText(zh.approval)).toBeTruthy()
    expect(screen.getByText(`2 ${zh.taskCount}`)).toBeTruthy()
    controller.dispose()
  })

  it('rejects malformed desktop state at the preload boundary', async () => {
    const fixture = bridge()
    fixture.getCompanionState.mockResolvedValue({
      available: true, visible: true, scale: 0.5, snapshot: { ...state(true).snapshot, activeTaskCount: -1 },
    })
    Object.defineProperty(window, 'xiaojingDesktop', { configurable: true, value: fixture.api })
    const controller = new DesktopCompanionController()
    await controller.load()
    expect(controller.store.getSnapshot().error).toBe('桌面小兢返回了无效状态。')
    controller.dispose()
  })
})
