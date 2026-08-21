import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

function downloadClient(content: Buffer): IlinkClient {
  return {
    downloadMedia: vi.fn(() => Promise.resolve(content)),
  } as unknown as IlinkClient
}

describe('Weixin encrypted media transfer', () => {
  it.each([
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', '.png'],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg', '.jpg'],
    ['gif', Buffer.from('GIF89a'), 'image/gif', '.gif'],
    ['webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), 'image/webp', '.webp'],
    ['bmp', Buffer.from('BMfixture'), 'image/bmp', '.bmp'],
    ['unknown', Buffer.from('plain'), 'application/octet-stream', '.bin'],
  ])('identifies an inbound %s image by magic bytes', async (_label, content, mediaType, extension) => {
    const root = await tempRoot()
    const store = new WeixinMediaStore({ root, maxFileBytes: 1024, totalMaxBytes: 4096 })

    const saved = await receiveWeixinMedia(downloadClient(content), {
      type: 2,
      image_item: { media: { full_url: 'https://novac2c.cdn.weixin.qq.com/image' } },
    }, store)

    expect(saved).toMatchObject({ kind: 'image', mediaType, bytes: content.byteLength })
    expect(saved.name).toMatch(new RegExp(`${extension.replace('.', '\\.')}$`, 'u'))
  })

  it.each([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0x00, 0xd8, 0xff]),
    Buffer.from([0xff, 0x00, 0xff]),
    Buffer.from([0xff, 0xd8, 0x00]),
    Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('NOPE')]),
  ])('falls back safely for incomplete or near-match image bytes', async (content) => {
    const root = await tempRoot()
    const store = new WeixinMediaStore({ root, maxFileBytes: 1024, totalMaxBytes: 4096 })

    const saved = await receiveWeixinMedia(downloadClient(content), {
      type: 2,
      image_item: { media: { full_url: 'https://novac2c.cdn.weixin.qq.com/image' } },
    }, store)

    expect(saved.mediaType).toBe('application/octet-stream')
  })

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

  it('sanitizes empty, reserved, long, and duplicate inbound names', async () => {
    const root = await tempRoot()
    const store = new WeixinMediaStore({ root, maxFileBytes: 1024, totalMaxBytes: 16_384 })

    const empty = await store.save('', Buffer.from('a'), 'file', 'application/octet-stream')
    const reserved = await store.save('.upload-private.txt', Buffer.from('b'), 'file', 'text/plain')
    const long = await store.save(`${'长'.repeat(200)}.pdf`, Buffer.from('c'), 'file', 'application/pdf')
    const first = await store.save('same.txt', Buffer.from('d'), 'file', 'text/plain')
    const second = await store.save('same.txt', Buffer.from('e'), 'file', 'text/plain')

    expect(empty.name).toBe('weixin-file.bin')
    expect(reserved.name).toBe('upload-private.txt')
    expect(Array.from(long.name)).toHaveLength(180)
    expect(first.name).toBe('same.txt')
    expect(second.name).toBe('same (1).txt')
  })

  it('enforces the per-file limit and continues serial mutations after a rejected save', async () => {
    const root = await tempRoot()
    const store = new WeixinMediaStore({ root, maxFileBytes: 2, totalMaxBytes: 100 })

    await expect(store.save('large.bin', Buffer.from('123'), 'file', 'application/octet-stream'))
      .rejects.toThrow('单文件大小限制')
    await expect(store.save('small.bin', Buffer.from('12'), 'file', 'application/octet-stream'))
      .resolves.toMatchObject({ name: 'small.bin', bytes: 2 })
  })

  it('removes only regular files inside its own root', async () => {
    const root = await tempRoot()
    const store = new WeixinMediaStore({ root, maxFileBytes: 1024, totalMaxBytes: 4096 })
    const saved = await store.save('remove.txt', Buffer.from('x'), 'file', 'text/plain')
    const directory = join(root, 'directory')
    await mkdir(directory)

    await store.remove(root)
    await store.remove(join(root, 'missing.txt'))
    await store.remove(directory)
    await store.remove(join(root, '..', 'outside.txt'))
    await store.remove(saved.path)
    await expect(readFile(saved.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(store.remove(`${join(root, 'bad')}\0`)).rejects.toThrow()
  })

  it('ignores directories and private temporary files when enforcing aggregate quota', async () => {
    const root = await tempRoot()
    const store = new WeixinMediaStore({ root, maxFileBytes: 1024, totalMaxBytes: 2 })
    await mkdir(root, { recursive: true })
    await mkdir(join(root, 'directory'))
    await writeFile(join(root, '.upload-leftover.tmp'), Buffer.alloc(100))

    await expect(store.save('visible.bin', Buffer.from('12'), 'file', 'application/octet-stream'))
      .resolves.toMatchObject({ bytes: 2 })
  })

  it('validates inbound media references and AES key encodings', async () => {
    const root = await tempRoot()
    const store = new WeixinMediaStore({ root, maxFileBytes: 1024, totalMaxBytes: 4096 })
    const key = randomBytes(16)
    const plaintext = Buffer.from('image')
    const ciphertext = encrypt(plaintext, key)

    await expect(receiveWeixinMedia(downloadClient(ciphertext), {
      type: 2,
      image_item: {
        media: {
          full_url: 'https://novac2c.cdn.weixin.qq.com/image',
          aes_key: key.toString('base64'),
        },
      },
    }, store)).resolves.toMatchObject({ bytes: plaintext.byteLength })
    await expect(receiveWeixinMedia(downloadClient(ciphertext), {
      type: 2,
      image_item: {
        aeskey: key.toString('hex'),
        media: { full_url: 'https://novac2c.cdn.weixin.qq.com/image' },
      },
    }, store)).resolves.toMatchObject({ bytes: plaintext.byteLength })

    await expect(receiveWeixinMedia(downloadClient(Buffer.alloc(0)), { type: 2 }, store))
      .rejects.toThrow('图片缺少下载信息')
    await expect(receiveWeixinMedia(downloadClient(Buffer.alloc(0)), {
      type: 2, image_item: { aeskey: 'invalid', media: { full_url: 'https://novac2c.cdn.weixin.qq.com/x' } },
    }, store)).rejects.toThrow('加密信息无效')
    await expect(receiveWeixinMedia(downloadClient(Buffer.alloc(0)), { type: 4, file_item: {} }, store))
      .rejects.toThrow('文件缺少加密下载信息')
    await expect(receiveWeixinMedia(downloadClient(Buffer.alloc(0)), {
      type: 4,
      file_item: { media: { full_url: 'https://novac2c.cdn.weixin.qq.com/x', aes_key: 'invalid' } },
    }, store)).rejects.toThrow('AES key is invalid')
    await expect(receiveWeixinMedia(downloadClient(Buffer.alloc(0)), { type: 5 }, store))
      .rejects.toThrow('媒体类型不受支持')
  })

  it('uses a safe default name and MIME type for unnamed inbound documents', async () => {
    const root = await tempRoot()
    const store = new WeixinMediaStore({ root, maxFileBytes: 1024, totalMaxBytes: 4096 })
    const key = randomBytes(16)
    const plaintext = Buffer.from('file')

    const saved = await receiveWeixinMedia(downloadClient(encrypt(plaintext, key)), {
      type: 4,
      file_item: {
        media: { full_url: 'https://novac2c.cdn.weixin.qq.com/x', aes_key: key.toString('base64') },
      },
    }, store)

    expect(saved).toMatchObject({ name: '微信文件.bin', mediaType: 'application/octet-stream' })
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

  it('rejects relative, non-file, and oversized outbound paths', async () => {
    const root = await tempRoot()
    const directory = join(root, 'directory')
    await mkdir(directory)
    const large = join(root, 'large.txt')
    await writeFile(large, 'large')

    await expect(inspectOutboundWeixinMedia('relative.txt', 10)).rejects.toThrow('必须是绝对路径')
    await expect(inspectOutboundWeixinMedia(directory, 10)).rejects.toThrow('普通文件')
    await expect(inspectOutboundWeixinMedia(large, 2)).rejects.toThrow('大小限制')
    await expect(inspectOutboundWeixinMedia(large, 10)).resolves.toMatchObject({ kind: 'file', name: 'large.txt' })
  })

  it('uploads and sends a captionless document item', async () => {
    const root = await tempRoot()
    const path = join(root, 'result.txt')
    await writeFile(path, 'result')
    const inspected = await inspectOutboundWeixinMedia(path, 1024)
    const getUploadTarget = vi.fn<IlinkClient['getUploadTarget']>(() => Promise.resolve({ uploadParam: 'upload' }))
    const uploadMedia = vi.fn<IlinkClient['uploadMedia']>(() => Promise.resolve('download'))
    const sendMedia = vi.fn<IlinkClient['sendMedia']>(() => Promise.resolve())
    const fake = {
      getUploadTarget,
      uploadMedia,
      sendMedia,
    } as unknown as IlinkClient

    await sendOutboundWeixinMedia(fake, inspected, {
      baseUrl: 'https://ilinkai.weixin.qq.com/', token: 'token', toUserId: 'owner', contextToken: 'context',
    }, undefined)

    expect(getUploadTarget.mock.calls[0]?.[2]).toMatchObject({ mediaType: 3 })
    expect(sendMedia.mock.calls[0]?.[4]).toMatchObject({ type: 4, file_item: { file_name: 'result.txt' } })
    expect(sendMedia.mock.calls[0]?.[5]).toBeUndefined()
  })

  it('rejects a size change after outbound approval', async () => {
    const root = await tempRoot()
    const path = join(root, 'result.txt')
    await writeFile(path, 'first')
    const inspected = await inspectOutboundWeixinMedia(path, 1024)
    await writeFile(path, 'longer replacement')

    await expect(sendOutboundWeixinMedia({} as IlinkClient, inspected, {
      baseUrl: 'https://ilinkai.weixin.qq.com/', token: 'token', toUserId: 'owner', contextToken: 'context',
    }, undefined)).rejects.toThrow('确认后发生了变化')
  })
})
