import { describe, expect, it, vi } from 'vitest'
import { IlinkClient, normalizeOfficialIlinkBaseUrl } from '../src/protocol.ts'

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

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

  it('submits verification and preserves the official redirect allowlist', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ status: 'need_verifycode' }))
    const client = new IlinkClient({ requestTimeoutMs: 1_000, longPollTimeoutMs: 5_000, mediaTransferTimeoutMs: 5_000, fetch })
    await expect(client.pairingStatus('opaque', '123456')).resolves.toEqual({ status: 'need_verifycode' })
    expect((fetch.mock.calls[0]?.[0] as URL).searchParams.get('verify_code')).toBe('123456')
    expect(normalizeOfficialIlinkBaseUrl('https://sh.ilinkai.weixin.qq.com/edge')).toBe('https://sh.ilinkai.weixin.qq.com/edge/')
    expect(() => normalizeOfficialIlinkBaseUrl('https://example.com')).toThrow('non-official')
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
})
