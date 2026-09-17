/** Private OSS transfers and atomic computer-wide settings owned by the Host. */
import { randomUUID } from 'node:crypto'
import OSS from 'ali-oss'
import { z } from 'zod'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  AttachmentStorageConfig, AttachmentStorageView, AttachmentStorageTestResult,
  SaveAttachmentStorageRequest, FinanceAttachmentUpload,
} from './types.ts'

const KEY = credentialKey('xiaojing-finance-domain', 'attachment-storage')
const configSchema = z.object({
  bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u),
  region: z.string().regex(/^oss-[a-z0-9-]+$/u),
  endpoint: z.url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      && url.pathname === '/' && url.search === '' && url.hash === ''
      && url.port === '' && url.hostname.includes('.')
  }),
  prefix: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/u).max(150),
}).strict()
const pairSchema = z.object({
  accessKeyId: z.string().trim().min(8).max(256).regex(/^[A-Za-z0-9]+$/u),
  accessKeySecret: z.string().trim().min(8).max(256).regex(/^[A-Za-z0-9+/=_-]+$/u),
})
const storedSchema = pairSchema.extend({ revision: z.number().int().positive(), config: configSchema }).strict()
const saveSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), config: configSchema,
  accessKeyId: pairSchema.shape.accessKeyId.optional(),
  accessKeySecret: pairSchema.shape.accessKeySecret.optional(),
}).strict()
type Stored = z.infer<typeof storedSchema>

function attachmentContentType(objectKey: string): string {
  const normalized = objectKey.toLowerCase()
  if (normalized.endsWith('.pdf')) return 'application/pdf'
  if (normalized.endsWith('.png')) return 'image/png'
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  throw new Error('附件类型不受支持。')
}

function attachmentDownloadName(contentType: string): string {
  if (contentType === 'application/pdf') return 'attachment.pdf'
  if (contentType === 'image/png') return 'attachment.png'
  return 'attachment.jpg'
}

function decode(record: CredentialRecord | undefined): Stored | undefined {
  if (record === undefined) return undefined
  try {
    if (record.kind !== 'api-key' || !record.key) throw new Error()
    return storedSchema.parse(JSON.parse(record.key))
  } catch { throw new Error('附件存储配置损坏，请检查本机凭据存储。') }
}

/** Validated deployment defaults and bounded transfer settings. */
export interface AttachmentStorageOptions {
  defaults: AttachmentStorageConfig
  timeoutMs: number
  urlExpiresSeconds: number
}

/** One settings and transfer owner; each operation snapshots its saved credentials. */
export class AttachmentStorage {
  /** @param credentials - Host credential provider. @param options - Deployment defaults and limits. */
  constructor(private readonly credentials: CredentialProvider, private readonly options: AttachmentStorageOptions) {
    configSchema.parse(options.defaults)
  }

  /**
   * Read saved configuration without the RAM key pair.
   * @returns Current non-secret settings and credential writability.
   */
  async read(): Promise<AttachmentStorageView> {
    const saved = decode(await this.credentials.readRecord(KEY))
    const info = await this.credentials.describeRecord(KEY)
    return {
      revision: saved?.revision ?? 0, config: saved?.config ?? structuredClone(this.options.defaults),
      configured: saved !== undefined, writable: info.writable,
    }
  }

  /**
   * Atomically replace configuration after checking its revision.
   * @param request - Complete settings and optional replacement key pair.
   * @returns Sanitized saved settings.
   */
  async save(request: SaveAttachmentStorageRequest): Promise<AttachmentStorageView> {
    const parsed = saveSchema.safeParse(request)
    if (!parsed.success) throw new Error('配置格式有误：请填写有效的 Bucket、地域、HTTPS 域名、目录前缀和密钥。')
    const input = parsed.data
    if ((input.accessKeyId === undefined) !== (input.accessKeySecret === undefined)) {
      throw new Error('更换密钥时，请同时填写 AccessKey ID 和 AccessKey Secret。')
    }
    await this.credentials.modifyRecord(KEY, (current) => {
      const saved = decode(current)
      if ((saved?.revision ?? 0) !== input.expectedRevision) throw new Error('附件配置已变更，请重新加载后再保存。')
      const pair = input.accessKeyId === undefined ? saved : input
      if (pair?.accessKeyId === undefined || pair.accessKeySecret === undefined) throw new Error('首次配置需要填写阿里云 RAM 用户的两个 AccessKey。')
      const next: Stored = {
        revision: input.expectedRevision + 1, config: input.config,
        accessKeyId: pair.accessKeyId, accessKeySecret: pair.accessKeySecret,
      }
      return Promise.resolve({ kind: 'api-key', key: JSON.stringify(next) })
    })
    return this.read()
  }

  private async saved(): Promise<Stored> {
    const saved = decode(await this.credentials.readRecord(KEY))
    if (saved === undefined) throw new Error('请先在设置 → 附件存储中保存 OSS 配置。')
    return saved
  }

