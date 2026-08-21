import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WeixinMediaStore,
  inspectOutboundWeixinMedia,
  receiveWeixinMedia,
  sendOutboundWeixinMedia,
} from '../src/media.ts'
import { IlinkClient } from '../src/protocol.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-weixin-media-'))
  roots.push(root)
  return root
}

function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

function responseBody(content: Buffer): ArrayBuffer {
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer
}

describe('Weixin encrypted media transfer', () => {
  it('decrypts a document, sanitizes its filename, and publishes it in the upload directory', async () => {
    const root = await tempRoot()
    const plaintext = Buffer.from('invoice fixture')
    const key = randomBytes(16)
    const ciphertext = encrypt(plaintext, key)
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(responseBody(ciphertext), {
      status: 200,
      headers: { 'content-length': String(ciphertext.byteLength) },
    }))
    const client = new IlinkClient({ requestTimeoutMs: 1_000, longPollTimeoutMs: 5_000, mediaTransferTimeoutMs: 5_000, fetch })
    const store = new WeixinMediaStore({ root, maxFileBytes: 1024, totalMaxBytes: 2048 })
    const saved = await receiveWeixinMedia(client, {
      type: 4,
      file_item: {
        file_name: '../发票.pdf',
        media: {
          full_url: 'https://novac2c.cdn.weixin.qq.com/c2c/download?id=opaque',
          aes_key: Buffer.from(key.toString('hex'), 'ascii').toString('base64'),
        },
      },
    }, store)

    expect(saved).toMatchObject({
      kind: 'file', name: '发票.pdf', mediaType: 'application/pdf', bytes: plaintext.byteLength,
    })
    expect(await readFile(saved.path)).toEqual(plaintext)
    expect((fetch.mock.calls[0]?.[0] as URL).hostname).toBe('novac2c.cdn.weixin.qq.com')
  })

  it('rejects non-Tencent media URLs and aggregate quota overflow', async () => {
    const root = await tempRoot()
    const client = new IlinkClient({
      requestTimeoutMs: 1_000,
      longPollTimeoutMs: 5_000,
      mediaTransferTimeoutMs: 5_000,
      fetch: vi.fn<typeof globalThis.fetch>(),
    })
    const store = new WeixinMediaStore({ root, maxFileBytes: 16, totalMaxBytes: 4 })
    await expect(receiveWeixinMedia(client, {
      type: 2,
      image_item: { media: { full_url: 'https://example.com/image.png' } },
    }, store)).rejects.toThrow('non-official CDN')
    await store.save('first.bin', Buffer.from('1234'), 'file', 'application/octet-stream')
    await expect(store.save('second.bin', Buffer.from('1'), 'file', 'application/octet-stream'))
      .rejects.toThrow('存储空间已满')
  })

  it('uploads an approved local image and sends a structured image item', async () => {
    const root = await tempRoot()
    const path = join(root, 'result.png')
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('fixture'),
    ])
    await writeFile(path, png)
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : input.toString()
      calls.push(init === undefined ? { url } : { url, init })
      if (url.endsWith('/ilink/bot/getuploadurl')) {
        return json({ upload_full_url: 'https://novac2c.cdn.weixin.qq.com/c2c/upload?id=opaque' })
      }
      if (url.includes('/c2c/upload')) {
        return new Response('', { status: 200, headers: { 'x-encrypted-param': 'download-opaque' } })
      }
      if (url.endsWith('/ilink/bot/sendmessage')) return json({ ret: 0 })
      throw new Error(`unexpected request ${url}`)
    })
    const client = new IlinkClient({ requestTimeoutMs: 1_000, longPollTimeoutMs: 5_000, mediaTransferTimeoutMs: 5_000, fetch })
    const inspected = await inspectOutboundWeixinMedia(path, 1024)
    await sendOutboundWeixinMedia(client, inspected, {
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      token: 'private-token',
      toUserId: 'owner@im.bot',
      contextToken: 'private-context',
    }, '处理结果')

    expect(calls.map(call => call.url)).toEqual([
      'https://ilinkai.weixin.qq.com/ilink/bot/getuploadurl',
      'https://novac2c.cdn.weixin.qq.com/c2c/upload?id=opaque',
      'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage',
      'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage',
    ])
    const uploadRequest = JSON.parse(calls[0]?.init?.body as string) as Record<string, unknown>
    expect(uploadRequest).toMatchObject({ media_type: 1, rawsize: png.byteLength, to_user_id: 'owner@im.bot' })
    expect(uploadRequest).not.toHaveProperty('context_token')
    const mediaRequest = JSON.parse(calls[3]?.init?.body as string) as {
      msg: { context_token: string; item_list: Array<Record<string, unknown>> }
    }
    expect(mediaRequest.msg.context_token).toBe('private-context')
    expect(mediaRequest.msg.item_list[0]).toMatchObject({
      type: 2,
      image_item: {
        media: { encrypt_query_param: 'download-opaque', encrypt_type: 1 },
      },
    })
  })

  it('rejects a file replaced after its approval metadata was captured', async () => {
    const root = await tempRoot()
    const path = join(root, 'result.txt')
    await writeFile(path, 'first')
    const inspected = await inspectOutboundWeixinMedia(path, 1024)
    await rm(path)
    await writeFile(path, 'other')
    const client = new IlinkClient({
      requestTimeoutMs: 1_000,
      longPollTimeoutMs: 5_000,
      mediaTransferTimeoutMs: 5_000,
      fetch: vi.fn<typeof globalThis.fetch>(),
    })
    await expect(sendOutboundWeixinMedia(client, inspected, {
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      token: 'private-token',
      toUserId: 'owner@im.bot',
      contextToken: 'private-context',
    }, undefined)).rejects.toThrow('确认后发生了变化')
  })
})
