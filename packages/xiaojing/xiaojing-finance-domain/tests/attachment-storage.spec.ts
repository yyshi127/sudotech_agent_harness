import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { AttachmentStorage } from '../src/attachment-storage.ts'

const config = { bucket: 'example-bucket', region: 'oss-cn-hangzhou', endpoint: 'https://attachments.example.com', prefix: 'xiaojing/' }
const request = { expectedRevision: 0, config, accessKeyId: 'exampleKey123', accessKeySecret: 'exampleSecret123' }
afterEach(() => { vi.unstubAllGlobals() })

async function mounted() {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials).await()
  const storage = new AttachmentStorage(ctx.credentials, { defaults: config, timeoutMs: 1000, urlExpiresSeconds: 3600 })
  return { ctx, storage }
}

it('keeps credentials write-only, retains an omitted pair, and rejects partial/stale/invalid saves', async () => {
  const { ctx, storage } = await mounted()
  try {
    expect(await storage.read()).toEqual({ revision: 0, config, configured: false, writable: true })
    await expect(storage.save({ expectedRevision: 0, config })).rejects.toThrow('首次')
    const saved = await storage.save(request)
    expect(JSON.stringify(saved)).not.toContain(request.accessKeySecret)
    expect(JSON.stringify(saved)).not.toContain(request.accessKeyId)
    expect((await storage.save({ expectedRevision: 1, config })).revision).toBe(2)
    await expect(storage.save({ expectedRevision: 2, config, accessKeyId: 'newKey123' })).rejects.toThrow('同时')
    await expect(storage.save(request)).rejects.toThrow('已变更')
    await expect(storage.save({ ...request, config: { ...config, endpoint: 'http://example.com' } })).rejects.toThrow('格式')
    await expect(storage.save({ ...request, config: { ...config, prefix: '../' } })).rejects.toThrow('格式')
    await expect(storage.test(1, new AbortController().signal)).rejects.toThrow('已变更')
  } finally { await ctx.fiber.dispose() }
})

it('uses real V4 signing over the CNAME and checks PUT, signed GET bytes, then DELETE', async () => {
  const { ctx, storage } = await mounted()
  const calls: string[] = []
  let bytes: Uint8Array | undefined
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input)
    expect(url.origin).toBe(config.endpoint)
    expect(url.searchParams.get('x-oss-signature-version')).toBe('OSS4-HMAC-SHA256')
    expect(url.pathname).toMatch(/^\/xiaojing\/_connection-test\//)
    expect(init.redirect).toBe('error')
    calls.push(init.method!)
    if (init.method === 'PUT') bytes = init.body as Uint8Array
    return new Response(init.method === 'GET' ? bytes as BodyInit : null, { status: 200 })
  }))
  try {
    await storage.save(request)
    expect(await storage.test(1, new AbortController().signal)).toMatchObject({ uploaded: true, downloaded: true, deleted: true })
    expect(calls).toEqual(['PUT', 'GET', 'DELETE'])
  } finally { await ctx.fiber.dispose() }
})

it.each(['put', 'get', 'delete', 'mismatch', 'network'])('reports %s failure without credentials and attempts cleanup', async (failure) => {
  const { ctx, storage } = await mounted()
  const methods: string[] = []
  let bytes: Uint8Array | undefined
  vi.stubGlobal('fetch', vi.fn(async (_input: string, init: RequestInit) => {
    methods.push(init.method!)
    if (failure === 'network' && init.method === 'PUT') throw new Error(request.accessKeySecret)
    if (init.method?.toLowerCase() === failure) return new Response(request.accessKeySecret, { status: 403 })
    if (init.method === 'PUT') bytes = init.body as Uint8Array
    return new Response(init.method === 'GET' ? failure === 'mismatch' ? 'different' : bytes as BodyInit : null)
  }))
  try {
    await storage.save(request)
    const result = await storage.test(1, new AbortController().signal)
    expect(result.uploaded && result.downloaded && result.deleted).toBe(false)
    expect(methods.at(-1)).toBe('DELETE')
    expect(JSON.stringify(result)).not.toContain(request.accessKeySecret)
    expect(JSON.stringify(result)).not.toContain('x-oss-signature')
    if (failure === 'delete') expect(result).toMatchObject({ uploaded: true, downloaded: true, deleted: false })
  } finally { await ctx.fiber.dispose() }
})

it('uploads exact bytes with MIME metadata and returns a Youcheng-compatible Host-only link', async () => {
  const { ctx, storage } = await mounted()
  const fetcher = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input)
    expect(url.searchParams.get('x-oss-signature-version')).toBe('OSS4-HMAC-SHA256')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/pdf')
    return new Response(null)
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    await storage.save(request)
    await expect(storage.upload('other', '发票.pdf', Buffer.from('%PDF-1.4'), new AbortController().signal, 0)).rejects.toThrow('配置已变化')
    expect(fetcher).not.toHaveBeenCalled()
    const receipt = await storage.upload('account/session/invoice.pdf', '发票.pdf', Buffer.from('%PDF-1.4'), new AbortController().signal)
    expect(receipt.objectKey).toBe('xiaojing/account/session/invoice.pdf')
    const download = new URL(receipt.downloadUrl)
    expect(download.pathname).toBe('/xiaojing/account/session/invoice.pdf')
    expect(download.searchParams.has('OSSAccessKeyId')).toBe(true)
    expect(download.searchParams.has('x-oss-credential')).toBe(false)
    expect(download.searchParams.has('response-content-type')).toBe(false)
    expect(download.searchParams.get('response-content-disposition')).toBe('inline; filename=attachment.pdf')
    const vendorFileName = decodeURIComponent(download.href).slice(decodeURIComponent(download.href).lastIndexOf('/') + 1)
    expect(vendorFileName).toMatch(/\.pdf$/u)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(storage.upload('other', '发票.pdf', Buffer.from('x'), AbortSignal.abort())).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  } finally { await ctx.fiber.dispose() }
})

it.each([
  ['invoice.png', 'image/png', 'attachment.png'],
  ['invoice.jpg', 'image/jpeg', 'attachment.jpg'],
  ['invoice.jpeg', 'image/jpeg', 'attachment.jpg'],
])('preserves the supported image type and a usable extension for %s', async (objectName, contentType, downloadName) => {
  const { ctx, storage } = await mounted()
  vi.stubGlobal('fetch', vi.fn(async (_input: string, init: RequestInit) => {
    expect(new Headers(init.headers).get('Content-Type')).toBe(contentType)
    return new Response(null)
  }))
  try {
    await storage.save(request)
    const receipt = await storage.upload(`account/session/${objectName}`, objectName, Buffer.from('image'), new AbortController().signal)
    const download = new URL(receipt.downloadUrl)
    expect(download.searchParams.has('response-content-type')).toBe(false)
    expect(download.searchParams.get('response-content-disposition')).toBe(`inline; filename=${downloadName}`)
    const decoded = decodeURIComponent(download.href)
    expect(decoded.slice(decoded.lastIndexOf('/') + 1).endsWith(downloadName)).toBe(true)
  } finally { await ctx.fiber.dispose() }
})
