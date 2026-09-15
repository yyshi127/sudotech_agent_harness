import { afterEach, describe, expect, it, vi } from 'vitest'
import { FinanceClientId } from '../src/types.ts'
import { resolveYouchengApiUrls, YouchengConnection } from '../src/youcheng.ts'

const urls = { test: 'https://cwdata.yiqiyun.com', production: 'https://cwdata.yiqiyun.com' }
const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'test-app-key', accountCode: '35581' }
const clientId = FinanceClientId('test-client')
const signal = new AbortController().signal
const reply = (data: unknown, result = 100, message = '操作成功') => Response.json({ result, message, data })

afterEach(() => vi.unstubAllGlobals())

describe('Youcheng read-only connection verification', () => {
  it.each(['ECONNRESET', 'UND_ERR_SOCKET', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])('recovers one transient %s with the same request and deadline when enabled', async (code) => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('private', { cause: { code } }))
      .mockResolvedValueOnce(reply('test-token'))
      .mockResolvedValueOnce(reply([{ id: '35581', sobName: '数豆' }]))
    vi.stubGlobal('fetch', fetcher)
    expect((await new YouchengConnection(urls, 1000, true).listAccounts(config, 'test-secret', signal)).state).toBe('ready')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[1]?.[0]).toBe(fetcher.mock.calls[0]?.[0])
    expect(fetcher.mock.calls[1]?.[1]).toBe(fetcher.mock.calls[0]?.[1])
  })

  it('stops after the second transport failure without disclosing exception content', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('private test-app-secret', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }))
    vi.stubGlobal('fetch', fetcher)
    const request = new YouchengConnection(urls, 1000, true).queryBalances(config, 'test-app-secret', { month: '2026-09' }, signal, 100, 65536)
    await expect(request).rejects.toThrow('network:UND_ERR_CONNECT_TIMEOUT；阶段：认证')
    await expect(request).rejects.not.toThrow('test-app-secret')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['ENOTFOUND', 'UNKNOWN'])('does not retry permanent or unknown transport failures: %s', async (code) => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('private', { cause: { code } }))
    vi.stubGlobal('fetch', fetcher)
    expect((await new YouchengConnection(urls, 1000, true).listAccounts(config, 'test-secret', signal)).state).toBe('failed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403, 500, 200])('does not retry an HTTP/vendor/invalid response (%s)', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('invalid private response', { status }))
    vi.stubGlobal('fetch', fetcher)
    expect((await new YouchengConnection(urls, 1000, true).listAccounts(config, 'test-secret', signal)).state).toBe('failed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not retry a transport failure after cancellation', async () => {
    const stopped = new AbortController()
    const fetcher = vi.fn().mockImplementation(() => {
      stopped.abort()
      throw new TypeError('private', { cause: { code: 'ECONNRESET' } })
    })
    vi.stubGlobal('fetch', fetcher)
    expect((await new YouchengConnection(urls, 1000, true).listAccounts(config, 'test-secret', stopped.signal)).state).toBe('failed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('aborts a hung retry using the original whole-operation deadline', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('private', { cause: { code: 'ECONNRESET' } }))
      .mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true })
      }))
    vi.stubGlobal('fetch', fetcher)
    expect(await new YouchengConnection(urls, 20, true).listAccounts(config, 'test-secret', signal)).toEqual({ state: 'failed', failure: 'timeout' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[1]).toBe(fetcher.mock.calls[0]?.[1])
  })

  it.each(['ECONNRESET', 'UND_ERR_SOCKET', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])('reports the fixed transport code %s without exception content or a retry', async (code) => {
    const cause = Object.assign(new Error('private URL test-app-secret'), { code })
    const fetcher = vi.fn().mockRejectedValue(new TypeError('private URL test-app-secret', { cause }))
    vi.stubGlobal('fetch', fetcher)
    await expect(new YouchengConnection(urls, 1_000).queryBalances(config, 'test-app-secret', { month: '2026-09' }, signal, 100, 65536))
      .rejects.toThrow(`network:${code}；阶段：认证`)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not expose an unrecognized transport code', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('private URL', { cause: { code: 'private-test-app-secret' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(new YouchengConnection(urls, 1_000).queryBalances(config, 'test-app-secret', { month: '2026-09' }, signal, 100, 65536))
      .rejects.toThrow('network；阶段：认证')
  })

  it('discovers names and IDs without a ledger filter or returning other vendor fields', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply('test-access-token'))
      .mockResolvedValueOnce(reply([{ id: '35581', sobName: '数豆', privateField: 'hidden' }, { id: 'other', sobName: '另一个账套' }]))
    vi.stubGlobal('fetch', fetcher)
    const adapter = new YouchengConnection(urls, 1_000)
    expect(await adapter.listAccounts(config, 'test-app-secret', signal)).toEqual({
      state: 'ready', accounts: [{ id: '35581', name: '数豆' }, { id: 'other', name: '另一个账套' }],
    })
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ body: '{}', redirect: 'error' })
  })

  it.each([
    [[], { state: 'ready', accounts: [] }],
    [[{ id: 'same', sobName: '甲' }, { id: 'same', sobName: '乙' }], { state: 'failed', failure: 'invalid-response' }],
    [[{ id: 'test-app-secret', sobName: '甲' }], { state: 'failed', failure: 'invalid-response' }],
    [[{ id: 'safe', sobName: 'test-access-token' }], { state: 'failed', failure: 'invalid-response' }],
  ])('distinguishes empty discovery from ambiguous or sensitive responses %#', async (data, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('test-access-token')).mockResolvedValueOnce(reply(data)))
    expect(await new YouchengConnection(urls, 1_000).listAccounts(config, 'test-app-secret', signal)).toEqual(expected)
  })

  it('keeps discovery failures safe and leaves the saved token cache unchanged', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply('saved-token'))
      .mockResolvedValueOnce(reply([{ id: '35581', sobName: '数豆' }]))
      .mockResolvedValueOnce(reply(null, 201, 'test-app-secret'))
      .mockResolvedValueOnce(reply([{ id: '35581', sobName: '数豆' }]))
    vi.stubGlobal('fetch', fetcher)
    const adapter = new YouchengConnection(urls, 1_000)
    await adapter.check(clientId, config, 'saved-secret', signal)
    expect(await adapter.listAccounts(config, 'test-app-secret', signal)).toEqual({ state: 'failed', failure: 'authentication' })
    expect((await adapter.check(clientId, config, 'saved-secret', signal)).state).toBe('connected')
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(await adapter.listAccounts(config, undefined, signal)).toEqual({ state: 'failed', failure: 'credentials-missing' })
    fetcher.mockRejectedValueOnce(new Error('private URL and token'))
    expect(await adapter.listAccounts(config, 'test-app-secret', signal)).toEqual({ state: 'failed', failure: 'network' })
  })

  it('accepts a shared HTTPS origin and rejects unsafe or path-bearing deployment URLs', () => {
    expect(resolveYouchengApiUrls(urls.test, `${urls.production}/`)).toEqual(urls)
    for (const url of ['http://example.com', 'https://a:b@example.com', 'https://example.com/path', 'https://example.com?q=x', 'https://example.com/#x']) {
      expect(() => resolveYouchengApiUrls(url, urls.production)).toThrow()
    }
  })

  it('authenticates using a string token, ignores unrelated accounts, and reuses the token for the same credentials', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply('test-access-token'))
      .mockResolvedValueOnce(reply([{ id: 'other', sobName: '其他公司' }, { id: '35581', sobName: '数豆' }]))
      .mockResolvedValueOnce(reply([{ id: '35581', sobName: '数豆' }]))
    vi.stubGlobal('fetch', fetcher)
    const adapter = new YouchengConnection(urls, 1_000)
    expect(await adapter.check(clientId, config, 'test-app-secret', signal)).toMatchObject({ state: 'connected', accountId: '35581', accountName: '数豆' })
    const [authUrl, authInit] = fetcher.mock.calls[0]!
    if (!(authUrl instanceof URL)) throw new Error('Expected a URL for authentication')
    expect(String(authUrl)).toBe(`${urls.test}/auth/getAccessToken.rjson`)
    expect(authInit?.body).toBe(JSON.stringify({ appKey: config.appKey, appSecret: 'test-app-secret' }))
    const [listUrl, listInit] = fetcher.mock.calls[1]!
    if (!(listUrl instanceof URL)) throw new Error('Expected a URL for the ledger query')
    expect(listUrl.pathname).toBe('/finance/auxiliary/queryAccountList.rjson')
    expect(listUrl.searchParams.get('accessToken')).toBe('test-access-token')
    expect(listInit?.body).toBe(JSON.stringify({ setOfBooksId: '35581' }))
    expect(listInit?.redirect).toBe('error')
    await adapter.check(clientId, config, 'test-app-secret', signal)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it.each([
    [[], 'account-unavailable'],
    [[{ id: 'different', sobName: '数豆' }], 'account-unavailable'],
    [[{ id: '35581', sobName: '甲' }, { id: '35581', sobName: '乙' }], 'account-unavailable'],
    [[{ id: 35581, sobName: '数豆' }], 'invalid-response'],
    [[{ id: '35581', sobName: 'test-app-secret' }], 'invalid-response'],
  ])('rejects unverifiable ledger responses %#', async (data, failure) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('token')).mockResolvedValueOnce(reply(data)))
    expect(await new YouchengConnection(urls, 1_000).check(clientId, config, 'test-app-secret', signal))
      .toMatchObject({ state: 'failed', failure })
  })

  it.each([
    [201, 'appSecret不正确 test-app-secret', 'authentication'],
    [201, 'IP未加入白名单 test-app-secret', 'ip-not-allowed'],
  ])('returns safe authentication failure %s without echoing vendor content', async (result, message, failure) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(null, result, message)))
    const outcome = await new YouchengConnection(urls, 1_000).check(clientId, config, 'test-app-secret', signal)
    expect(outcome).toMatchObject({ state: 'failed', failure })
    expect(JSON.stringify(outcome)).not.toContain('test-app-secret')
  })

  it('handles missing credentials, transport failure, malformed JSON, and a denied account query', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const adapter = new YouchengConnection(urls, 1_000)
    expect((await adapter.check(clientId, config, undefined, signal)).failure).toBe('credentials-missing')
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRejectedValueOnce(new Error('private URL and token'))
    expect((await adapter.check(clientId, config, 'test-secret', signal)).failure).toBe('network')
    fetcher.mockResolvedValueOnce(new Response('not json'))
    expect((await adapter.check(clientId, config, 'test-secret', signal)).failure).toBe('invalid-response')
    fetcher.mockResolvedValueOnce(reply('token')).mockResolvedValueOnce(new Response('', { status: 403 }))
    expect((await adapter.check(clientId, config, 'test-secret', signal)).failure).toBe('access-denied')
  })

  it('reauthenticates when the credential changes and when explicitly invalidated', async () => {
    const fetcher = vi.fn().mockImplementation((url: URL) => Promise.resolve(url.pathname.includes('/auth/')
      ? reply('test-token') : reply([{ id: '35581', sobName: '数豆' }])))
    vi.stubGlobal('fetch', fetcher)
    const adapter = new YouchengConnection(urls, 1_000)
    await adapter.check(clientId, config, 'old-secret', signal)
    await adapter.check(clientId, config, 'new-secret', signal)
    adapter.invalidate(clientId)
    await adapter.check(clientId, config, 'new-secret', signal)
    expect(fetcher).toHaveBeenCalledTimes(6)
  })

  it('bounds a hung request and respects Host cancellation without disclosing the transport error', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('private token URL')) }, { once: true })
    })))
    const adapter = new YouchengConnection(urls, 10)
    expect((await adapter.check(clientId, config, 'test-secret', signal)).failure).toBe('timeout')
    const stopped = new AbortController()
    const pending = adapter.check(clientId, config, 'test-secret', stopped.signal)
    stopped.abort()
    expect((await pending).failure).toBe('network')
  })

  it.each([401, 403])('classifies HTTP %s without exposing its response body', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private token URL', { status })))
    const outcome = await new YouchengConnection(urls, 1_000).listAccounts(config, 'test-secret', signal)
    expect(outcome).toEqual({ state: 'failed', failure: status === 401 ? 'authentication' : 'access-denied' })
  })

  it('preserves an explicit IP rejection on HTTP 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ result: 201, message: 'IP未加入白名单 private token' }, { status: 403 })))
    expect(await new YouchengConnection(urls, 1_000).listAccounts(config, 'test-secret', signal))
      .toEqual({ state: 'failed', failure: 'ip-not-allowed' })
  })

  it('applies the deadline while reading a response body', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => { controller.error(new Error('private URL')) }, { once: true })
      },
    })))))
    expect(await new YouchengConnection(urls, 10).listAccounts(config, 'test-secret', signal))
      .toEqual({ state: 'failed', failure: 'timeout' })
  })
})
