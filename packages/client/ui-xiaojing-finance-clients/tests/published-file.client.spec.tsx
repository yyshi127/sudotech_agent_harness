// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ConversationNodeContext, ConversationMatch, ConversationStartMatch } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PublishedFile, type PublishedFileProps } from '../src/client/PublishedFile.tsx'
import { publishedFileDefinition as definition } from '../src/client/published-file.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const path = 'E:/客户/成果/应收.xlsx'
const event = { seq: 12, time: 100, type: 'finance/file-published', data: { file: { id: 'file-1', path, name: '应收.xlsx' } } } as ConversationMatch['event']
const start = { event, view: undefined, role: 'start', location: { kind: 'unresolved' } } as ConversationStartMatch

it('projects only durable publications with their exact identity and path', () => {
  expect(definition.match(event)).toEqual({ id: 'file-1', role: 'start' })
  expect(definition.match({ ...event, type: 'finance/file-imported' } as ConversationMatch['event'])).toBeNull()
  expect(definition.match({ ...event, type: 'finance/file-archived' } as ConversationMatch['event'])).toBeNull()
  const context = { key: 'finance-published-file:file-1', id: 'file-1', start } as ConversationNodeContext<{ path: string; name: string }>
  const state = definition.start(context, start, { previous: () => undefined })
  expect(state).toEqual({ path, name: '应收.xlsx' })
  const ready = { ...context, state }
  expect(definition.buildViewNode!(ready)).toMatchObject({ anchorSeq: 12, data: state, kind: 'finance-published-file' })
  expect(definition.buildViewNode!({ ...context, state: undefined })).toBeNull()
})

it('opens only the committed file after a click and disables remote-host opening', () => {
  const openFile = vi.fn()
  const props = { node: { id: 'file-1', data: { path, name: '应收.xlsx' } }, openFile, canOpen: true,
    t: (key: keyof typeof zh) => zh[key] } as unknown as PublishedFileProps
  const view = render(<PublishedFile {...props} />)
  expect(openFile).not.toHaveBeenCalled()
  const button = screen.getByRole<HTMLButtonElement>('button', { name: '打开财务成果 · 应收.xlsx' })
  expect(button.title).toBe(path)
  fireEvent.click(button)
  expect(openFile).toHaveBeenCalledExactlyOnceWith(path)
  view.rerender(<PublishedFile {...props} canOpen={false} />)
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(openFile).toHaveBeenCalledTimes(1)
  expect(screen.getByText(zh.publishedFileLocalOnly)).toBeTruthy()
})
