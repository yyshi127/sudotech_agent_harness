// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { RunningStatus } from '../src/client/chat/RunningStatus.tsx'
import { zh } from '../src/client/locale.ts'

const t = makeTranslate(zh, commonZh)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(5_000) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function statusHarness(startTime?: number) {
  const view = render(<RunningStatus startTime={startTime} t={t} />)
  return {
    ...view,
    content: () => view.container.querySelector('[data-chat-running] > :last-child'),
    set: (nextStartTime?: number) => { view.rerender(<RunningStatus startTime={nextStartTime} t={t} />) },
  }
}

describe('RunningStatus', () => {
  it('shows three decorative thinking dots in Xiaojing builds', () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
    const view = statusHarness()
    const dots = view.container.querySelector('[data-running-dots]')
    expect(dots?.getAttribute('aria-hidden')).toBe('true')
    expect(dots?.children).toHaveLength(3)
    expect(dots?.textContent).toBe('')
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('svg')).toBeNull()
    expect(view.getByRole('status').textContent).toBe('深度求索中')
  })

  it('retains the decorative whale in official builds', () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    vi.stubEnv('DSH_CLIENT_FAVICON', './other-product.png')
    const view = statusHarness()
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('[data-running-dots]')).toBeNull()
    expect(view.container.querySelector('svg')?.parentElement?.getAttribute('aria-hidden')).toBe('true')
  })

  it.each([
    ['zh', '小兢会计思考中', '秒'],
    ['en', 'Xiaojing Accounting is thinking', 's'],
  ] as const)('uses the product %s label for visible text and accessible status', async (language, label, unit) => {
    vi.stubEnv('DSH_CLIENT_RUNNING_LABEL_ZH', '小兢会计思考中')
    vi.stubEnv('DSH_CLIENT_RUNNING_LABEL_EN', 'Xiaojing Accounting is thinking')
    vi.resetModules()
    const dictionaries = await import('../src/client/locale.ts')
    const productT = makeTranslate(dictionaries[language], commonZh)
    const view = render(<RunningStatus startTime={undefined} t={productT} />)
    const content = () => view.container.querySelector('[data-chat-running] > :last-child')
    expect(content()?.textContent).toBe(label)
    expect(view.getByRole('status').textContent).toBe(label)
    view.rerender(<RunningStatus startTime={1_000} t={productT} />)
    expect(content()?.textContent).toBe(productT('chat.deepDivingFor', { duration: `4${unit}` }))
    expect(view.getByRole('status').textContent).toBe(label)
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content()?.textContent).toBe(productT('chat.deepDivingFor', { duration: `6${unit}` }))
    expect(view.getByRole('status').textContent).toBe(label)
  })

  it('waits for an open Turn start before allocating its clock', () => {
    const view = statusHarness()
    expect(view.content()?.textContent).toBe('深度求索中')
    expect(vi.getTimerCount()).toBe(0)
    view.set(1_000)
    expect(view.content()?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.content()?.querySelectorAll('[data-shimmer="true"]')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    view.set()
    expect(view.content()?.textContent).toBe('深度求索中')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the indicator mounted while a continuous run moves to the next Turn', () => {
    const view = statusHarness(1_000)
    const content = view.content()
    const status = view.getByRole('status')
    const initialText = content?.textContent
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(content?.textContent).not.toBe(initialText)
    view.set(7_000)
    expect(view.content()).toBe(content)
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(vi.getTimerCount()).toBe(1)
    const nextTurnText = content?.textContent
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(content?.textContent).not.toBe(nextTurnText)
    expect(view.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('深度求索中')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the duration nonnegative when the start is ahead of the local clock', () => {
    const view = statusHarness(6_000)
    expect(view.content()?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.content()?.textContent).not.toContain('-')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(view.content()?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.content()?.textContent).not.toContain('-')
  })

})
