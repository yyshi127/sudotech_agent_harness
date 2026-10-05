/** Real Web Loader, SessionController, and Weixin queue recovery with local transport and model fixtures. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { generationLogPath } from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { compressZstdFrame } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import type { XiaojingWeixinChannel } from '@deepseek-ai/dsh-xiaojing-weixin-channel'
import { WeixinStateStore } from '@deepseek-ai/dsh-xiaojing-weixin-channel/src/state.ts'
import type { WeixinChannelStateFile } from '@deepseek-ai/dsh-xiaojing-weixin-channel/src/types.ts'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const REPLIES = ['你好！我是小兢，你的办公搭子。', '你好！我在，有什么需要帮忙的？']
const EXPECTED = fileURLToPath(new URL('./fixtures/weixin-session-restore/replies.expected.md', import.meta.url))

class GreetingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly queued: Promise<undefined>) { super() }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = REPLIES[this.requests.length]
    if (text === undefined) throw new Error('Unexpected extra Weixin model request')
    this.requests.push(options)
    if (this.requests.length === 1) await this.queued
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected fixture JSON object')
  return value as Record<string, unknown>
}

function waitForAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const abort = (): void => { reject(new DOMException('Fixture polling stopped', 'AbortError')) }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

it('resumes the old Weixin directory and delivers two queued greetings once in FIFO order', async () => {
  vi.stubEnv('XIAOJING_WEIXIN_TOKEN', undefined)
  vi.stubEnv('DSH_SNAPSHOT', 'replay')
  const originalFetch = globalThis.fetch
  const outbound: Array<{ context: string; text: string }> = []
  let updateCalls = 0
  let externalRequests = 0
  let scaffold: WebScaffold | undefined
  let channel: XiaojingWeixinChannel | undefined
  const queued = Promise.withResolvers<undefined>()
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin !== 'https://ilinkai.weixin.qq.com') {
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') return originalFetch(input, init)
      externalRequests += 1
      throw new Error('Weixin recovery fixture refuses external HTTP')
    }
    if (url.pathname.endsWith('/getconfig') || url.pathname.endsWith('/msg/notifystart')
      || url.pathname.endsWith('/msg/notifystop')) return Response.json({ ret: 0 })
    if (url.pathname.endsWith('/sendmessage')) {
      if (typeof init?.body !== 'string') throw new Error('Missing fixture Weixin request body')
      const msg = record(record(JSON.parse(init.body)).msg)
      if (!Array.isArray(msg.item_list)) throw new Error('Missing fixture Weixin message items')
      const text = record(record(msg.item_list[0]).text_item).text
      if (typeof text !== 'string' || typeof msg.context_token !== 'string') throw new Error('Invalid fixture Weixin reply')
      outbound.push({ context: msg.context_token, text })
      if (msg.context_token === 'fixture-context-2' && text.startsWith('✅')) queued.resolve(undefined)
      return Response.json({ ret: 0 })
    }
    if (url.pathname.endsWith('/getupdates')) {
      updateCalls += 1
      if (updateCalls === 1) return Response.json({ ret: 0, get_updates_buf: 'fixture-cursor', msgs: [1, 2].map(index => ({
        client_id: `fixture-hi-${index}`, from_user_id: 'fixture-owner', context_token: `fixture-context-${index}`,
        item_list: [{ type: 1, text_item: { text: '你好' } }],
      })) })
      return waitForAbort(init?.signal)
    }
    throw new Error(`Unsupported fixture iLink path: ${url.pathname}`)
  })
  try {
    scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./fixtures/weixin-session-restore/channel.overlay.yml', import.meta.url)) })
    const ctx = scaffold.ctx
    await ctx.credentials.set(credentialRef('XIAOJING_WEIXIN_TOKEN'), 'fixture-token-local-only')
    const adapter = new GreetingAdapter(queued.promise)
    ctx.effect(() => ctx.llm.registerAdapter(['weixin-greeting-fixture'], adapter))
    await ctx.settings.update('agent-default-model', { provider: 'weixin-greeting-fixture', model: 'weixin-greeting-fixture' })
    const defaultSession = await ctx.sessionController.create({ sessionId: SessionId(randomUUID()) })
    expect(ctx.agents.get(defaultSession.sessionId)?.session.header.cwd).toBe(scaffold.workspaceCwd)
    const id = SessionId(randomUUID())
    const oldCwd = join(scaffold.workspaceCwd, '旧微信工作区')
    await mkdir(oldCwd)
    const v3Path = generationLogPath(scaffold.persistenceRoot, oldCwd, id, 3, 'zstd')
    const v3Bytes = Buffer.concat([
      await compressZstdFrame(JSON.stringify({ type: 'session', version: 3, id, createdAt: 1790179200000, cwd: oldCwd,
        isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }) + '\n'),
      await compressZstdFrame(JSON.stringify({ type: 'session/title', seq: 0, time: 1790179200000,
        data: { title: '微信助手', source: { kind: 'user' }, messageSeqs: [] } }) + '\n'),
    ])
    await mkdir(dirname(v3Path), { recursive: true })
    await writeFile(v3Path, v3Bytes)
    {
      using observation = await ctx.sessionQuery.observeSession(id)
      expect(observation.header.cwd).toBe(oldCwd)
      expect(observation.events).toHaveLength(1)
    }
    expect(ctx.agents.get(id)).toBeUndefined()
    expect(ctx.sessions.get(id)).toBeUndefined()
    const stateDir = join(scaffold.harnessHome, 'weixin-fixture')
    const state: WeixinChannelStateFile = { schemaVersion: 2, accountId: 'fixture-bot@im.bot', ownerUserId: 'fixture-owner',
      baseUrl: 'https://ilinkai.weixin.qq.com/', sessionId: id, sessionReady: true,
      updatesCursor: '', pending: [], completedMessageIds: [] }
    const store = new WeixinStateStore(join(stateDir, 'state.json'))
    await store.save(state)
    const channelEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'xiaojing-weixin-channel')
    if (channelEntry === undefined) throw new Error('The Web composition has no Weixin channel entry')
    await channelEntry.update({ disabled: false, config: { stateDir, mediaDir: join(scaffold.workspaceCwd, 'weixin-media') } })
    await ctx.loader.await()
    channel = channelEntry.ctx.get('xiaojingWeixinChannel')
    if (channel === undefined) throw new Error(`Weixin Loader entry did not activate: ${String(channelEntry.fiber?.state)}`)
    try {
      await expect.poll(async () => (await store.load()).completedMessageIds, { timeout: 10_000 }).toEqual([
        'client:fixture-hi-1', 'client:fixture-hi-2',
      ])
    } catch (error) {
      throw new Error(JSON.stringify({ updateCalls, outbound, requests: adapter.requests.length,
        status: channel.snapshot(), pending: (await store.load()).pending.map(task => ({ id: task.id, phase: task.phase })),
        events: ctx.agents.get(id)?.session.snapshotEvents().map(event => ({ type: event.type,
          ...'turn' in event.data ? { turn: event.data.turn } : {},
          ...event.type === 'turn/end' ? { reason: event.data.reason } : {},
          ...event.type === 'user/message' ? { source: event.data.source } : {},
        })),
      }), { cause: error })
    }
    const completed = await store.load()
    expect(completed.pending).toEqual([])
    expect(completed.sessionId).toBe(id)
    expect(completed.sessionReady).toBe(true)
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests.map(request => request.messages.filter(message => message.role === 'user'
      && message.content.length === 1 && message.content[0]?.type === 'text' && message.content[0].text === '你好').length))
      .toEqual([1, 2])
    const replies = outbound.filter(reply => REPLIES.includes(reply.text))
    expect(replies).toEqual(REPLIES.map((text, index) => ({ context: `fixture-context-${index + 1}`, text })))
    expect(outbound.filter(reply => reply.text.startsWith('✅'))).toEqual([
      { context: 'fixture-context-1', text: '✅ 已收到，正在执行。' },
      { context: 'fixture-context-2', text: '✅ 已收到，已进入队列（前面还有 1 个任务）。' },
    ])
    expect(outbound.some(reply => reply.text.includes('任务暂时中断'))).toBe(false)
    const agent = ctx.agents.get(id)
    expect(agent).toBeDefined()
    expect(agent?.session.header.cwd).toBe(oldCwd)
    expect(agent?.session.header.agentPreset).toBe('standard')
    const events = agent!.session.snapshotEvents()
    expect(events[0]).toMatchObject({ type: 'session/title', data: { title: '微信助手' } })
    expect(events.filter(event => event.type === 'user/message').filter(event => event.data.source?.kind === 'user')
      .map(event => event.data.content)).toEqual([
      [{ type: 'text', text: '你好' }], [{ type: 'text', text: '你好' }],
    ])
    expect(events.filter(event => event.type === 'turn/end').map(event => event.data.reason)).toEqual([
      { kind: 'completed' }, { kind: 'completed' },
    ])
    await ctx.sessions.flush(agent!.session)
    expect(await readFile(v3Path)).toEqual(v3Bytes)
    expect(await readdir(dirname(v3Path))).toContain('session.v4.jsonl.zstd')
    expect(externalRequests).toBe(0)
    await compareOrRefreshGolden(EXPECTED, outbound.map(reply => `${reply.context}: ${reply.text}`).join('\n\n'), webSnapshotMode())
  } finally {
    try {
      queued.resolve(undefined)
      await channel?.dispose()
    } finally {
      try { await scaffold?.close() }
      finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
    }
  }
})
