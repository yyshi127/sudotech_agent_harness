// @vitest-environment jsdom
/** Skill-catalog dispatch and retained Session lifetime over real plugin fibers. */
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { TestSessions } from '@deepseek-ai/dsh-client-test-runtime'
import { InputTriggerController, type InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { apply, inject } from '../src/client/index.ts'

const SID = 'render-skill-catalog' as SessionId
const request = () => ({ query: '', position: 'leading' as const, drilled: false, signal: new AbortController().signal })

async function bench() {
  const ctx = new Context()
  const sessions = new TestSessions(async (action) => { await action() }, ctx)
  const sources: InputTriggerSource[] = []
  const response = Promise.withResolvers<RemoteResult<{ skills: SkillEntry[] }>>()
  const listCalls: Array<{ sessionId: SessionId }> = []
  ctx.provide('sessions', sessions)
  await sessions.add({ id: SID })
  const reference = sessions.retain(SID, { source: 'mainView' })
  ctx.provide('inputTriggers', {
    registerSource(source: InputTriggerSource) {
      sources.push(source)
      return () => { sources.splice(sources.indexOf(source), 1) }
    },
  })
  ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} })
  ctx.provide('slots', { inject: () => () => {} })
  ctx.provide('sidebarRight', { openResource: () => {} })
  const skills = { list: (payload: { sessionId: SessionId }) => { listCalls.push(payload); return response.promise } }
  ctx.provide('remote', { skills, $on: () => () => {} })
  ctx.provide('remote.skills', skills)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const source = sources[0]
  if (source === undefined) throw new Error('skill catalog source was not registered')
  onTestFinished(async () => {
    response.resolve({ ok: true, value: { skills: [] } })
    cleanup()
    await fiber.dispose()
    reference.release()
    await sessions.disposeScopes()
    await ctx.fiber.dispose()
  })
  return { ctx, sessions, reference, source, fiber, sources, response, listCalls }
}

it('prewarms a rendered input without publishing skill retention during React render', async () => {
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
      () => b.sessions.list.getSnapshot().byId[SID]?.retainedBy.skillCatalog ?? 0,
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
  await waitFor(() => { expect(b.listCalls).toEqual([{ sessionId: SID }]) })
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.skillCatalog).toBe(1)
  await act(async () => { b.response.resolve({ ok: true, value: { skills: [] } }) })
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.skillCatalog).toBeUndefined()
  expect(renderErrors).toEqual([])
})

it('discards skill prewarming when its real owning fiber unloads before dispatch', async () => {
  const b = await bench()
  b.source.warm?.({ sessionId: SID })
  await b.fiber.dispose()
  await Promise.resolve()
  expect(b.listCalls).toEqual([])
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.skillCatalog).toBeUndefined()
  expect(b.source.lexicon?.({ sessionId: SID })).toBeUndefined()
})

it.each(['success', 'failure'])('releases a started skill reference after disposal and late %s without lexicon publication', async (outcome) => {
  const b = await bench()
  const listener = vi.fn()
  b.source.subscribeLexicon?.({ sessionId: SID }, listener)
  const pending = expect(b.source.candidates({ sessionId: SID }, request())).rejects.toThrow()
  await waitFor(() => { expect(b.listCalls).toEqual([{ sessionId: SID }]) })
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.skillCatalog).toBe(1)
  await b.fiber.dispose()
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.skillCatalog).toBe(1)
  if (outcome === 'success') b.response.resolve({ ok: true, value: { skills: [{ name: 'late', description: 'late catalog', modelInvocable: true }] } })
  else b.response.reject(new Error('late skill catalog failure'))
  await pending
  expect(b.sessions.retainInfo(SID).getSnapshot().retainedBy.skillCatalog).toBeUndefined()
  expect(b.source.lexicon?.({ sessionId: SID })).toBeUndefined()
  expect(listener).not.toHaveBeenCalled()
  b.source.warm?.({ sessionId: SID })
  await expect(b.source.candidates({ sessionId: SID }, request())).rejects.toThrow('skill catalog is disposed')
  await Promise.resolve()
  expect(b.listCalls).toEqual([{ sessionId: SID }])
})
