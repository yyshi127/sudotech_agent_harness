// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { BrowserControlController } from '../src/client/controller.ts'
import { BrowserControlSection } from '../src/client/BrowserControlSection.tsx'
import { zh } from '../src/client/locales.ts'

const originalProfile = process.env.DSH_CLIENT_BUILD_PROFILE

afterEach(async () => {
  cleanup()
  if (originalProfile === undefined) delete process.env.DSH_CLIENT_BUILD_PROFILE
  else process.env.DSH_CLIENT_BUILD_PROFILE = originalProfile
})

const unusedHook = (() => { throw new Error('unused by browser-control settings') }) as never
const kit = {
  useSessions: unusedHook, useWorkspaces: unusedHook, usePanelInfo: unusedHook,
  useSessionStatus: unusedHook, useSessionRetainInfo: unusedHook, useResource: unusedHook,
}
const t = (key: keyof typeof zh): string => zh[key]
const DISCONNECTED = {
  managed: { enabled: true as const, running: false },
  personal: {
    state: 'not-connected' as const,
    extensionId: 'gdaibiaipdgjnkgepfbdllgaejabmfee',
    connected: false,
    paired: false,
  },
}

function rpc(result: unknown): { caller: ClientConnectionRpc; call: ReturnType<typeof vi.fn> } {
  const call = vi.fn().mockResolvedValue({ ok: true, value: result })
  return { caller: { call }, call }
}

function props(controller: BrowserControlController) {
  return {
    ...kit,
    close: () => {},
    useBrowserControl: bindSnapshotSelector(controller.store),
    actions: controller,
    t,
  }
}

describe('browser-control settings page', () => {
  it('shows the always-ready managed route and optional personal Edge setup', () => {
    const controller = new BrowserControlController(rpc(DISCONNECTED).caller)
    controller.store.set({ status: 'ready', snapshot: DISCONNECTED, busy: false, error: null })
    render(<BrowserControlSection {...props(controller)} />)

    expect(screen.getByRole('heading', { name: '浏览器控制' })).toBeTruthy()
    expect(screen.getByText('小兢专用 Edge')).toBeTruthy()
    expect(screen.getByText('个人 Edge（可选）')).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开 Edge 扩展管理' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开扩展文件夹' })).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('creates a short-lived pairing code and exposes no secret', async () => {
    const pairing = {
      ...DISCONNECTED,
      personal: {
        ...DISCONNECTED.personal,
        state: 'pairing' as const,
        pairingCode: 'ABCD2345',
        pairingExpiresAt: Date.now() + 60_000,
        secret: 'must-not-cross-the-client-boundary',
      },
    }
    const { caller, call } = rpc(pairing)
    const controller = new BrowserControlController(caller)
    controller.store.set({ status: 'ready', snapshot: DISCONNECTED, busy: false, error: null })
    render(<BrowserControlSection {...props(controller)} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '生成配对码' })) })
    expect(call).toHaveBeenCalledWith('/xiaojing-browser-control', 'pairing/start', {})
    expect(screen.getByText('ABCD2345')).toBeTruthy()
    expect(JSON.stringify(controller.store.getSnapshot())).not.toContain('secret')
    expect(JSON.stringify(controller.store.getSnapshot())).not.toContain('must-not-cross-the-client-boundary')
  })

  it('renders connected extension metadata and revokes authorization', async () => {
    const connected = {
      managed: { enabled: true as const, running: true },
      personal: {
        state: 'connected' as const,
        extensionId: 'gdaibiaipdgjnkgepfbdllgaejabmfee',
        connected: true,
        paired: true,
        version: '0.2.0',
      },
    }
    const { caller, call } = rpc(DISCONNECTED)
    const controller = new BrowserControlController(caller)
    controller.store.set({ status: 'ready', snapshot: connected, busy: false, error: null })
    render(<BrowserControlSection {...props(controller)} />)

    expect(screen.getByText('已连接')).toBeTruthy()
    expect(screen.getByText('0.2.0')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '撤销授权' })) })
    expect(call).toHaveBeenCalledWith('/xiaojing-browser-control', 'disconnect', {})
  })

  it('rejects a malformed Host status at the wire boundary', async () => {
    const controller = new BrowserControlController(rpc({ ...DISCONNECTED, managed: { enabled: 'yes' } }).caller)
    await act(async () => { await controller.load() })
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: '浏览器控制返回了无效状态。' })
  })

  it('registers one removable standalone section only for a loopback Xiaojing client', async () => {
    process.env.DSH_CLIENT_BUILD_PROFILE = 'xiaojing'
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    ctx.provide('connection', { isLoopback: true, rpc: rpc(DISCONNECTED).caller } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const section = slots.entries('settings.section')[0]
    expect(section?.options).toMatchObject({ id: 'browser-control', order: 30 })
    expect(resolveSlotLabel(section?.options.label)).toBe('浏览器控制')

    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('does not register outside the Xiaojing build profile', async () => {
    process.env.DSH_CLIENT_BUILD_PROFILE = 'official'
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
