import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { verifyVoucherOriginals } from '../src/voucher-originals.ts'

const bytes = Buffer.from('synthetic original')
const expected = [{ sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
  expiresAt: 1, downloadUrl: 'https://source.example.com/original.pdf?private=source' }]
const options = { hosts: ['copies.example.com'], maxBytes: 1024, timeoutMs: 1000 }
const data = { attachmentList: [{ downloadUrl: 'https://copies.example.com/copy.pdf?private=vendor',
  fileName: 'aliyun_v4_request&x-oss-signature=PRIVATE', fileSize: '0' }] }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('verifies actual bytes after source expiry without trusting metadata or exposing links', async () => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' })
    expect(init?.headers).toBeUndefined()
    return new Response(bytes)
  })
  vi.stubGlobal('fetch', fetcher)
  const result = await verifyVoucherOriginals(data, expected, options, new AbortController().signal)
  expect(result).toEqual({ association: 'matched', retention: 'verified', verifiedCount: 1, metadataWarning: true })
  expect(JSON.stringify(result)).not.toMatch(/https|PRIVATE|private|signature/)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('keeps retention pending when copies were requested before source expiry', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
  expect(await verifyVoucherOriginals(data, [{ ...expected[0]!, expiresAt: Date.now() + 60000 }], options,
    new AbortController().signal)).toMatchObject({ association: 'matched', retention: 'pending' })
})

it('does not promote an in-flight pre-expiry download when the clock crosses expiry', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100)
  vi.stubGlobal('fetch', vi.fn(async () => { clock.mockReturnValue(300); return new Response(bytes) }))
  expect(await verifyVoucherOriginals(data, [{ ...expected[0]!, expiresAt: 200 }], options, new AbortController().signal))
    .toMatchObject({ association: 'matched', retention: 'pending' })
})

it('keeps a successful HTTP response without a body unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null)))
  expect(await verifyVoucherOriginals(data, expected, options, new AbortController().signal))
    .toMatchObject({ association: 'unavailable', retention: 'unavailable' })
})

it.each(['http://copies.example.com/a', 'https://copies.example.com:444/a', 'https://user:pass@copies.example.com/a',
  'https://copies.example.com/a#fragment', 'https://127.0.0.1/a', 'https://copies.example.com.evil.test/a',
  'https://source.example.com/original.pdf?new-signature=1'])('refuses an untrusted copy URL before networking: %s', async (downloadUrl) => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  expect(await verifyVoucherOriginals({ attachmentList: [{ downloadUrl }] }, expected,
    { ...options, hosts: [...options.hosts, 'source.example.com'] }, new AbortController().signal))
    .toMatchObject({ association: 'unavailable', retention: 'unavailable' })
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([undefined, {}, { attachmentList: null }, { attachmentList: [{ downloadUrl: 'not-url' }] }])
('does not reinterpret absent or malformed metadata as no originals', async (value) => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  expect(await verifyVoucherOriginals(value, expected, options, new AbortController().signal)).toMatchObject({ association: 'unavailable' })
  expect(fetcher).not.toHaveBeenCalled()
})

it('distinguishes count/hash mismatch from unavailable download and no requested originals', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('different bytes')))
  expect(await verifyVoucherOriginals({ attachmentList: [] }, expected, options, new AbortController().signal))
    .toMatchObject({ association: 'mismatch', verifiedCount: 0 })
  expect(await verifyVoucherOriginals(data, expected, options, new AbortController().signal))
    .toMatchObject({ association: 'mismatch', retention: 'unavailable' })
  expect(await verifyVoucherOriginals(undefined, [], options, new AbortController().signal))
    .toMatchObject({ association: 'not-required', retention: 'not-required' })
})

it.each(['http-failure', 'network', 'oversize', 'stream', 'cancel'])('bounds failed downloads: %s', async (mode) => {
  const controller = new AbortController()
  if (mode === 'cancel') controller.abort()
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (mode === 'network') throw new Error('private-url')
    if (mode === 'http-failure') return new Response('denied', { status: 403 })
    if (mode === 'stream') return new Response(new ReadableStream({ start(reader) { reader.error(new Error('private-url')) } }))
    return new Response(Buffer.alloc(options.maxBytes + 1))
  }))
  expect(await verifyVoucherOriginals(data, expected, options, controller.signal)).toMatchObject({ association: 'unavailable', verifiedCount: 0 })
})

it('refuses aggregate excess and duplicate URLs, and compares a multiset rather than filenames', async () => {
  const fetcher = vi.fn(async () => new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  const duplicate = { attachmentList: [data.attachmentList[0], data.attachmentList[0]] }
  expect(await verifyVoucherOriginals(duplicate, [...expected, ...expected], options, new AbortController().signal))
    .toMatchObject({ association: 'unavailable' })
  expect(await verifyVoucherOriginals(data, expected, { ...options, maxBytes: 1 }, new AbortController().signal))
    .toMatchObject({ association: 'unavailable' })
  expect(fetcher).not.toHaveBeenCalled()
  const two = { attachmentList: [data.attachmentList[0], { downloadUrl: 'https://copies.example.com/second.pdf' }] }
  expect(await verifyVoucherOriginals(two, [...expected, ...expected], options, new AbortController().signal))
    .toMatchObject({ association: 'matched', verifiedCount: 2 })
})
