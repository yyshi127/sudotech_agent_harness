// @vitest-environment jsdom
/** Browser rendering, streaming, and slot registration behavior. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { HEIGHT_MESSAGE_TYPE, STREAM_MESSAGE_TYPE } from '../src/shell.ts'
import { StreamingPreview } from '../src/client/StreamingPreview.tsx'
import { VisualizeCard } from '../src/client/VisualizeCard.tsx'
import { apply, inject, name } from '../src/client/index.tsx'
import { resolveTheme } from '../src/client/theme.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function streamingProps(blocks: unknown) {
  return {
    session: { partial: blocks === undefined ? undefined : { blocks } },
  } as unknown as Parameters<typeof StreamingPreview>[0]
}

function cardProps(block: unknown, callId = 'call-1') {
  return { block, callId } as unknown as Parameters<typeof VisualizeCard>[0]
}

describe('visualize client registration and theme', () => {
  it('registers both UI occupants and keeps independent native theme copies', () => {
    const registrations: unknown[] = []
    const injectSlot = vi.fn((_name: string, callback: () => unknown) => callback())
    const register = vi.fn((slot: unknown, component: unknown) => {
      registrations.push([slot, component])
      return vi.fn()
    })
    const ctx = { slots: { inject: injectSlot, register } } as unknown as ClientContext

    expect(name).toBe('xiaojing-visualize')
    expect(inject).toEqual(['slots'])
    apply(ctx)
    expect(injectSlot).toHaveBeenCalledTimes(2)
    expect(registrations).toHaveLength(2)

    const first = resolveTheme()
    const second = resolveTheme()
    expect(first).toEqual({
      themeVars: {
        foreground: 'rgb(26 28 31)',
        card: 'rgb(0 0 0 / 4%)',
        'muted-foreground': 'rgb(26 28 31 / 55%)',
        border: 'rgb(0 0 0 / 10%)',
        primary: 'rgb(65 118 230)',
        'primary-foreground': 'rgb(255 255 255)',
      },
      colorScheme: 'light',
    })
    first.themeVars.primary = 'changed'
    expect(second.themeVars.primary).toBe('rgb(65 118 230)')
  })
})

describe('VisualizeCard', () => {
  it('renders running, failed, and foreign durable results safely', () => {
    const running = render(<VisualizeCard {...cardProps({})} />)
    expect(running.container.textContent).toContain('Visualize · rendering')
    running.unmount()

    const failed = render(<VisualizeCard {...cardProps({
      kind: 'tool-result',
      isError: true,
      content: [{ type: 'text', text: 'first line\nsecond line' }],
    })} />)
    expect(failed.container.textContent).toContain('Visualize · first line')
    failed.unmount()

    const noText = render(<VisualizeCard {...cardProps({
      kind: 'tool-result',
      isError: true,
      content: [{ type: 'image' }],
    })} />)
    expect(noText.container.textContent).toContain('visualization failed')
    noText.unmount()

    const foreign = render(<VisualizeCard {...cardProps({
      kind: 'tool-result',
      isError: false,
      meta: undefined,
      content: [{ type: 'text', text: 'plain fallback' }],
    })} />)
    expect(foreign.container.textContent).toBe('plain fallback')
  })

  it('renders a durable frame and accepts only its finite height reports', () => {
    const view = render(<VisualizeCard {...cardProps({
      kind: 'tool-result',
      isError: false,
      content: [{ type: 'text', text: 'ok' }],
      meta: {
        kind: 'visualize',
        fragment: '<div>A</div>',
        title: 'A',
        mode: 'inline',
        path: 'viz/a.html',
      },
    })} />)
    const frame = screen.getByTitle('A') as HTMLIFrameElement
    expect(frame.srcdoc).toContain('<div>A</div>')
    expect(frame.style.height).toBe('48px')

    for (const data of [
      null,
      { type: 'other', token: 'call-1', height: 100 },
      { type: HEIGHT_MESSAGE_TYPE, token: 'other', height: 100 },
      { type: HEIGHT_MESSAGE_TYPE, token: 'call-1', height: '100' },
      { type: HEIGHT_MESSAGE_TYPE, token: 'call-1', height: Number.NaN },
    ]) fireEvent(window, new MessageEvent('message', { data }))
    expect(frame.style.height).toBe('48px')

    fireEvent(window, new MessageEvent('message', {
      data: { type: HEIGHT_MESSAGE_TYPE, token: 'call-1', height: 100.2 },
    }))
    expect(frame.style.height).toBe('101px')
    fireEvent(window, new MessageEvent('message', {
      data: { type: HEIGHT_MESSAGE_TYPE, token: 'call-1', height: 900 },
    }))
    expect(frame.style.height).toBe('800px')
    view.unmount()
    fireEvent(window, new MessageEvent('message', {
      data: { type: HEIGHT_MESSAGE_TYPE, token: 'call-1', height: 200 },
    }))
  })
})

describe('StreamingPreview', () => {
  it('stays absent until a visualize call starts and chooses the latest call', () => {
    const absent = render(<StreamingPreview {...streamingProps(undefined)} />)
    expect(absent.container.innerHTML).toBe('')
    absent.rerender(<StreamingPreview {...streamingProps([{ kind: 'text', text: 'x' }])} />)
    expect(absent.container.innerHTML).toBe('')
    absent.rerender(<StreamingPreview {...streamingProps([
      { kind: 'tool-call', name: 'visualize', argsRaw: '{"fragment":"<div>old</div>"}' },
      { kind: 'tool-call', name: 'other', argsRaw: '{}' },
      { kind: 'tool-call', name: 'visualize', argsRaw: '{"fragment":"<div>new</div>"}' },
    ])} />)
    expect(absent.container.textContent).toContain('streaming preview')
  })

  it('loads one shell, posts throttled content, and follows valid height reports', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const view = render(<StreamingPreview {...streamingProps([
      { kind: 'tool-call', name: 'visualize', argsRaw: '{"fragment":"<div>one</div>"}' },
    ])} />)
    const frame = screen.getByTitle('Visualization streaming preview') as HTMLIFrameElement
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')
    fireEvent.load(frame)
    expect(postMessage).toHaveBeenCalledWith({
      type: STREAM_MESSAGE_TYPE,
      token: 'streaming-preview',
      fragment: '<div>one</div>',
    }, '*')

    view.rerender(<StreamingPreview {...streamingProps([
      { kind: 'tool-call', name: 'visualize', argsRaw: '{"fragment":"<div>two</div>"}' },
    ])} />)
    act(() => { vi.advanceTimersByTime(150) })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: STREAM_MESSAGE_TYPE,
      token: 'streaming-preview',
      fragment: '<div>two</div>',
    }, '*')

    for (const data of [
      { type: 'other', token: 'streaming-preview', height: 100 },
      { type: HEIGHT_MESSAGE_TYPE, token: 'other', height: 100 },
      { type: HEIGHT_MESSAGE_TYPE, token: 'streaming-preview', height: '100' },
      { type: HEIGHT_MESSAGE_TYPE, token: 'streaming-preview', height: Number.POSITIVE_INFINITY },
    ]) fireEvent(window, new MessageEvent('message', { data }))
    expect(frame.style.height).toBe('0px')
    fireEvent(window, new MessageEvent('message', {
      data: { type: HEIGHT_MESSAGE_TYPE, token: 'streaming-preview', height: -10.2 },
    }))
    expect(frame.style.height).toBe('0px')
    fireEvent(window, new MessageEvent('message', {
      data: { type: HEIGHT_MESSAGE_TYPE, token: 'streaming-preview', height: 500 },
    }))
    expect(frame.style.height).toBe('300px')

    view.rerender(<StreamingPreview {...streamingProps([
      { kind: 'tool-call', name: 'visualize', argsRaw: '{"title":"waiting"}' },
    ])} />)
    act(() => { vi.advanceTimersByTime(150) })
    expect(view.container.textContent).toContain('Visualize · composing')
    view.unmount()
  })
})
