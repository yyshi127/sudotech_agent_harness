import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { XiaojingWeixinChannel } from '../src/index.ts'
import { emptyWeixinState, WeixinStateStore } from '../src/state.ts'

type Listener = (...args: unknown[]) => unknown
type FixtureMode = 'stored' | 'fresh' | 'missing' | 'writer-held' | 'internal-error'

describe('Weixin Session recovery through the Host controller', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    try {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  async function fixture(mode: FixtureMode) {
    const root = await mkdtemp(join(tmpdir(), 'xiaojing-weixin-session-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const store = new WeixinStateStore(join(root, 'state.json'))
    const storedId = SessionId('11111111-1111-4111-8111-111111111111')
    const previousCwd = join(root, 'previous-workspace')
    const defaultCwd = join(root, 'current-workspace')
    await store.save({
      ...emptyWeixinState(),
      accountId: 'fixture-bot@im.bot',
      ownerUserId: 'fixture-owner',
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      ...(mode === 'fresh' ? {} : { sessionId: storedId }),
      sessionReady: mode !== 'fresh',
    })

    const listeners = new Map<string, Listener[]>()
    const emit = (name: string, ...args: unknown[]): void => {
      for (const listener of listeners.get(name) ?? []) listener(...args)
    }
    const outbound: string[] = []
    let firstPoll = true
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.origin !== 'https://ilinkai.weixin.qq.com') throw new Error('unexpected fixture origin')
      const json = (value: object): Response => new Response(JSON.stringify(value), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      if (url.pathname.endsWith('/notify') || url.pathname.endsWith('/getconfig')) return json({ ret: 0 })
      if (url.pathname.endsWith('/sendmessage')) {
        if (typeof init?.body !== 'string') throw new Error('missing fixture request body')
        const body = JSON.parse(init.body) as { msg: { item_list: Array<{ text_item: { text: string } }> } }
        outbound.push(body.msg.item_list[0]?.text_item.text ?? '')
        return json({ ret: 0 })
      }
      if (url.pathname.endsWith('/getupdates')) {
        if (firstPoll) {
          firstPoll = false
          return json({
            ret: 0, get_updates_buf: 'fixture-cursor',
            msgs: ['你好', '继续'].map((text, index) => ({
              client_id: `fixture-message-${index}`, from_user_id: 'fixture-owner',
              context_token: `fixture-context-${index}`,
              item_list: [{ type: 1, text_item: { text } }],
            })),
          })
        }
        return await new Promise<Response>((_resolve, reject) => {
          const abort = (): void => { reject(new DOMException('fixture stopped', 'AbortError')) }
          if (init?.signal?.aborted === true) abort()
          else init?.signal?.addEventListener('abort', abort, { once: true })
        })
      }
      throw new Error(`unexpected fixture endpoint: ${url.pathname}`)
    }))

    // This is the existing channel test's service fixture, not a Loader composition.
    let activeSessionId = storedId
    const agent: Agent = {
      session: {
        get id() { return activeSessionId },
        header: { get id() { return activeSessionId }, cwd: mode === 'stored' ? previousCwd : defaultCwd },
      },
      ctx: {
        tools: { get: () => undefined, register: () => () => {}, restrict: () => () => {} },
        systemPrompt: { context: () => () => {} },
      },
      whenIdle: () => Promise.resolve(),
    } as never
    let available = false
    const resolveAgent = vi.fn<Context['sessionController']['resolveAgent']>(async (sessionId) => {
      if (mode === 'writer-held') return { error: new RemoteError('session/writer-held', 'fixture writer held', { sessionId }) }
      if (mode === 'internal-error') return { error: new RemoteError('gateway/internal', 'fixture read failed', {}) }
      if (mode === 'stored' || available) {
        available = true
        return { agent }
      }
      return { error: new RemoteError('session/not-found', 'fixture Session absent', { sessionId }) }
    })
    const create = vi.fn<Context['sessionController']['create']>(async (request) => {
      const sessionId = request.sessionId ?? storedId
      if (mode === 'stored' && request.cwd !== previousCwd) {
        throw new RemoteError('session/conflict', 'fixture Session belongs to its previous workspace', {
          sessionId, requestedCwd: defaultCwd, existingCwd: previousCwd,
        })
      }
      activeSessionId = sessionId
      available = true
      return { sessionId }
    })
    let turn = 0
    const prompt = vi.fn<Context['sessionController']['prompt']>(async (request) => {
      turn += 1
      const text = request.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
      emit('agent/inbox/claimed', {
        agent, turn, message: { role: 'user', content: request.content, source: { kind: 'user', rpcId: request.requestId } },
      })
      emit('session/event', agent.session, {
        type: 'assistant/message', seq: turn * 2, time: Date.now(),
        data: { turn, step: 1, stream: [], message: { role: 'assistant', content: [{ type: 'text', text: `已处理：${text}` }] } },
      })
      emit('session/event', agent.session, {
        type: 'turn/end', seq: turn * 2 + 1, time: Date.now(), data: { turn, reason: { kind: 'completed' } },
      })
      return { accepted: true }
    })
    const ctx: Context = {
      attachments: { imageLimits: {
        maxImageBytes: 3_500_000, maxImagesPerMessage: 20, maxMessageImageBytes: 100_000_000,
        maxImagePixels: 40_000_000, maxImageDimension: 2000, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      } },
      connection: { rpc: { handle: () => () => {} } },
      credentials: { resolve: async () => ({ value: 'fixture-token' }) },
      sessionController: {
        resolveAgent, create, prompt, rename: vi.fn(async () => ({ title: '微信助手', seq: 0 })),
        cancel: vi.fn(), inspect: vi.fn(async () => ({ meta: agent.session.header, events: [] })),
      },
      agents: { get: (id: string) => available && id === agent.session.id ? agent : undefined },
      logger: { warn: vi.fn() },
      on: (name: string, listener: Listener) => { listeners.set(name, [...listeners.get(name) ?? [], listener]) },
      effect: (factory: () => unknown) => { factory() },
    } as never
    const channel = new XiaojingWeixinChannel(ctx, {
      stateDir: root, requestTimeoutMs: 1_000, longPollTimeoutMs: 5_000,
      retryDelayMs: 10, backoffDelayMs: 20, mediaTransferTimeoutMs: 5_000,
      approvalTimeoutMs: 2_000, progressHeartbeatMs: 60_000, maxReplyChars: 3_500,
      mediaDir: join(root, 'uploads'), maxMediaBytes: 1024, totalMediaBytes: 2048,
    })
    cleanups.push(() => channel.dispose())
    channel.install()
    await channel.start()
    await vi.waitFor(() => {
      expect(outbound.some(text => text === '已处理：继续' || text.includes('任务暂时中断'))).toBe(true)
    })
    if (outbound.includes('已处理：继续')) {
      await vi.waitFor(async () => { expect((await store.load()).pending).toEqual([]) })
    }
    return { store, storedId, previousCwd, agent, outbound, resolveAgent, create, prompt }
  }

  it('returns both FIFO replies from the stored Session when the Host workspace changed', async () => {
    const f = await fixture('stored')
    expect(f.outbound.filter(text => text.startsWith('已处理：'))).toEqual(['已处理：你好', '已处理：继续'])
    expect(f.outbound.some(text => text.includes('自动重试'))).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
    expect(f.agent.session.header.cwd).toBe(f.previousCwd)
    const state = await f.store.load()
    expect(state.sessionId).toBe(f.storedId)
    expect(state.pending).toEqual([])
    expect(state.completedMessageIds).toEqual(['client:fixture-message-0', 'client:fixture-message-1'])
  })

  it.each(['fresh', 'missing'] as const)('creates only the absent %s Session and processes both messages in order', async (mode) => {
    const f = await fixture(mode)
    expect(f.outbound.filter(text => text.startsWith('已处理：'))).toEqual(['已处理：你好', '已处理：继续'])
    expect(f.create).toHaveBeenCalledTimes(1)
    const state = await f.store.load()
    expect(f.create).toHaveBeenCalledWith({ sessionId: state.sessionId })
    expect(f.resolveAgent).toHaveBeenCalledTimes(2)
    expect(state.pending).toEqual([])
    expect(state.completedMessageIds).toEqual(['client:fixture-message-0', 'client:fixture-message-1'])
  })

  it.each(['writer-held', 'internal-error'] as const)('preserves queued input without creating a replacement after %s', async (mode) => {
    const f = await fixture(mode)
    expect(f.create).not.toHaveBeenCalled()
    expect(f.prompt).not.toHaveBeenCalled()
    const state = await f.store.load()
    expect(state.sessionId).toBe(f.storedId)
    expect(state.pending.map(task => task.text)).toEqual(['你好', '继续'])
    expect(state.pending.every(task => task.phase === 'received')).toBe(true)
    expect(state.completedMessageIds).toEqual([])
  })
})
