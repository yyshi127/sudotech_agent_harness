import { afterEach, describe, expect, it, vi } from 'vitest'
import { IlinkClient, normalizeOfficialIlinkBaseUrl } from '../src/protocol.ts'

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

function client(fetch: typeof globalThis.fetch, timeoutMs = 1_000): IlinkClient {
  return new IlinkClient({
    requestTimeoutMs: timeoutMs,
    longPollTimeoutMs: timeoutMs,
    mediaTransferTimeoutMs: timeoutMs,
    fetch,
  })
}

function rejectsWhenAborted(): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal as AbortSignal
    const fail = () => { reject(new Error('transport aborted')) }
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  }))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Tencent iLink protocol adapter', () => {
  it('requests a bot_type=3 QR without exposing an Authorization header', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({
      qrcode: 'opaque-qr-id', qrcode_img_content: 'https://weixin.qq.com/x/qr-payload',
    }))
    const client = new IlinkClient({ requestTimeoutMs: 1_000, longPollTimeoutMs: 5_000, mediaTransferTimeoutMs: 5_000, fetch })
    await expect(client.startPairing()).resolves.toEqual({
      qrcode: 'opaque-qr-id', qrPayload: 'https://weixin.qq.com/x/qr-payload',
    })
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3')
    expect(new Headers(init.headers).get('authorization')).toBeNull()
    expect(new Headers(init.headers).get('authorizationtype')).toBe('ilink_bot_token')
    expect(JSON.parse(init.body as string)).toEqual({ local_token_list: [] })
  })

  it('uses global fetch and bounds duplicate-binding tokens', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({
      qrcode: 'opaque-qr-id', qrcode_img_content: 'qr-payload',
    }))
    vi.stubGlobal('fetch', fetch)
    const transport = new IlinkClient({ requestTimeoutMs: 1_000, longPollTimeoutMs: 1_000, mediaTransferTimeoutMs: 1_000 })

    await transport.startPairing(Array.from({ length: 12 }, (_, index) => `token-${index}`))

    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as { local_token_list: string[] }
    expect(body.local_token_list).toHaveLength(10)
  })

  it('submits verification and preserves the official redirect allowlist', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ status: 'need_verifycode' }))
    const client = new IlinkClient({ requestTimeoutMs: 1_000, longPollTimeoutMs: 5_000, mediaTransferTimeoutMs: 5_000, fetch })
    await expect(client.pairingStatus('opaque', '123456')).resolves.toEqual({ status: 'need_verifycode' })
    expect((fetch.mock.calls[0]?.[0] as URL).searchParams.get('verify_code')).toBe('123456')
    expect(normalizeOfficialIlinkBaseUrl('https://sh.ilinkai.weixin.qq.com/edge')).toBe('https://sh.ilinkai.weixin.qq.com/edge/')
    expect(normalizeOfficialIlinkBaseUrl('https://ilinkai.weixin.qq.com/path/?q=1#fragment')).toBe('https://ilinkai.weixin.qq.com/path/')
    expect(() => normalizeOfficialIlinkBaseUrl('https://example.com')).toThrow('non-official')
    expect(() => normalizeOfficialIlinkBaseUrl('http://ilinkai.weixin.qq.com')).toThrow('non-official')
  })

  it('turns pairing and update long-poll deadlines into idle responses', async () => {
    vi.useFakeTimers()
    const fetch = rejectsWhenAborted()
    const transport = client(fetch, 50)
    const pairing = transport.pairingStatus('opaque', undefined)
    await vi.advanceTimersByTimeAsync(50)
    await expect(pairing).resolves.toEqual({ status: 'wait' })

    const controller = new AbortController()
    const updates = transport.getUpdates('https://ilinkai.weixin.qq.com', 'token', 'cursor-1', 50, controller.signal)
    await vi.advanceTimersByTimeAsync(50)
    await expect(updates).resolves.toEqual({ ret: 0, msgs: [], get_updates_buf: 'cursor-1' })
  })

  it('preserves caller cancellation instead of reporting a timeout', async () => {
    const fetch = rejectsWhenAborted()
    const transport = client(fetch)
    const controller = new AbortController()
    const pairing = transport.pairingStatus('opaque', undefined, 'https://ilinkai.weixin.qq.com', controller.signal)
    controller.abort()

    await expect(pairing).rejects.toThrow('transport aborted')
  })

  it('validates update batches and carries the authenticated cursor', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({
      ret: 0,
      msgs: [{ message_id: 1, from_user_id: 'owner', context_token: 'context', item_list: [{ type: 1, text_item: { text: '你好' } }] }],
      get_updates_buf: 'cursor-2',
    }))
    const transport = client(fetch)

    await expect(transport.getUpdates(
      'https://ilinkai.weixin.qq.com', 'token', 'cursor-1', 1_000, new AbortController().signal,
    )).resolves.toMatchObject({ get_updates_buf: 'cursor-2' })
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.get_updates_buf).toBe('cursor-1')
  })

  it('propagates a non-timeout update transport failure', async () => {
    const transport = client(vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('network unavailable')))

    await expect(transport.getUpdates(
      'https://ilinkai.weixin.qq.com', 'token', 'cursor', 1_000, new AbortController().signal,
    )).rejects.toThrow('network unavailable')
  })

  it('sends one finished text item with the inbound context token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ ret: 0 }))
    const client = new IlinkClient({ requestTimeoutMs: 1_000, longPollTimeoutMs: 5_000, mediaTransferTimeoutMs: 5_000, fetch })
    await client.sendText('https://ilinkai.weixin.qq.com', 'secret-token', 'owner@im.bot', 'context-secret', '处理完成')
    const [, init] = fetch.mock.calls[0] as [URL, RequestInit]
    const headers = new Headers(init.headers)
    const body = JSON.parse(init.body as string) as { msg: Record<string, unknown> }
    expect(headers.get('authorization')).toBe('Bearer secret-token')
    expect(body.msg).toMatchObject({
      to_user_id: 'owner@im.bot',
      message_type: 2,
      message_state: 2,
      context_token: 'context-secret',
      item_list: [{ type: 1, text_item: { text: '处理完成' } }],
    })
  })

  it('rejects malformed external responses before channel state changes', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ status: 'future-state' }))
    const client = new IlinkClient({ requestTimeoutMs: 1_000, longPollTimeoutMs: 5_000, mediaTransferTimeoutMs: 5_000, fetch })
    await expect(client.pairingStatus('opaque', undefined)).rejects.toThrow()
  })

  it('reports HTTP and iLink send failures without echoing secrets', async () => {
    const http = client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', { status: 503 })))
    await expect(http.sendText(
      'https://ilinkai.weixin.qq.com', 'secret-token', 'owner', 'context', 'hello',
    )).rejects.toThrow('HTTP 503')

    const logical = client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ ret: -2 })))
    await expect(logical.sendText(
      'https://ilinkai.weixin.qq.com', 'secret-token', 'owner', 'context', 'hello',
    )).rejects.toThrow('send failed (-2)')
  })

  it('downloads bounded media from full and opaque Tencent CDN references', async () => {
    const responses = [
      new Response(null, { status: 200 }),
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    ]
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(responses.shift() as Response))
    const transport = client(fetch)

    await expect(transport.downloadMedia({
      full_url: 'https://novac2c.cdn.weixin.qq.com/c2c/download?id=one',
    }, 10)).resolves.toEqual(Buffer.alloc(0))
    await expect(transport.downloadMedia({ encrypt_query_param: 'opaque query' }, 10)).resolves.toEqual(Buffer.from([1, 2, 3]))
    expect((fetch.mock.calls[1]?.[0] as URL).searchParams.get('encrypted_query_param')).toBe('opaque query')
  })

  it('rejects absent, oversized, non-official, and failed CDN downloads', async () => {
    const transport = client(vi.fn<typeof globalThis.fetch>())
    await expect(transport.downloadMedia({}, 10)).rejects.toThrow('no download address')
    for (const url of [
      'http://novac2c.cdn.weixin.qq.com/c2c/download',
      'https://user@novac2c.cdn.weixin.qq.com/c2c/download',
      'https://example.com/download',
    ]) {
      await expect(transport.downloadMedia({ full_url: url }, 10)).rejects.toThrow('non-official CDN')
    }

    const declared = client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('x', {
      status: 200, headers: { 'content-length': '11' },
    })))
    await expect(declared.downloadMedia({ full_url: 'https://novac2c.cdn.weixin.qq.com/x' }, 10))
      .rejects.toThrow('file limit')

    const streamed = client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))))
    await expect(streamed.downloadMedia({ full_url: 'https://novac2c.cdn.weixin.qq.com/x' }, 2))
      .rejects.toThrow('file limit')

    const failed = client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', { status: 404 })))
    await expect(failed.downloadMedia({ full_url: 'https://novac2c.cdn.weixin.qq.com/x' }, 10))
      .rejects.toThrow('download failed with HTTP 404')
  })

  it('times out CDN transfers while preserving caller cancellation', async () => {
    vi.useFakeTimers()
    const fetch = rejectsWhenAborted()
    const transport = client(fetch, 50)
    const timedOut = transport.downloadMedia({ full_url: 'https://novac2c.cdn.weixin.qq.com/x' }, 10)
    const timedOutAssertion = expect(timedOut).rejects.toThrow('media request timed out')
    await vi.advanceTimersByTimeAsync(50)
    await timedOutAssertion

    vi.useRealTimers()
    const controller = new AbortController()
    const cancelled = transport.downloadMedia(
      { full_url: 'https://novac2c.cdn.weixin.qq.com/x' }, 10, controller.signal,
    )
    controller.abort()
    await expect(cancelled).rejects.toThrow('transport aborted')
  })

  it('validates upload targets and supports the legacy upload query parameter', async () => {
    const targetFetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ upload_param: 'legacy-param' }))
      .mockResolvedValueOnce(json({ upload_full_url: 'https://novac2c.cdn.weixin.qq.com/c2c/upload?id=one' }))
      .mockResolvedValueOnce(json({ upload_full_url: 'https://example.com/upload' }))
    const transport = client(targetFetch)
    const request = {
      fileKey: 'file-key', mediaType: 3 as const, toUserId: 'owner', rawSize: 1,
      rawMd5: 'md5', encryptedSize: 16, aesKeyHex: '00'.repeat(16),
    }

    await expect(transport.getUploadTarget('https://ilinkai.weixin.qq.com', 'token', request))
      .resolves.toEqual({ uploadParam: 'legacy-param' })
    await expect(transport.getUploadTarget('https://ilinkai.weixin.qq.com', 'token', request))
      .resolves.toEqual({ uploadFullUrl: 'https://novac2c.cdn.weixin.qq.com/c2c/upload?id=one' })
    await expect(transport.getUploadTarget('https://ilinkai.weixin.qq.com', 'token', request))
      .rejects.toThrow('non-official CDN')
  })

  it('uploads through both destination forms and rejects incomplete or failed responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'x-encrypted-param': ' download-one ' } }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const transport = client(fetch)

    await expect(transport.uploadMedia({ uploadParam: 'legacy' }, 'file-key', Buffer.from('cipher')))
      .resolves.toBe('download-one')
    expect((fetch.mock.calls[0]?.[0] as URL).searchParams.get('filekey')).toBe('file-key')
    await expect(transport.uploadMedia({ uploadFullUrl: 'https://novac2c.cdn.weixin.qq.com/x' }, 'key', Buffer.from('x')))
      .rejects.toThrow('upload failed with HTTP 500')
    await expect(transport.uploadMedia({ uploadFullUrl: 'https://novac2c.cdn.weixin.qq.com/x' }, 'key', Buffer.from('x')))
      .rejects.toThrow('omitted its download parameter')
    await expect(transport.uploadMedia({}, 'key', Buffer.from('x'))).rejects.toThrow('no destination')
  })

  it('times out uploads while preserving caller cancellation', async () => {
    vi.useFakeTimers()
    const fetch = rejectsWhenAborted()
    const transport = client(fetch, 50)
    const timedOut = transport.uploadMedia({ uploadFullUrl: 'https://novac2c.cdn.weixin.qq.com/x' }, 'key', Buffer.from('x'))
    const timedOutAssertion = expect(timedOut).rejects.toThrow('media request timed out')
    await vi.advanceTimersByTimeAsync(50)
    await timedOutAssertion

    vi.useRealTimers()
    const controller = new AbortController()
    const cancelled = transport.uploadMedia(
      { uploadFullUrl: 'https://novac2c.cdn.weixin.qq.com/x' }, 'key', Buffer.from('x'), controller.signal,
    )
    controller.abort()
    await expect(cancelled).rejects.toThrow('transport aborted')
  })

  it('supports captionless media, typing lifecycle, notify edges, and missing tickets', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ ret: 0 }))
      .mockResolvedValueOnce(json({ ret: -1 }))
      .mockResolvedValueOnce(json({ ret: 0, typing_ticket: 'ticket' }))
      .mockImplementation(() => Promise.resolve(json({ ret: 0 })))
    const transport = client(fetch)
    const media = {
      type: 4 as const,
      file_item: {
        media: { encrypt_query_param: 'download', aes_key: 'key', encrypt_type: 1 as const },
        file_name: 'result.txt',
        len: '1',
      },
    }

    await transport.sendMedia('https://ilinkai.weixin.qq.com', 'token', 'owner', 'context', media, '   ')
    await expect(transport.getTypingTicket('https://ilinkai.weixin.qq.com', 'token', 'owner', 'context'))
      .resolves.toBeUndefined()
    await expect(transport.getTypingTicket('https://ilinkai.weixin.qq.com', 'token', 'owner', 'context'))
      .resolves.toBe('ticket')
    await transport.sendTyping('https://ilinkai.weixin.qq.com', 'token', 'owner', 'ticket', true)
    await transport.sendTyping('https://ilinkai.weixin.qq.com', 'token', 'owner', 'ticket', false)
    await transport.notify('https://ilinkai.weixin.qq.com', 'token', 'start')
    await transport.notify('https://ilinkai.weixin.qq.com', 'token', 'stop')

    const bodies = fetch.mock.calls.map(call => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>)
    expect(bodies.some(body => body.status === 1)).toBe(true)
    expect(bodies.some(body => body.status === 2)).toBe(true)
  })
})
