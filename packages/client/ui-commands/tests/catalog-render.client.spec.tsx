// @vitest-environment jsdom
/** Command-catalog prewarming over React and retained Client Session scopes. */
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { TestSessions } from '@deepseek-ai/dsh-client-test-runtime'
import { InputTriggerController, type InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CommandDescriptor } from '../src/client/directory.ts'
import { CommandUiRuntime } from '../src/client/service.ts'

const SID = 'render-command-catalog' as SessionId

async function bench() {
  const ctx = new Context()
  const sessions = new TestSessions(async (action) => { await action() }, ctx)
  const sources: InputTriggerSource[] = []
  const response = Promise.withResolvers<RemoteResult<CommandDescriptor[]>>()
  const listCalls: SessionId[] = []
  ctx.provide('sessions', sessions)
  await sessions.add({ id: SID })
  const reference = sessions.retain(SID, { source: 'mainView' })
  ctx.provide('inputTriggers', {
    registerSource(source: InputTriggerSource) {
      sources.push(source)
      return () => { sources.splice(sources.indexOf(source), 1) }
    },
  })
  ctx.provide('locale', { bind: () => (key: string) => key })
  const commands = { list: (id: SessionId) => { listCalls.push(id); return response.promise } }
  ctx.provide('remote', { commands, $on: () => () => {} })
  ctx.provide('remote.commands', commands)
  const fiber = ctx.plugin(CommandUiRuntime)
  await fiber.await()
  const source = sources[0]
  if (source === undefined) throw new Error('command catalog source was not registered')
  onTestFinished(async () => {
    response.resolve({ ok: true, value: [] })
    cleanup()
    await fiber.dispose()
    reference.release()
    await sessions.disposeScopes()
    await ctx.fiber.dispose()
  })
  return { sessions, reference, source, fiber, sources, response, listCalls }
}

it('prewarms a rendered input without publishing Session retention during React render', async () => {
  const b = await bench()
  const renderErrors: unknown[][] = []
  const originalError = console.error.bind(console)
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Cannot update a component')) renderErrors.push(args)
    originalError(...args)
  })
  onTestFinished(() => { spy.mockRestore() })
  function SessionReferenceCount() {
    const count = useSyncExternalStore(
      notify => b.sessions.list.subscribe(notify),
      () => b.sessions.list.getSnapshot().byId[SID]?.retainedBy.commandCatalog ?? 0,
    )
    return <span>{count}</span>
  }
  function RenderedInput() {
    const [controller] = useState(() => new InputTriggerController({
      actx: b.reference.binding.ctx,
      sessionId: SID,
      roster: { all: () => b.sources, sources: () => b.sources },
    }))
    useEffect(() => () => { controller.dispose() }, [controller])
    return null
  }
  const view = render(<><SessionReferenceCount /></>)
  view.rerender(<><SessionReferenceCount /><RenderedInput /></>)
  await waitFor(() => { expect(b.listCalls).toEqual([SID]) })
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.commandCatalog).toBe(1)
  await act(async () => { b.response.resolve({ ok: true, value: [] }) })
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.commandCatalog).toBeUndefined()
  expect(renderErrors).toEqual([])
})

it('discards catalog prewarming when its service fiber closes before dispatch', async () => {
  const b = await bench()
  b.source.warm?.({ sessionId: SID })
  await b.fiber.dispose()
  await Promise.resolve()
  expect(b.listCalls).toEqual([])
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.commandCatalog).toBeUndefined()
})

it.each(['success', 'failure'])('releases an already-started catalog reference after service disposal and late %s', async (outcome) => {
  const b = await bench()
  b.source.warm?.({ sessionId: SID })
  await waitFor(() => { expect(b.listCalls).toEqual([SID]) })
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.commandCatalog).toBe(1)
  await b.fiber.dispose()
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.commandCatalog).toBe(1)
  if (outcome === 'success') b.response.resolve({ ok: true, value: [{ name: 'late', description: 'late catalog' }] })
  else b.response.reject(new Error('late catalog failure'))
  await waitFor(() => {
    expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.commandCatalog).toBeUndefined()
  })
  await expect(b.source.candidates({ sessionId: SID }, { query: '', position: 'leading', drilled: false, signal: new AbortController().signal }))
    .rejects.toThrow('command directory is disposed')
  b.source.warm?.({ sessionId: SID })
  await Promise.resolve()
  expect(b.listCalls).toEqual([SID])
})
