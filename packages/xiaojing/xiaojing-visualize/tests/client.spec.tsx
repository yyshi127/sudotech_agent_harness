// @vitest-environment jsdom
/** Browser rendering, streaming, and slot registration behavior. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { HEIGHT_MESSAGE_TYPE, STREAM_MESSAGE_TYPE } from '../src/shell.ts'
import { StreamingPreview } from '../src/client/StreamingPreview.tsx'
import { VisualizeCard } from '../src/client/VisualizeCard.tsx'
import { VisualizeTurnTail } from '../src/client/VisualizeTurnTail.tsx'
import { EMPTY_CHAT_SNAPSHOT, type ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { apply, inject, name } from '../src/client/index.ts'
import { resolveTheme } from '../src/client/theme.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function streamingProps(blocks: unknown, status = 'running') {
  const assistant = { status, blocks }
  const step = { data: { source: () => ({ getSnapshot: () => assistant, subscribe: () => () => {} }) } }
  return {
    useChat: (selector: (snapshot: unknown) => unknown) => selector({
      ...EMPTY_CHAT_SNAPSHOT,
      timeline: { turnOrder: blocks === undefined ? [] : [1], turns: new Map([[1, { steps: [step] }]]) },
    }),
  } as unknown as Parameters<typeof StreamingPreview>[0]
}

function cardProps(block: unknown, callId = 'call-1') {
  return { block, callId } as unknown as Parameters<typeof VisualizeCard>[0]
}

describe('visualize client registration and theme', () => {
  it('registers tool, streaming, and completed-turn occupants with independent native theme copies', () => {
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
    expect(injectSlot).toHaveBeenCalledTimes(3)
    expect(registrations).toHaveLength(3)
    expect(register).toHaveBeenCalledWith({
      name: 'conversation.chat.turnTail', id: 'visualize-results', order: 30,
    }, VisualizeTurnTail)

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

describe('VisualizeTurnTail', () => {
  it('restores only this turn\'s successful cards without requiring an expanded process or source file', () => {
    const meta = { kind: 'visualize', fragment: '<button>Saved interaction</button>', title: 'Saved chart', mode: 'inline', path: 'viz/missing.html' }
    const nodes = new Map<string, unknown>([
      ['good', { kind: 'tool-call', data: { root: { kind: 'tool-result', callId: 'saved', isError: false, meta } } }],
      ['failed', { kind: 'tool-call', data: { root: { kind: 'tool-result', callId: 'failed', isError: true, meta } } }],
      ['foreign', { kind: 'tool-call', data: { root: { kind: 'tool-result', callId: 'foreign', isError: false } } }],
      ['running', { kind: 'tool-call', data: { root: { callId: 'running' } } }],
      ['assistant', { kind: 'assistant', data: {} }],
      ['other-turn', { kind: 'tool-call', data: { root: { kind: 'tool-result', callId: 'other', isError: false, meta: { ...meta, title: 'Other turn' } } } }],
    ])
    const snapshot = {
      ...EMPTY_CHAT_SNAPSHOT,
      locations: { ...EMPTY_CHAT_SNAPSHOT.locations, getTurn: (turn: number) => turn === 1 ? ['good', 'failed', 'foreign', 'running', 'assistant', 'missing'] : ['other-turn'] },
      nodes: { ...EMPTY_CHAT_SNAPSHOT.nodes, get: (key: string) => nodes.get(key) },
    } as ChatSnapshot
    const props = (turn: number) => ({
      turn: { turn }, useChat: (selector: (value: ChatSnapshot) => unknown) => selector(snapshot),
    }) as unknown as Parameters<typeof VisualizeTurnTail>[0]
    const view = render(<VisualizeTurnTail {...props(1)} />)
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1)
    const frame = screen.getByTitle('Saved chart') as HTMLIFrameElement
    expect(frame.srcdoc).toContain('<button>Saved interaction</button>')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    view.rerender(<VisualizeTurnTail {...props(2)} />)
    expect(screen.queryByTitle('Saved chart')).toBeNull()
    expect(screen.getByTitle('Other turn')).toBeDefined()
    view.unmount()
    render(<VisualizeTurnTail {...props(1)} />)
    expect(screen.getByTitle('Saved chart')).toBeDefined()
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
    absent.rerender(<StreamingPreview {...streamingProps([
      { kind: 'tool-call', name: 'visualize', argsRaw: '{"fragment":"<div>done</div>"}' },
    ], 'settled')} />)
    expect(absent.container.innerHTML).toBe('')
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
