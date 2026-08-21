import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { XiaojingWeixinChannel } from '../src/index.ts'
import { WeixinStateStore } from '../src/state.ts'

type Listener = (...args: unknown[]) => unknown

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

function responseBody(content: Buffer): ArrayBuffer {
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('condition did not settle')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('Xiaojing Weixin media assembly', () => {
  const roots: string[] = []

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('decrypts an inbound document and logs its safe local reference in the Agent turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiaojing-weixin-media-channel-'))
    roots.push(root)
    const mediaDir = join(root, 'uploads')
    const sessionId = '33333333-3333-4333-8333-333333333333'
    const store = new WeixinStateStore(join(root, 'state.json'))
    await store.save({
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

    const plaintext = Buffer.from('spreadsheet fixture')
    const key = randomBytes(16)
    const ciphertext = encrypt(plaintext, key)
    let polls = 0
    const outbound: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('/msg/notify') || url.endsWith('/getconfig')) return json({ ret: 0 })
      if (url.includes('/c2c/download')) return new Response(responseBody(ciphertext), { status: 200 })
      if (url.endsWith('/sendmessage')) {
        const body = JSON.parse(init?.body as string) as {
          msg: { item_list: Array<{ text_item?: { text?: string } }> }
        }
        const text = body.msg.item_list[0]?.text_item?.text
        if (text !== undefined) outbound.push(text)
        return json({ ret: 0 })
      }
      if (url.endsWith('/getupdates')) {
        polls += 1
        if (polls === 1) {
          return json({
            ret: 0,
            get_updates_buf: 'cursor-1',
            msgs: [{
              client_id: 'document-task',
              from_user_id: 'owner-user',
              context_token: 'context-document',
              item_list: [{
                type: 4,
                file_item: {
                  file_name: '../采购单.xlsx',
                  len: String(plaintext.byteLength),
                  media: {
                    full_url: 'https://novac2c.cdn.weixin.qq.com/c2c/download?id=document',
                    aes_key: Buffer.from(key.toString('hex'), 'ascii').toString('base64'),
                  },
                },
              }],
            }],
          })
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
        })
      }
      throw new Error(`unexpected request: ${url}`)
    }))

    const listeners = new Map<string, Listener[]>()
    const on = (name: string, listener: Listener): void => {
      listeners.set(name, [...listeners.get(name) ?? [], listener])
    }
    const emit = (name: string, ...args: unknown[]): void => {
      for (const listener of listeners.get(name) ?? []) listener(...args)
    }
    const agent = {
      session: { id: sessionId, header: { id: sessionId }, events: [] },
      ctx: {
        tools: {
          get: () => undefined,
          register: vi.fn(() => () => undefined),
          restrict: vi.fn(() => () => undefined),
        },
        systemPrompt: { context: vi.fn(() => () => undefined) },
      },
      whenIdle: () => Promise.resolve(),
    }
    const prompt = vi.fn(async (request: { rpcId: string; payload: { content: Array<{ text: string }> } }) => {
      emit('agent/inbox/claimed', {
        agent,
        message: { role: 'user', content: request.payload.content, source: { rpcId: request.rpcId } },
        turn: 1,
      })
      emit('session/event', agent.session, {
        type: 'assistant/message', seq: 1, time: Date.now(),
        data: { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: '文件已接收。' }] } },
      })
      emit('session/event', agent.session, {
        type: 'turn/end', seq: 2, time: Date.now(),
        data: { turn: 1, reason: { kind: 'completed' } },
      })
      return { result: { ok: true, value: { accepted: true } } }
    })
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
        cancel: vi.fn(async () => ({ result: { ok: true, value: { accepted: true } } })),
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
      mediaDir,
      maxMediaBytes: 1024,
      totalMediaBytes: 2048,
    })
    channel.install()
    await channel.start()

    await waitFor(() => outbound.includes('文件已接收。'))
    const submitted = prompt.mock.calls[0]?.[0].payload.content[0]?.text ?? ''
    expect(submitted).toContain('采购单.xlsx')
    expect(submitted).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(submitted).toContain(mediaDir)
    expect(submitted).not.toContain('context-document')
    expect(submitted).not.toContain(key.toString('hex'))
    expect(await readFile(join(mediaDir, '采购单.xlsx'))).toEqual(plaintext)
    await waitFor(async () => (await store.load()).completedMessageIds.includes('client:document-task'))

    await channel.dispose()
  })

  it('waits for an in-chat code before uploading and sending a local document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiaojing-weixin-outbound-channel-'))
    roots.push(root)
    const mediaDir = join(root, 'uploads')
    const filePath = join(root, '月报.pdf')
    await writeFile(filePath, 'monthly report')
    const sessionId = '44444444-4444-4444-8444-444444444444'
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
    let confirmationCode: string | undefined
    const codeReady = Promise.withResolvers<undefined>()
    const requestOrder: string[] = []
    const sentItems: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : input.toString()
      requestOrder.push(url)
      if (url.includes('/msg/notify') || url.endsWith('/getconfig')) return json({ ret: 0 })
      if (url.endsWith('/getuploadurl')) {
        return json({ upload_full_url: 'https://novac2c.cdn.weixin.qq.com/c2c/upload?id=report' })
      }
      if (url.includes('/c2c/upload')) {
        return new Response('', { status: 200, headers: { 'x-encrypted-param': 'download-report' } })
      }
      if (url.endsWith('/sendmessage')) {
        const body = JSON.parse(init?.body as string) as { msg: { item_list: Array<Record<string, unknown>> } }
        const item = body.msg.item_list[0] ?? {}
        sentItems.push(item)
        const text = (item.text_item as { text?: string } | undefined)?.text
        const found = text?.match(/确认码：(\d{6})/u)
        if (text?.includes('操作：weixin_send_file') && found?.[1] !== undefined) {
          confirmationCode = found[1]
          codeReady.resolve(undefined)
        }
        return json({ ret: 0 })
      }
      if (url.endsWith('/getupdates')) {
        polls += 1
        if (polls === 1) {
          return json({
            ret: 0,
            get_updates_buf: 'cursor-1',
            msgs: [{
              client_id: 'send-report',
              from_user_id: 'owner-user',
              context_token: 'context-report',
              item_list: [{ type: 1, text_item: { text: '把月报 PDF 发给我' } }],
            }],
          })
        }
        if (polls === 2) {
          await codeReady.promise
          const confirmation = {
            client_id: 'confirm-report',
            from_user_id: 'owner-user',
            context_token: 'context-confirm-report',
            item_list: [{ type: 1, text_item: { text: `确认${confirmationCode}` } }],
          }
          return json({
            ret: 0,
            get_updates_buf: 'cursor-2',
            msgs: [confirmation, confirmation],
          })
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
        })
      }
      throw new Error(`unexpected request: ${url}`)
    }))

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
    let sendTool: ToolDefinition | undefined
    const agent = {
      session: { id: sessionId, header: { id: sessionId }, events: [] },
      ctx: {
        tools: {
          get: () => undefined,
          register: vi.fn((tool: ToolDefinition) => {
            if (tool.name === 'weixin_send_file') sendTool = tool
            return () => undefined
          }),
          restrict: vi.fn(() => () => undefined),
        },
        systemPrompt: { context: vi.fn(() => () => undefined) },
      },
      whenIdle: () => Promise.resolve(),
    }
    const prompt = vi.fn(async (request: { rpcId: string; payload: { content: Array<{ text: string }> } }) => {
      emit('agent/inbox/claimed', {
        agent,
        message: { role: 'user', content: request.payload.content, source: { rpcId: request.rpcId } },
        turn: 1,
      })
      if (sendTool === undefined) throw new Error('weixin_send_file was not registered')
      const result = await sendTool.execute({ file_path: filePath, caption: '月报处理结果' }, {
        agent,
        name: 'weixin_send_file',
        callId: 'call-send-report',
        signal: new AbortController().signal,
      } as unknown as ToolRunContext)
      expect(result).toMatchObject({ sent: true, name: '月报.pdf', kind: 'file' })
      emit('session/event', agent.session, {
        type: 'assistant/message', seq: 1, time: Date.now(),
        data: { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: '月报已经发送。' }] } },
      })
      emit('session/event', agent.session, {
        type: 'turn/end', seq: 2, time: Date.now(),
        data: { turn: 1, reason: { kind: 'completed' } },
      })
      return { result: { ok: true, value: { accepted: true } } }
    })
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
        cancel: vi.fn(async () => ({ result: { ok: true, value: { accepted: true } } })),
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
      mediaDir,
      maxMediaBytes: 1024,
      totalMediaBytes: 2048,
    })
    channel.install()
    await channel.start()

    await waitFor(() => sentItems.some(item => item.type === 4))
    await waitFor(() => sentItems.some(item => (item.text_item as { text?: string } | undefined)?.text === '月报已经发送。'))
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(sentItems.filter(item => item.type === 4)).toHaveLength(1)
    expect(sentItems.some(item => (item.text_item as { text?: string } | undefined)?.text?.includes('确认码：'))).toBe(true)
    const sentFile = sentItems.find(item => item.type === 4)
    const fileItem = sentFile?.file_item
    if (typeof fileItem !== 'object' || fileItem === null) throw new Error('file item was not sent')
    const media = (fileItem as Record<string, unknown>).media
    if (typeof media !== 'object' || media === null) throw new Error('file media reference was not sent')
    expect((fileItem as Record<string, unknown>).file_name).toBe('月报.pdf')
    expect((media as Record<string, unknown>).encrypt_query_param).toBe('download-report')
    const updateRequests = requestOrder
      .map((url, index) => ({ url, index }))
      .filter(request => request.url.endsWith('/getupdates'))
    const uploadRequest = requestOrder.findIndex(url => url.endsWith('/getuploadurl'))
    expect(uploadRequest).toBeGreaterThan(updateRequests[1]?.index ?? Number.POSITIVE_INFINITY)

    await channel.dispose()
  })
})
