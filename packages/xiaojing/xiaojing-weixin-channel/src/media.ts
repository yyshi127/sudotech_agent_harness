/** Encrypted Tencent CDN media transfer and private local upload storage. */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, stat, unlink } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import type { IlinkCdnMedia, IlinkClient, IlinkMessageItem, IlinkOutboundMediaItem } from './protocol.ts'

/** Default per-file limit shared with the preinstalled file-upload plugin. */
export const DEFAULT_WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024
/** Default aggregate limit shared with the preinstalled file-upload plugin. */
export const DEFAULT_WEIXIN_MEDIA_TOTAL_MAX_BYTES = 1024 * 1024 * 1024

/** One inbound image or document saved below the local upload directory. */
export interface StoredWeixinMedia {
  /** Transport-level media kind; this does not imply OCR or visual understanding. */
  kind: 'image' | 'file'
  /** Sanitized unique filename visible in the upload manager. */
  name: string
  /** Absolute local path supplied to the Weixin Agent. */
  path: string
  /** Best-effort MIME type derived from magic bytes or the filename. */
  mediaType: string
  /** Decrypted plaintext size. */
  bytes: number
}

/** Stable metadata approved before one local file is sent to Weixin. */
export interface OutboundWeixinMedia {
  /** Canonical absolute local path. */
  path: string
  /** Filename delivered to Weixin. */
  name: string
  /** iLink image or document routing. */
  kind: 'image' | 'file'
  /** Plaintext byte length. */
  bytes: number
  /** File identity used to reject a replacement after approval. */
  identity: { device: number; inode: number; modifiedAt: number }
}

function sanitizeName(value: string): string {
  let safe = basename(value.normalize('NFC'))
    .replace(/[\\/\u0000-\u001f\u007f]/gu, '_')
    .replace(/^\.+/u, '')
    .trim()
  if (safe === '') safe = 'weixin-file.bin'
  if (safe.startsWith('.upload-')) safe = `file-${safe}`
  if (safe.length > 180) {
    const extension = extname(safe).slice(0, 24)
    safe = `${safe.slice(0, Math.max(1, 180 - extension.length))}${extension}`
  }
  return safe
}

function numberedName(name: string, index: number): string {
  if (index === 0) return name
  const originalExtension = extname(name)
  const extension = originalExtension.slice(0, 24)
  const stem = name.slice(0, name.length - originalExtension.length)
  const suffix = ` (${index})`
  return `${stem.slice(0, Math.max(1, 180 - extension.length - suffix.length))}${suffix}${extension}`
}

function mimeFromName(name: string): string {
  const extension = extname(name).toLowerCase()
  return ({
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.7z': 'application/x-7z-compressed',
    '.rar': 'application/vnd.rar',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

function imageIdentity(buffer: Buffer): { extension: string; mediaType: string } {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: '.png', mediaType: 'image/png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: '.jpg', mediaType: 'image/jpeg' }
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return { extension: '.gif', mediaType: 'image/gif' }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { extension: '.webp', mediaType: 'image/webp' }
  }
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return { extension: '.bmp', mediaType: 'image/bmp' }
  return { extension: '.bin', mediaType: 'application/octet-stream' }
}

function decodeCdnKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 16) return decoded
  if (decoded.length === 32 && /^[0-9a-f]{32}$/iu.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex')
  }
  throw new Error('iLink media AES key is invalid')
}

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) throw new Error('iLink media AES key is invalid')
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

