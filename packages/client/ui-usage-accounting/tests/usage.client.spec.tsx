// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { UsageAccountingSnapshot } from '@deepseek-ai/dsh-usage-accounting/types'
import { UsageAccountingController } from '../src/client/controller.ts'
import { formatNanoyuan, formatTokens } from '../src/client/format.ts'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { UsageSidebar } from '../src/client/UsageSidebar.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh): string => zh[key]
const unusedHook = (() => { throw new Error('unused by usage-accounting components') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }
const snapshot: UsageAccountingSnapshot = {
  revision: 2,
  month: '2026-08',
  today: '2026-08-20',
  trackingSince: '2026-08-15',
  keyConfigured: true,
  days: [{
    date: '2026-08-20',
    cacheHitInputTokens: 1_000,
    cacheMissInputTokens: 2_000,
    outputTokens: 3_000,
    totalTokens: 6_000,
    cacheHitInputCostNanoyuan: '1000000',
    cacheMissInputCostNanoyuan: '23400000',
    outputCostNanoyuan: '99000000',
    costNanoyuan: '123400000',
    unpricedTokens: 8,
  }],
  total: {
    date: '2026-08',
    cacheHitInputTokens: 1_000,
    cacheMissInputTokens: 2_000,
    outputTokens: 3_000,
    totalTokens: 6_000,
    cacheHitInputCostNanoyuan: '1000000',
    cacheMissInputCostNanoyuan: '23400000',
    outputCostNanoyuan: '99000000',
    costNanoyuan: '123400000',
    unpricedTokens: 8,
  },
}

afterEach(cleanup)

function readyController(value = snapshot): UsageAccountingController {
  const controller = new UsageAccountingController({ snapshot: vi.fn() })
  controller.store.set({ status: 'ready', snapshot: value, error: null })
  return controller
}

function injected(controller: UsageAccountingController) {
  return {
    ...kit,
    refresh: () => { void controller.load() },
    useUsage: bindSnapshotSelector(controller.store),
    t,
  }
}

describe('usage presentation', () => {
  it('formats exact nanoyuan and compact token values', () => {
    expect(formatNanoyuan('0')).toBe('0.00')
    expect(formatNanoyuan('123400000')).toBe('0.12')
    expect(formatNanoyuan('125000000')).toBe('0.13')
    expect(formatNanoyuan('999999999')).toBe('1.00')
    expect(formatNanoyuan('1000000000')).toBe('1.00')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_200)).toBe('1.2K')
    expect(formatTokens(2_000_000)).toBe('2M')
  })

  it('shows today usage in the wide sidebar and keeps a compact accessible rail label', () => {
    const controller = readyController()
    const props = injected(controller)
    const view = render(<UsageSidebar wide {...props} />)
    expect(screen.getByRole('button', { name: '今日已使用 6K token · ¥0.12' })).toBeTruthy()
    expect(screen.getByText('6K').tagName).toBe('STRONG')
    expect(screen.getByText('¥0.12').tagName).toBe('STRONG')
    view.rerender(<UsageSidebar wide={false} {...props} />)
    expect(screen.getByRole('button', { name: '今日已使用 6K token · ¥0.12' }).getAttribute('aria-label'))
      .toBe('今日已使用 6K token · ¥0.12')
    expect(screen.queryByText('今日已使用 6K token · ¥0.12')).toBeNull()
  })

  it('opens an exact category cost popover and closes it with Escape', () => {
    const controller = readyController()
    render(<UsageSidebar wide {...injected(controller)} />)
    fireEvent.click(screen.getByRole('button', { name: '今日已使用 6K token · ¥0.12' }))

    const dialog = screen.getByRole('dialog', { name: '今日计费明细' })
    expect(within(dialog).getByText('缓存命中输入')).toBeTruthy()
    expect(within(dialog).getByText('缓存未命中输入')).toBeTruthy()
    expect(within(dialog).getByText('模型输出')).toBeTruthy()
    expect(within(dialog).getByText('¥0.00')).toBeTruthy()
    expect(within(dialog).getByText('¥0.02')).toBeTruthy()
    expect(within(dialog).getByText('¥0.10')).toBeTruthy()
    expect(within(dialog).getByText('8 token')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '今日计费明细' })).toBeNull()
  })

  it('renders the current month as a Monday-first calendar with tracked state', () => {
    const controller = readyController()
    render(<UsageSection close={() => {}} {...injected(controller)} />)
    expect(screen.getByText('本机用量')).toBeTruthy()
    const description = screen.getByText(zh.description)
    const monthTotal = screen.getByText('本月合计')
    expect(description.parentElement?.contains(monthTotal)).toBe(true)
    expect(screen.getByText('6K token · ¥0.12')).toBeTruthy()
    expect(screen.getAllByText('8 未计价')).toHaveLength(2)
    expect(screen.getAllByText('未统计')).toHaveLength(14)
    expect(screen.getByText('2026-08')).toBeTruthy()
  })
})

describe('UsageAccountingController', () => {
  it('keeps the newest response when requests resolve out of order', async () => {
    let resolveFirst!: (value: { ok: true; value: UsageAccountingSnapshot }) => void
    const first = new Promise<{ ok: true; value: UsageAccountingSnapshot }>((resolve) => { resolveFirst = resolve })
    const newer = { ...snapshot, revision: 3 }
    const remote = {
      snapshot: vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce({ ok: true, value: newer }),
    }
    const controller = new UsageAccountingController(remote)
    const olderLoad = controller.load()
    await controller.load()
    resolveFirst({ ok: true, value: snapshot })
    await olderLoad
    expect(controller.store.getSnapshot().snapshot?.revision).toBe(3)
  })

  it('surfaces Remote and transport failures', async () => {
    const remote = { snapshot: vi.fn().mockResolvedValue({ ok: false, error: { message: 'refused' } }) }
    const controller = new UsageAccountingController(remote)
    await act(async () => { await controller.load() })
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'refused' })
    remote.snapshot.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await controller.load() })
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'offline' })
  })
})
