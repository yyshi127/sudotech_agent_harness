import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import Invariants from '@deepseek-ai/dsh-invariants'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlPersistence, { type JsonlCompression } from '@deepseek-ai/dsh-session-persistence-jsonl'
import Approval, { setApprovalPolicy, type ApprovalAnswer, type ApprovalRequest, type ApprovalReuse } from '../src/index.ts'
import * as ApprovalInvariant from '../src/invariant.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const reusable: ApprovalReuse = {
  category: 'fixture:fill-form', scope: 'fixture:form-A', label: 'Fill fields in form A',
  displayLabel: { en: 'Fill fields in form A', zh: '填写表单 A 的字段' },
}

async function load(id = 'authorization-session', seed?: readonly SessionEvent[], persistence?: { root: string; compression: JsonlCompression }) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-authorization-'))
  roots.push(root)
  const path = join(root, 'cordis.yml')
  await writeFile(path, JSON.stringify([
    ...persistence === undefined ? [] : [{ name: 'cordis:persistence', config: persistence }],
    { id: 'fixture', name: 'cordis:fixture' }, { id: 'approval', name: 'cordis:approval' },
    { name: 'cordis:invariants' }, { name: 'cordis:approvalInvariant' },
  ]))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, {
    include: Include, approval: Approval, invariants: Invariants, approvalInvariant: ApprovalInvariant,
    persistence: JsonlPersistence,
    fixture: { async apply(inner: Context) {
      await mountAgentLoopTestDependencies(inner)
      await mountAgentLoopTestHarness(inner)
    } },
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  const { agent } = persistence === undefined
    ? await ctx.agents.create({ sessionId: SessionId(id), ...seed === undefined ? {} : { seed } })
    : await ctx.agents.resume({ resumeSessionId: SessionId(id) })
  if (seed === undefined && persistence === undefined) agent.session.append('turn/start', { turn: 1 })
  const fiber = [...ctx.loader.entries()].find(entry => entry.options.id === 'approval')!.fiber!
  return { ctx, agent, fiber, request: { agent, toolName: 'fixture_fill', reusable } satisfies ApprovalRequest }
}