function mediaReference(item: IlinkMessageItem): {
  kind: 'image' | 'file'
  media: IlinkCdnMedia
  key?: Buffer
  name?: string
} {
  if (item.type === 2) {
    const image = item.image_item
    if (image?.media === undefined) throw new Error('微信图片缺少下载信息。')
    const key = image.aeskey === undefined
      ? image.media.aes_key === undefined ? undefined : decodeCdnKey(image.media.aes_key)
      : /^[0-9a-f]{32}$/iu.test(image.aeskey) ? Buffer.from(image.aeskey, 'hex') : undefined
    if (image.aeskey !== undefined && key === undefined) throw new Error('微信图片的加密信息无效。')
    return { kind: 'image', media: image.media, ...(key === undefined ? {} : { key }) }
  }
  if (item.type === 4) {
    const file = item.file_item
    if (file?.media === undefined || file.media.aes_key === undefined) throw new Error('微信文件缺少加密下载信息。')
    return {
      kind: 'file', media: file.media, key: decodeCdnKey(file.media.aes_key),
      ...(file.file_name === undefined ? {} : { name: file.file_name }),
    }
  }
  throw new Error('当前媒体类型不受支持。')
}

/** Private atomic store shared with the local upload manager's directory and limits. */
export class WeixinMediaStore {
  private mutationTail: Promise<void> = Promise.resolve()

  /** Resolved directory that owns received Weixin attachments. */
  readonly root: string

  /** @param options - absolute storage root and byte quotas. */
  constructor(readonly options: { root: string; maxFileBytes: number; totalMaxBytes: number }) {
    this.root = resolve(options.root)
  }

  /**
   * Publish one fully decrypted buffer under a unique sanitized name.
   * @param requestedName - untrusted filename supplied by iLink or generated locally.
   * @param buffer - complete plaintext bytes.
   * @param kind - image or document transport kind.
   * @param mediaType - best-effort MIME type.
   * @returns the private regular file that became visible atomically.
   */
  save(requestedName: string, buffer: Buffer, kind: StoredWeixinMedia['kind'], mediaType: string): Promise<StoredWeixinMedia> {
    return this.enqueue(async () => {
      if (buffer.byteLength > this.options.maxFileBytes) throw new Error('微信文件超过单文件大小限制。')
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const usedBytes = await this.usedBytes()
      if (usedBytes + buffer.byteLength > this.options.totalMaxBytes) throw new Error('本机附件存储空间已满。')
      const tempPath = join(this.root, `.upload-${randomUUID()}.tmp`)
      const handle = await open(tempPath, 'wx', 0o600)
      try {
        await handle.writeFile(buffer)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        const published = await this.publish(tempPath, sanitizeName(requestedName))
        return { kind, name: published.name, path: published.path, mediaType, bytes: buffer.byteLength }
      } finally {
        await unlink(tempPath).catch(() => undefined)
      }
    })
  }

