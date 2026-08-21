import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, XiaojingWeixinChannel } from '../src/index.ts'
import { WeixinStateStore } from '../src/state.ts'

type Listener = (...args: unknown[]) => unknown

function createListenerHarness(): {
  listeners: Map<string, Listener[]>
  on: (name: string, listener: Listener, options?: { prepend?: boolean }) => void
  emit: (name: string, ...args: unknown[]) => void
} {
  const listeners = new Map<string, Listener[]>()
  const on = (name: string, listener: Listener, options?: { prepend?: boolean }): void => {
    const rows = listeners.get(name) ?? []
    if (options?.prepend === true) rows.unshift(listener)
    else rows.push(listener)
    listeners.set(name, rows)
  }
  const emit = (name: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(name) ?? []) listener(...args)
  }
  return { listeners, on, emit }
}

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input.toString()
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new TypeError('expected a string request body')
  return init.body
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('condition did not settle')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('Xiaojing Weixin assembled channel', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
  })

  it('defaults visible long-task progress to 30-second intervals', () => {
    expect(Config({}).progressHeartbeatMs).toBe(30_000)
  })

  it('recovers a state-write failure, serializes tasks, confirms risky work, deduplicates input, and formats replies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiaojing-weixin-channel-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const store = new WeixinStateStore(join(root, 'state.json'))
    const sessionId = '11111111-1111-4111-8111-111111111111'
    await store.save({
      schemaVersion: 2,
      accountId: 'bot-account@im.bot',
      ownerUserId: 'owner-user',
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      sessionId,
      sessionReady: false,
      updatesCursor: '',
      pending: [],
      completedMessageIds: [],
    })
    vi.spyOn(WeixinStateStore.prototype, 'save')
      .mockRejectedValueOnce(new Error('simulated transient state write failure'))

    const outbound: string[] = []
    let updateBatch = 0
    let approvalCode: string | undefined
    const approvalAvailable = Promise.withResolvers<undefined>()
    const heartbeatAvailable = Promise.withResolvers<undefined>()
    let permissionCode: string | undefined
    const permissionCodeAvailable = Promise.withResolvers<undefined>()
    const tasksDone = Promise.withResolvers<undefined>()
    const permissionChanged = Promise.withResolvers<undefined>()
    let allBatchReceiptsVisibleAtFirstPrompt = false
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input)
      if (url.includes('/msg/notify')) return json({ ret: 0 })
      if (url.endsWith('/getconfig')) return json({ ret: 0 })
      if (url.endsWith('/sendmessage')) {
        const body = JSON.parse(requestBody(init)) as { msg: { item_list: Array<{ text_item: { text: string } }> } }
        const text = body.msg.item_list[0]?.text_item.text ?? ''
        outbound.push(text)
        const found = text.match(/确认码：(\d{6})/)
        if (found?.[1] !== undefined && approvalCode === undefined) {
          approvalCode = found[1]
          approvalAvailable.resolve(undefined)
        }
        if (text.includes('任务仍在执行')) heartbeatAvailable.resolve(undefined)
        if (text.includes('确认启用 Full access') && found?.[1] !== undefined) {
          permissionCode = found[1]
          permissionCodeAvailable.resolve(undefined)
        }
        if (outbound.filter(item => item.includes('【处理完成】')).length === 2) {
          tasksDone.resolve(undefined)
        }
        if (text.includes('权限已切换为 Full access')) permissionChanged.resolve(undefined)
        return json({ ret: 0 })
      }
      if (url.endsWith('/getupdates')) {
        updateBatch += 1
        if (updateBatch <= 2) {
          const first = {
            client_id: 'first-task', from_user_id: 'owner-user', context_token: 'ctx-first',
            item_list: [{ type: 1, text_item: { text: '删除测试文件前先确认' } }],
          }
          return json({
            ret: 0,
            get_updates_buf: 'cursor-1',
            msgs: [
              first,
              {
                client_id: 'second-task', from_user_id: 'owner-user', context_token: 'ctx-second',
                item_list: [{ type: 1, text_item: { text: '汇总今天的结果' } }],
              },
              first,
            ],
          })
        }
        await approvalAvailable.promise
        if (updateBatch === 3) {
          return json({
            ret: 0,
            get_updates_buf: 'cursor-2',
            msgs: [
              {
                client_id: 'wrong-confirmation', from_user_id: 'owner-user', context_token: 'ctx-wrong',
                item_list: [{ type: 1, text_item: { text: '确认 000000' } }],
              },
              {
                client_id: 'malformed-confirmation', from_user_id: 'owner-user', context_token: 'ctx-malformed',
                item_list: [{ type: 1, text_item: { text: '确认' } }],
              },
            ],
          })
        }
        if (updateBatch === 4) {
          const confirmation = {
            client_id: 'right-confirmation', from_user_id: 'owner-user', context_token: 'ctx-right',
            item_list: [{ type: 1, text_item: { text: `确认${approvalCode}` } }],
          }
          return json({
            ret: 0,
            get_updates_buf: 'cursor-3',
            msgs: [confirmation, confirmation],
          })
        }
        if (updateBatch === 5) {
          await tasksDone.promise
          return json({
            ret: 0,
            get_updates_buf: 'cursor-4',
            msgs: [{
              client_id: 'permission-request', from_user_id: 'owner-user', context_token: 'ctx-permission-request',
              item_list: [{ type: 1, text_item: { text: '权限 full access' } }],
            }],
          })
        }
        if (updateBatch === 6) {
          await permissionCodeAvailable.promise
          return json({
            ret: 0,
            get_updates_buf: 'cursor-5',
            msgs: [{
              client_id: 'permission-confirm', from_user_id: 'owner-user', context_token: 'ctx-permission-confirm',
              item_list: [{ type: 1, text_item: { text: `确认权限 ${permissionCode}` } }],
            }],
          })
        }
        if (updateBatch === 7) {
          await permissionChanged.promise
          return json({
            ret: 0,
            get_updates_buf: 'cursor-6',
            msgs: [{
              client_id: 'permission-downgrade', from_user_id: 'owner-user', context_token: 'ctx-permission-downgrade',
              item_list: [{ type: 1, text_item: { text: '权限 workspace write' } }],
            }],
          })
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
        })
      }
      throw new Error(`unexpected iLink endpoint: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { listeners, on, emit } = createListenerHarness()
    const disposers: Array<() => unknown> = []
    const approval = async (request: unknown): Promise<unknown> => {
      const listener = listeners.get('approval/request')?.[0]
      if (listener === undefined) throw new Error('approval listener missing')
      return await listener(request, () => Promise.resolve('unavailable'))
    }

    let turn = 0
    const agent = {
      session: { id: sessionId, header: { id: sessionId }, events: [] },
      ctx: {
        tools: {
          get: () => ({}),
          register: vi.fn(() => () => undefined),
          restrict: vi.fn(() => () => undefined),
        },
        systemPrompt: { context: vi.fn(() => () => undefined) },
      },
      whenIdle: () => Promise.resolve(),
    }
    let token: string | undefined = 'private-token'
    let currentPermission = 'workspace-write'
    const executeCommand = vi.fn(async (_agent: unknown, line: string) => {
      currentPermission = line.endsWith('danger-full-access') ? 'danger-full-access' : 'workspace-write'
      return { commandId: 'permission-command', result: { kind: 'success' as const, text: `preset ${currentPermission}` } }
    })
    const rename = vi.fn(async () => ({ result: { ok: true, value: { title: '微信助手', seq: 0 } } }))
    const prompt = vi.fn(async (request: { rpcId: string; payload: { content: Array<{ text: string }> } }) => {
      turn += 1
      const currentTurn = turn
      if (currentTurn === 1) {
        allBatchReceiptsVisibleAtFirstPrompt = outbound.includes('✅ 已收到，已进入队列（前面还有 1 个任务）。')
      }
      emit('agent/inbox/claimed', {
        agent,
        message: { role: 'user', content: request.payload.content, source: { rpcId: request.rpcId } },
        turn: currentTurn,
      })
      const instruction = request.payload.content[0]?.text ?? ''
      if (instruction.includes('删除')) {
        await heartbeatAvailable.promise
        const outcome = await approval({ agent, toolName: 'computer_control', reason: '将删除测试文件' })
        expect(outcome).toBe('allowed-once')
      }
      emit('session/event', agent.session, {
        type: 'assistant/message', seq: currentTurn * 2, time: Date.now(),
        data: {
          turn: currentTurn,
          message: { role: 'assistant', content: [{ type: 'text', text: `# 处理完成\n\n**结果：** 已处理“${instruction}”。` }] },
        },
      })
      emit('session/event', agent.session, {
        type: 'turn/end', seq: currentTurn * 2 + 1, time: Date.now(),
        data: { turn: currentTurn, reason: { kind: 'completed' } },
      })
      return { result: { ok: true, value: { accepted: true } } }
    })
    const rpcHandle = vi.fn(() => () => undefined)
    const ctx = {
      connection: { rpc: { handle: rpcHandle } },
      credentials: {
        resolve: vi.fn(async () => token === undefined ? undefined : { value: token }),
        set: vi.fn(async (_ref: unknown, value: string) => { token = value }),
        unset: vi.fn(async () => { token = undefined }),
      },
      apiProxy: { sessions: {
        create: vi.fn(async () => ({ result: { ok: true, value: { sessionId } } })),
        rename,
        prompt,
        history: vi.fn(),
        cancel: vi.fn(async () => ({ result: { ok: true, value: { accepted: true } } })),
      } },
      agents: { get: () => agent },
      commands: { execute: executeCommand },
      permissionPresets: { current: vi.fn(() => currentPermission) },
      logger: { warn: vi.fn() },
      on,
      effect: (factory: () => unknown) => {
        const dispose = factory()
        if (typeof dispose === 'function') disposers.push(dispose as () => unknown)
      },
    } as unknown as Context

    const channel = new XiaojingWeixinChannel(ctx, {
      stateDir: root,
      requestTimeoutMs: 1_000,
      longPollTimeoutMs: 5_000,
      retryDelayMs: 10,
      backoffDelayMs: 20,
      mediaTransferTimeoutMs: 5_000,
      approvalTimeoutMs: 2_000,
      progressHeartbeatMs: 10,
      maxReplyChars: 3_500,
      mediaDir: join(root, 'uploads'),
      maxMediaBytes: 100 * 1024 * 1024,
      totalMediaBytes: 1024 * 1024 * 1024,
    })
    channel.install()
    await channel.start()

    try {
      await waitFor(() => outbound.some(text => text.includes('权限已切换为 Workspace Write')), 3_000)
    } catch {
      throw new Error(`channel stalled after ${updateBatch} update batches; outbound=${JSON.stringify(outbound)}`)
    }
    expect(prompt.mock.calls.map(call => call[0].payload.content[0]?.text)).toEqual([
      '删除测试文件前先确认',
      '汇总今天的结果',
    ])
    expect(outbound).toContain('✅ 已收到，正在执行。')
    expect(outbound).toContain('✅ 已收到，已进入队列（前面还有 1 个任务）。')
    expect(allBatchReceiptsVisibleAtFirstPrompt).toBe(true)
    expect(outbound.some(text => text.includes('任务仍在执行'))).toBe(true)
    expect(outbound.some(text => text.includes('已用时约 1 秒'))).toBe(true)
    expect(outbound.some(text => text.includes('确认码无效或已过期'))).toBe(true)
    expect(outbound.some(text => text.includes('格式不正确'))).toBe(true)
    expect(outbound.filter(text => text.includes('已确认，继续执行'))).toHaveLength(1)
    expect(outbound.filter(text => text.includes('已处理“')).length).toBe(2)
    expect(outbound.some(text => text.includes('确认启用 Full access'))).toBe(true)
    expect(outbound.some(text => text.includes('权限已切换为 Full access'))).toBe(true)
    expect(executeCommand.mock.calls.map(call => call[1])).toEqual([
      '/permission danger-full-access',
      '/permission workspace-write',
    ])
    expect(rename).toHaveBeenCalledTimes(1)

    await waitFor(async () => (await store.load()).pending.length === 0)
    await waitFor(async () => (await store.load()).completedMessageIds.includes('client:permission-downgrade'))
    const persisted = await store.load()
    expect(persisted.sessionReady).toBe(true)
    expect(persisted.pending).toEqual([])
    expect(persisted.completedMessageIds).toEqual([
      'client:wrong-confirmation',
      'client:malformed-confirmation',
      'client:right-confirmation',
      'client:first-task',
      'client:second-task',
      'client:permission-request',
      'client:permission-confirm',
      'client:permission-downgrade',
    ])

    await channel.dispose()
    for (const dispose of disposers) await dispose()
  })

  it('cancels an active Agent turn and waits for quiescence before releasing the channel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiaojing-weixin-dispose-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const sessionId = '22222222-2222-4222-8222-222222222222'
    await new WeixinStateStore(join(root, 'state.json')).save({
      schemaVersion: 2,
      accountId: 'bot-account@im.bot',
      ownerUserId: 'owner-user',
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      sessionId,
      sessionReady: true,
      updatesCursor: '',
      pending: [],
      completedMessageIds: [],
    })

    let polls = 0
    const outbound: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input)
      if (url.includes('/msg/notify') || url.endsWith('/getconfig')) return json({ ret: 0 })
      if (url.endsWith('/sendmessage')) {
        const body = JSON.parse(requestBody(init)) as { msg: { item_list: Array<{ text_item: { text: string } }> } }
        outbound.push(body.msg.item_list[0]?.text_item.text ?? '')
        return json({ ret: 0 })
      }
      if (url.endsWith('/getupdates')) {
        polls += 1
        if (polls === 1) {
          return json({
            ret: 0,
            get_updates_buf: 'cursor-1',
            msgs: [{
              client_id: 'long-task', from_user_id: 'owner-user', context_token: 'ctx-long',
              item_list: [{ type: 1, text_item: { text: '执行一个需要等待的任务' } }],
            }],
          })
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
        })
      }
      throw new Error(`unexpected iLink endpoint: ${url}`)
    }))

    const { on, emit } = createListenerHarness()
    const idle = Promise.withResolvers<undefined>()
    const agent = {
      session: { id: sessionId, header: { id: sessionId } },
      ctx: {
        tools: {
          get: () => undefined,
          register: vi.fn(() => () => undefined),
          restrict: vi.fn(() => () => undefined),
        },
        systemPrompt: { context: vi.fn(() => () => undefined) },
      },
      whenIdle: vi.fn(() => idle.promise),
    }
    const prompt = vi.fn(async (request: { rpcId: string; payload: { content: Array<{ text: string }> } }) => {
      emit('agent/inbox/claimed', {
        agent,
        message: { role: 'user', content: request.payload.content, source: { rpcId: request.rpcId } },
        turn: 1,
      })
      return { result: { ok: true, value: { accepted: true } } }
    })
    const cancel = vi.fn(async () => ({ result: { ok: true, value: { accepted: true } } }))
    const ctx = {
      connection: { rpc: { handle: () => () => undefined } },
      credentials: {
        resolve: vi.fn(async () => ({ value: 'private-token' })),
        unset: vi.fn(),
      },
      apiProxy: { sessions: {
        create: vi.fn(async () => ({ result: { ok: true, value: { sessionId } } })),
        rename: vi.fn(),
        prompt,
        history: vi.fn(),
        cancel,
      } },
      agents: { get: () => agent },
      logger: { warn: vi.fn() },
      on,
      effect: (factory: () => unknown) => { factory() },
    } as unknown as Context
    const channel = new XiaojingWeixinChannel(ctx, {
      stateDir: root,
      requestTimeoutMs: 1_000,
      longPollTimeoutMs: 5_000,
      retryDelayMs: 10,
      backoffDelayMs: 20,
      mediaTransferTimeoutMs: 5_000,
      approvalTimeoutMs: 2_000,
      progressHeartbeatMs: 60_000,
      maxReplyChars: 3_500,
      mediaDir: join(root, 'uploads'),
      maxMediaBytes: 100 * 1024 * 1024,
      totalMediaBytes: 1024 * 1024 * 1024,
    })
    channel.install()
    await channel.start()
    await waitFor(() => prompt.mock.calls.length === 1)

    let disposed = false
    const disposal = channel.dispose().then(() => { disposed = true })
    await waitFor(() => cancel.mock.calls.length > 0)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(disposed).toBe(false)
    idle.resolve(undefined)
    await disposal

    expect(agent.whenIdle).toHaveBeenCalled()
    expect(outbound).toEqual(['✅ 已收到，正在执行。'])
  })
})
