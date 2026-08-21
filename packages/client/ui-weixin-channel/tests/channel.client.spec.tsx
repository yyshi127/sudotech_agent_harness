// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { WeixinChannelController } from '../src/client/controller.ts'
import { WeixinChannelSection } from '../src/client/WeixinChannelSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof zh): string => zh[key]
const unusedHook = (() => { throw new Error('unused by the channel section') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

function rpc(result: unknown): { caller: ClientConnectionRpc; call: ReturnType<typeof vi.fn> } {
  const call = vi.fn().mockResolvedValue({ ok: true, value: result })
  return { caller: { call }, call }
}

function props(controller: WeixinChannelController) {
  return {
    ...kit,
    close: () => {},
    useChannel: bindSnapshotSelector(controller.store),
    actions: controller,
    t,
  }
}

describe('Weixin channel settings', () => {
  it('shows the default-expanded disconnected card and starts QR pairing', async () => {
    const { caller, call } = rpc({ state: 'pairing', online: false, verificationRequired: false, qrCodeDataUrl: 'data:image/png;base64,AA', qrExpiresAt: Date.now() + 60_000 })
    const controller = new WeixinChannelController(caller)
    controller.store.set({
      status: 'ready', busy: false, error: null,
      snapshot: { state: 'disconnected', online: false, verificationRequired: false },
    })
    render(<WeixinChannelSection {...props(controller)} />)
    expect(screen.getByRole('heading', { name: '频道' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '扫码连接微信' })) })
    expect(call).toHaveBeenCalledWith('/xiaojing-weixin', 'pairing/start', {})
    expect(screen.getByText('等待扫码')).toBeTruthy()
    expect(screen.getByAltText('使用手机微信扫码').getAttribute('src')).toBe('data:image/png;base64,AA')
  })

  it('renders masked connected state and both lifecycle actions', async () => {
    const { caller, call } = rpc({ state: 'disconnected', online: false, verificationRequired: false })
    const controller = new WeixinChannelController(caller)
    controller.store.set({
      status: 'ready', busy: false, error: null,
      snapshot: { state: 'connected', online: true, verificationRequired: false, accountLabel: '2f8b***41@im.bot' },
    })
    render(<WeixinChannelSection {...props(controller)} />)
    expect(screen.getByText('2f8b***41@im.bot')).toBeTruthy()
    expect(screen.getByText(zh.safety)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '断开连接' })) })
    expect(call).toHaveBeenCalledWith('/xiaojing-weixin', 'disconnect', {})
  })

  it('submits a numeric phone verification code', async () => {
    const { caller, call } = rpc({ state: 'verification-required', online: false, verificationRequired: true })
    const controller = new WeixinChannelController(caller)
    controller.store.set({
      status: 'ready', busy: false, error: null,
      snapshot: {
        state: 'verification-required', online: false, verificationRequired: true,
        qrCodeDataUrl: 'data:image/png;base64,AA', qrExpiresAt: Date.now() + 60_000,
      },
    })
    render(<WeixinChannelSection {...props(controller)} />)
    fireEvent.change(screen.getByPlaceholderText('输入数字验证码'), { target: { value: '12a3456' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '提交验证码' })) })
    expect(call).toHaveBeenCalledWith('/xiaojing-weixin', 'pairing/verify', { code: '123456' })
  })

  it('rejects a malformed Host status at the wire boundary', async () => {
    const controller = new WeixinChannelController(rpc({ state: 'connected', online: 'yes' }).caller)
    await act(async () => { await controller.load() })
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: '微信频道返回了无效状态。' })
  })

  it('accepts only PNG data URLs for pairing QR images', async () => {
    const controller = new WeixinChannelController(rpc({
      state: 'pairing', online: false, verificationRequired: false,
      qrCodeDataUrl: 'data:image/svg+xml,<svg onload="alert(1)"/>',
    }).caller)
    await act(async () => { await controller.load() })
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: '微信频道返回了无效状态。' })
  })
})