  /**
   * Remove only a regular file previously returned by this store.
   * @param path - exact absolute path returned by {@link save}.
   * @returns a promise that settles after the file is absent or rejected as outside the store.
   */
  async remove(path: string): Promise<void> {
    const target = resolve(path)
    if (target === this.root || !target.startsWith(`${this.root}\\`) && !target.startsWith(`${this.root}/`)) return
    try {
      const info = await lstat(target)
      if (info.isFile()) await unlink(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async usedBytes(): Promise<number> {
    let total = 0
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.upload-')) continue
      try {
        total += (await stat(join(this.root, entry.name))).size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return total
  }

  private async publish(tempPath: string, requestedName: string): Promise<{ name: string; path: string }> {
    for (let index = 0; index < 10_000; index += 1) {
      const name = numberedName(requestedName, index)
      const target = join(this.root, name)
      try {
        await link(tempPath, target)
        await unlink(tempPath)
        return { name, path: target }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
    }
    throw new Error('本机已有过多同名附件。')
  }
}

/**
 * Download, decrypt, and atomically retain one inbound iLink image or document.
 * @param client - fixed-authority iLink transport.
 * @param item - validated inbound image or file item.
 * @param store - private local upload store.
 * @param signal - channel lifecycle cancellation.
 * @returns local media metadata safe for the durable queue and model prompt.
 */
export async function receiveWeixinMedia(
  client: IlinkClient,
  item: IlinkMessageItem,
  store: WeixinMediaStore,
  signal?: AbortSignal,
): Promise<StoredWeixinMedia> {
  const source = mediaReference(item)
  const encryptedLimit = store.options.maxFileBytes + 16
  const downloaded = await client.downloadMedia(source.media, encryptedLimit, signal)
  const plaintext = source.key === undefined ? downloaded : decryptAesEcb(downloaded, source.key)
  if (source.kind === 'image') {
    const identity = imageIdentity(plaintext)
    return await store.save(`微信图片-${randomUUID().slice(0, 8)}${identity.extension}`, plaintext, 'image', identity.mediaType)
  }
  const name = sanitizeName(source.name ?? '微信文件.bin')
  return await store.save(name, plaintext, 'file', mimeFromName(name))
}

/**
 * Inspect a local regular file before asking the Weixin user for disclosure approval.
 * @param filePath - absolute local file selected by the Agent.
 * @param maxBytes - configured plaintext limit.
 * @returns immutable identity and delivery metadata.
 */
export async function inspectOutboundWeixinMedia(filePath: string, maxBytes: number): Promise<OutboundWeixinMedia> {
  if (!isAbsolute(filePath)) throw new Error('发送到微信的文件路径必须是绝对路径。')
  const path = resolve(filePath)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('只能发送本机普通文件，不能发送目录或链接。')
  if (info.size > maxBytes) throw new Error('文件超过微信发送大小限制。')
  const name = sanitizeName(basename(path))
  return {
    path,
    name,
    kind: mimeFromName(name).startsWith('image/') ? 'image' : 'file',
    bytes: info.size,
    identity: { device: info.dev, inode: info.ino, modifiedAt: info.mtimeMs },
  }
}

/**
 * Revalidate an approved local file, encrypt it, upload it, and send its iLink media item.
 * @param client - fixed-authority iLink transport.
 * @param file - identity captured before user approval.
 * @param connection - private account and active reply context.
 * @param caption - optional text delivered before the media item.
 * @param signal - active tool cancellation.
 */
export async function sendOutboundWeixinMedia(
  client: IlinkClient,
  file: OutboundWeixinMedia,
  connection: { baseUrl: string; token: string; toUserId: string; contextToken: string },
  caption: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const handle = await open(file.path, 'r')
  let plaintext: Buffer
  try {
    const current = await handle.stat()
    if (
      !current.isFile()
      || current.size !== file.bytes
      || current.dev !== file.identity.device
      || current.ino !== file.identity.inode
      || current.mtimeMs !== file.identity.modifiedAt
    ) throw new Error('文件在确认后发生了变化，请重新发送指令。')
    plaintext = await handle.readFile()
  } finally {
    await handle.close()
  }
  if (plaintext.byteLength !== file.bytes) throw new Error('文件在确认后发生了变化，请重新发送指令。')
  const aesKey = randomBytes(16)
  const ciphertext = encryptAesEcb(plaintext, aesKey)
  const fileKey = randomBytes(16).toString('hex')
  const target = await client.getUploadTarget(connection.baseUrl, connection.token, {
    fileKey,
    mediaType: file.kind === 'image' ? 1 : 3,
    toUserId: connection.toUserId,
    rawSize: plaintext.byteLength,
    rawMd5: createHash('md5').update(plaintext).digest('hex'),
    encryptedSize: ciphertext.byteLength,
    aesKeyHex: aesKey.toString('hex'),
  })
  const downloadParam = await client.uploadMedia(target, fileKey, ciphertext, signal)
  const wireKey = Buffer.from(aesKey.toString('hex'), 'ascii').toString('base64')
  const item: IlinkOutboundMediaItem = file.kind === 'image'
    ? {
      type: 2,
      image_item: {
        media: { encrypt_query_param: downloadParam, aes_key: wireKey, encrypt_type: 1 },
        mid_size: ciphertext.byteLength,
      },
    }
    : {
      type: 4,
      file_item: {
        media: { encrypt_query_param: downloadParam, aes_key: wireKey, encrypt_type: 1 },
        file_name: file.name,
        len: String(plaintext.byteLength),
      },
    }
  await client.sendMedia(
    connection.baseUrl, connection.token, connection.toUserId, connection.contextToken, item, caption,
  )
}