  private client(saved: Stored): OSS {
    return new OSS({ accessKeyId: saved.accessKeyId, accessKeySecret: saved.accessKeySecret, endpoint: saved.config.endpoint,
      bucket: saved.config.bucket, region: saved.config.region,
      cname: true, secure: true, authorizationV4: true, timeout: this.options.timeoutMs })
  }

  private async transfer(client: OSS, method: 'PUT' | 'GET' | 'DELETE', objectKey: string, signal: AbortSignal,
    bytes?: Uint8Array, contentType?: string): Promise<Response> {
    signal.throwIfAborted()
    try {
      const headers = contentType === undefined ? undefined : { 'Content-Type': contentType }
      const url = await client.signatureUrlV4(method, this.options.urlExpiresSeconds,
        headers === undefined ? {} : { headers }, objectKey)
      const response = await fetch(url, {
        method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]),
        ...(headers === undefined ? {} : { headers }),
        ...(bytes === undefined ? {} : { body: bytes as Uint8Array<ArrayBuffer> }),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`OSS ${method} 返回 HTTP ${response.status}；请检查密钥、Bucket 权限及域名绑定。`)
      }
      return response
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('OSS ')) throw error
      throw new Error(`OSS ${method} 未完成：网络、证书、超时或请求取消；请检查连接后重试。`)
    }
  }

  /**
   * Exercise real upload and signed download, always attempting to remove the synthetic object.
   * @param revision - Saved revision selected by the UI.
   * @param signal - Host shutdown or caller cancellation.
   * @returns Independent transfer and cleanup outcomes; no signed URL or provider error body.
   */
  async test(revision: number, signal: AbortSignal): Promise<AttachmentStorageTestResult> {
    const saved = await this.saved()
    if (saved.revision !== revision) throw new Error('附件配置已变更，请重新加载再测试。')
    const client = this.client(saved)
    const objectKey = `${saved.config.prefix}_connection-test/${randomUUID()}.txt`
    const bytes = Buffer.from(`xiaojing-attachment-test:${randomUUID()}`)
    const result: AttachmentStorageTestResult = { revision, uploaded: false, downloaded: false, deleted: false, message: '' }
    let attempted = false
    try {
      signal.throwIfAborted()
      attempted = true
      await (await this.transfer(client, 'PUT', objectKey, signal, bytes)).body?.cancel()
      result.uploaded = true
      const response = await this.transfer(client, 'GET', objectKey, signal)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('OSS 下载测试未返回内容。')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > bytes.length) throw new Error('OSS 下载测试内容与上传不一致。')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel() }
      if (!Buffer.concat(chunks).equals(bytes)) throw new Error('OSS 下载测试内容与上传不一致。')
      result.downloaded = true
    } catch (error) {
      result.message = error instanceof Error && error.message.startsWith('OSS ') ? error.message : '附件连接测试未完成，请重试。'
    } finally {
      if (attempted) {
        try {
          await (await this.transfer(client, 'DELETE', objectKey, AbortSignal.timeout(this.options.timeoutMs))).body?.cancel()
          result.deleted = true
        } catch { result.message += ` 测试文件清理失败，请检查删除权限：${objectKey}` }
      }
    }
    if (result.uploaded && result.downloaded && result.deleted) result.message = '上传、签名链接下载、测试文件清理均通过。'
    return result
  }

  /**
   * Upload caller-authorized bytes into a relative, opaque workspace/session namespace.
   * @param objectSuffix - Host-generated relative object key, never model input.
   * @param name - Original display name, excluded from the cloud object key.
   * @param bytes - Bounded original invoice bytes verified by the Finance domain.
   * @param signal - Caller cancellation and Host shutdown.
   * @param expectedRevision - When supplied, require the storage settings approved for this financial upload.
   * @returns Host-only temporary link and non-secret receipt; the object remains until explicitly removed.
   */
  async upload(objectSuffix: string, name: string, bytes: Buffer, signal: AbortSignal,
    expectedRevision?: number): Promise<FinanceAttachmentUpload> {
    const saved = await this.saved()
    if (expectedRevision !== undefined && saved.revision !== expectedRevision) throw new Error('附件配置已变化，请重新确认上传目标。')
    const client = this.client(saved)
    const objectKey = `${saved.config.prefix}${objectSuffix}`
    const contentType = attachmentContentType(objectKey)
    await (await this.transfer(client, 'PUT', objectKey, signal, bytes, contentType)).body?.cancel()
    signal.throwIfAborted()
    let downloadUrl: string
    try {
      downloadUrl = client.signatureUrl(objectKey, {
        expires: this.options.urlExpiresSeconds,
        method: 'GET',
        response: {
          'content-disposition': `inline; filename=${attachmentDownloadName(contentType)}`,
        },
      })
    }
    catch { throw new Error('附件已上传，但生成临时下载链接失败，请检查 OSS 配置。') }
    return { objectKey, name, size: bytes.length, expiresAt: Date.now() + this.options.urlExpiresSeconds * 1000, downloadUrl }
  }
}