function decisions(session: Session) {
  return session.snapshotEvents().filter((event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

async function persisted(session: Session, compression: JsonlCompression) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-authorization-storage-'))
  roots.push(root)
  const writerCtx = new Context()
  contexts.push(writerCtx)
  await writerCtx.plugin(JsonlPersistence, { root, compression })
  const writer = await writerCtx.sessionPersistence.create(session.header)
  await writer.append(session.snapshotEvents())
  await writer.flush()
  await writer.close()
  await writerCtx.fiber.dispose()
  const readerCtx = new Context()
  contexts.push(readerCtx)
  await readerCtx.plugin(JsonlPersistence, { root, compression })
  const reader = await readerCtx.sessionPersistence.open(session.id, 'read')
  try { return { ...await reader.read(), root, compression } }
  finally { await reader.close() }
}

describe('session authorization through the real Loader and Agent services', () => {
  it('audits the first grant and matching reuse, excluding localized presentation', async () => {
    const { ctx, agent, request } = await load()
    const answer = vi.fn(() => Promise.resolve<ApprovalAnswer>('allowed-session'))
    ctx.on('approval/request', answer)
    await expect(ctx.approval.request(request)).resolves.toBe('allowed-once')
    await expect(ctx.approval.request({ ...request, toolName: 'fixture_select' })).resolves.toBe('allowed-once')
    expect(answer).toHaveBeenCalledOnce()
    expect(decisions(agent.session).map(event => event.data.authorization)).toEqual([
      { category: reusable.category, scope: reusable.scope, label: reusable.label, sessionId: agent.session.id, kind: 'session' },
      { category: reusable.category, scope: reusable.scope, label: reusable.label, sessionId: agent.session.id, kind: 'reuse' },
    ])
    const asked = agent.session.snapshotEvents().find(event => event.type === 'approval/asked')
    expect(asked?.data).toMatchObject({ reusable: { category: reusable.category, scope: reusable.scope, label: reusable.label } })
    expect(JSON.stringify(agent.session.snapshotEvents())).not.toContain('displayLabel')
  })

  it('restores a committed grant after reopening the same Session, without granting a new Session or copied history', async () => {
    const first = await load()
    first.ctx.on('approval/request', () => Promise.resolve<ApprovalAnswer>('allowed-session'))
    await first.ctx.approval.request(first.request)
    first.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const seed = first.agent.session.snapshotEvents()
    const reopened = await load(first.agent.session.id, seed)
    reopened.agent.session.append('turn/start', { turn: 2 })
    const answer = vi.fn(() => Promise.resolve<ApprovalAnswer>('rejected'))
    reopened.ctx.on('approval/request', answer)
    await expect(reopened.ctx.approval.request(reopened.request)).resolves.toBe('allowed-once')
    expect(answer).not.toHaveBeenCalled()
    const copied = await load('other-session', seed)
    copied.agent.session.append('turn/start', { turn: 2 })
    copied.ctx.on('approval/request', answer)
    await expect(copied.ctx.approval.request(copied.request)).resolves.toBe('rejected')
    const fresh = await load('fresh-session')
    fresh.ctx.on('approval/request', answer)
    await expect(fresh.ctx.approval.request(fresh.request)).resolves.toBe('rejected')
    expect(answer).toHaveBeenCalledTimes(2)
  })

  it.each(['none', 'zstd'] as const)('restores a closed-turn authorization through the production %s storage decoder', async (compression) => {
    const first = await load()
    first.ctx.on('approval/request', () => Promise.resolve<ApprovalAnswer>('allowed-session'))
    // The preceding unclassified audit pair remains readable without new optional fields.
    await expect(first.ctx.approval.request({ agent: first.agent, toolName: 'fixture_old' })).resolves.toBe('unavailable')
    await first.ctx.approval.request(first.request)
    first.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const decoded = await persisted(first.agent.session, compression)
    expect(decoded.events.filter(event => event.type === 'approval/decided').map(event => event.data.authorization?.kind))
      .toEqual([undefined, 'session'])
    const reopened = await load(first.agent.session.id, undefined, decoded)
    reopened.agent.session.append('turn/start', { turn: 2 })
    const answer = vi.fn(() => Promise.resolve<ApprovalAnswer>('rejected'))
    reopened.ctx.on('approval/request', answer)
    await expect(reopened.ctx.approval.request(reopened.request)).resolves.toBe('allowed-once')
    expect(answer).not.toHaveBeenCalled()
    expect(decisions(reopened.agent.session).at(-1)?.data.authorization?.kind).toBe('reuse')
  })

  it.each(['none', 'zstd'] as const)('does not restore a grant in an interrupted %s storage turn', async (compression) => {
    const first = await load()
    first.ctx.on('approval/request', () => Promise.resolve<ApprovalAnswer>('allowed-session'))
    await first.ctx.approval.request(first.request)
    first.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    first.agent.session.append('turn/start', { turn: 2 })
    const interrupted = { ...first.request, reusable: { ...reusable, scope: 'fixture:form-B' } }
    await first.ctx.approval.request(interrupted)
    const decoded = await persisted(first.agent.session, compression)
    // Storage retains valid interrupted history; production Agent repair must not convert it into a grant.
    expect(decoded.events.some(event => event.type === 'approval/decided' && event.data.authorization !== undefined)).toBe(true)
    const reopened = await load(first.agent.session.id, undefined, decoded)
    expect(reopened.agent.session.snapshotEvents().find(event => event.type === 'turn/end' && event.data.turn === 2))
      .toMatchObject({ type: 'turn/end', data: { reason: { kind: 'interrupted' } } })
    reopened.agent.session.append('turn/start', { turn: 3 })
    const answer = vi.fn(() => Promise.resolve<ApprovalAnswer>('rejected'))
    reopened.ctx.on('approval/request', answer)
    await expect(reopened.ctx.approval.request(reopened.request)).resolves.toBe('allowed-once')
    await expect(reopened.ctx.approval.request({ ...reopened.request, reusable: interrupted.reusable })).resolves.toBe('rejected')
    expect(answer).toHaveBeenCalledOnce()
  })

  it('keeps unapproved model context byte-stable and states session reuse only after committed authorization', async () => {
    const { ctx, agent, request } = await load()
    const context = async () => (await ctx.systemPrompt.assemble({ agent })).contexts.find(entry => entry.name === 'approval:policy')?.text
    expect(await context()).toBe('Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.')
    ctx.on('approval/request', () => Promise.resolve<ApprovalAnswer>('allowed-session'))
    await ctx.approval.request(request)
    expect(await context()).toContain('A user-approved operation class and target scope may reuse authorization only within this session.')
    setApprovalPolicy(agent.session, 'never')
    expect(await context()).toContain('actions that require ordinary approval are rejected automatically')
    expect(await context()).toContain('Unclassified confirmations, including deletion confirmation, require approval for each action.')
  })

  it('does not equate another category or scope with an existing grant', async () => {
    const { ctx, request } = await load()
    const answer = vi.fn(() => Promise.resolve<ApprovalAnswer>('allowed-session'))
    ctx.on('approval/request', answer)
    await ctx.approval.request(request)
    await ctx.approval.request({ ...request, reusable: { ...reusable, scope: 'fixture:form-B' } })
    await ctx.approval.request({ ...request, reusable: { ...reusable, category: 'fixture:submit-form' } })
    expect(answer).toHaveBeenCalledTimes(3)
  })

  it('offers no reusable grant for an unclassified request or a one-shot answer', async () => {
    const { ctx, agent, request } = await load()
    const answer = vi.fn(() => Promise.resolve<ApprovalAnswer>('allowed-session'))
    ctx.on('approval/request', answer)
    const unclassified = { agent, toolName: request.toolName }
    await expect(ctx.approval.request(unclassified)).resolves.toBe('unavailable')
    answer.mockImplementation(() => Promise.resolve<ApprovalAnswer>('allowed-once'))
    await ctx.approval.request(request)
    await ctx.approval.request(request)
    expect(answer).toHaveBeenCalledTimes(3)
    expect(decisions(agent.session).every(event => event.data.authorization === undefined)).toBe(true)
  })

  it('rejects ordinary reuse under never while an explicitly classified mandatory request still obeys its answer', async () => {
    const { ctx, agent, request } = await load()
    const answer = vi.fn(() => Promise.resolve<ApprovalAnswer>('allowed-session'))
    ctx.on('approval/request', answer)
    await ctx.approval.request(request)
    setApprovalPolicy(agent.session, 'never')
    await expect(ctx.approval.request(request)).resolves.toBe('rejected')
    await expect(ctx.approval.requestMandatory(request)).resolves.toBe('allowed-once')
    expect(answer).toHaveBeenCalledOnce()
    expect(decisions(agent.session)[1]?.data.authorization).toBeUndefined()
  })

  it('merges concurrent matching requests after the first grant commits', async () => {
    const { ctx, agent, request } = await load()
    const selected = deferred<ApprovalAnswer>()
    const asked = deferred<boolean>()
    const answer = vi.fn(() => { asked.resolve(true); return selected.promise })
    ctx.on('approval/request', answer)
    const first = ctx.approval.request(request)
    const second = ctx.approval.request(request)
    await asked.promise
    expect(answer).toHaveBeenCalledOnce()
    selected.resolve('allowed-session')
    await expect(Promise.all([first, second])).resolves.toEqual(['allowed-once', 'allowed-once'])
    expect(answer).toHaveBeenCalledOnce()
    expect(decisions(agent.session).map(event => event.data.authorization?.kind)).toEqual(['session', 'reuse'])
  })

  it('cancels a queued request promptly without letting the following request overtake the active question', async () => {
    const { ctx, agent, request } = await load()
    const selected = deferred<ApprovalAnswer>()
    const asked = deferred<boolean>()
    const answer = vi.fn(() => { asked.resolve(true); return selected.promise })
    ctx.on('approval/request', answer)
    const first = ctx.approval.request(request)
    await asked.promise
    const controller = new AbortController()
    const second = ctx.approval.request({ ...request, signal: controller.signal })
    const third = ctx.approval.request(request)
    controller.abort()
    await expect(second).resolves.toBe('cancelled')
    expect(answer).toHaveBeenCalledOnce()
    selected.resolve('allowed-session')
    await expect(Promise.all([first, third])).resolves.toEqual(['allowed-once', 'allowed-once'])
    expect(decisions(agent.session).map(event => event.data.authorization?.kind)).toEqual([undefined, 'session', 'reuse'])
  })

  it('discards a late session answer after cancellation and asks the next matching request', async () => {
    const { ctx, agent, request } = await load()
    const selected = deferred<ApprovalAnswer>()
    const asked = deferred<boolean>()
    const answer = vi.fn(() => { asked.resolve(true); return selected.promise })
    ctx.on('approval/request', answer)
    const controller = new AbortController()
    const pending = ctx.approval.request({ ...request, signal: controller.signal })
    await asked.promise
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')
    selected.resolve('allowed-session')
    answer.mockImplementation(() => Promise.resolve<ApprovalAnswer>('rejected'))
    await expect(ctx.approval.request(request)).resolves.toBe('rejected')
    expect(answer).toHaveBeenCalledTimes(2)
    expect(decisions(agent.session).every(event => event.data.authorization === undefined)).toBe(true)
  })

  it('cancels active and queued questions on service unload and does not restore a late grant', async () => {
    const { ctx, agent, request, fiber } = await load()
    const selected = deferred<ApprovalAnswer>()
    const asked = deferred<boolean>()
    let answererCancelled = false
    ctx.on('approval/request', (event) => {
      event.signal?.addEventListener('abort', () => { answererCancelled = true }, { once: true })
      asked.resolve(true)
      return selected.promise
    })
    const service = ctx.approval
    const first = service.request(request)
    const second = service.request(request)
    await asked.promise
    await fiber.dispose()
    expect(answererCancelled).toBe(true)
    await expect(Promise.all([first, second])).resolves.toEqual(['cancelled', 'cancelled'])
    selected.resolve('allowed-session')
    await expect(service.request(request)).rejects.toThrow(/disposed/)
    expect(decisions(agent.session).every(event => event.data.authorization === undefined)).toBe(true)
  })

  it('does not publish a grant when its decided audit event fails before commit', async () => {
    const { ctx, agent, request } = await load()
    const answer = vi.fn(() => Promise.resolve<ApprovalAnswer>('allowed-session'))
    ctx.on('approval/request', answer)
    const failure = new Error('fixture audit commit blocked')
    const stop = ctx.on('internal/dispatch', (_mode, name, args) => {
      if (name !== 'session/event') return
      const [, event] = args as [Session, SessionEvent]
      if (event.type === 'approval/decided') throw failure
    }, { global: true })
    await expect(ctx.approval.request(request)).rejects.toBe(failure)
    expect(decisions(agent.session)).toHaveLength(0)
    stop()
    await expect(ctx.approval.request(request)).resolves.toBe('allowed-once')
    expect(answer).toHaveBeenCalledTimes(2)
    expect(decisions(agent.session)[0]?.data.authorization?.kind).toBe('session')
  })
})
