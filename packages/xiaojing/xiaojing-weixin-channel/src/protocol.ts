/** Minimal Tencent iLink Bot JSON transport ported from the reviewed official implementation. */

import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'

const QR_BASE_URL = 'https://ilinkai.weixin.qq.com'
const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c/'
const ILINK_APP_ID = 'bot'
const ILINK_CLIENT_VERSION = '131072'
const BASE_INFO = Object.freeze({
  channel_version: '0.2.0',
  bot_agent: 'XiaojingAccounting/0.2.0',
})

const pairingSchema = z.object({
  qrcode: z.string().min(1).max(4096),
  qrcode_img_content: z.string().min(1).max(8192),
})

const pairingStatusSchema = z.object({
  status: z.enum([
    'wait', 'scaned', 'confirmed', 'expired', 'scaned_but_redirect',
    'need_verifycode', 'verify_code_blocked', 'binded_redirect',
  ]),
  bot_token: z.string().min(1).optional(),
  ilink_bot_id: z.string().min(1).optional(),
  baseurl: z.string().min(1).optional(),
  ilink_user_id: z.string().min(1).optional(),
  redirect_host: z.string().min(1).optional(),
})

const cdnMediaSchema = z.object({
  encrypt_query_param: z.string().min(1).optional(),
  aes_key: z.string().min(1).optional(),
  encrypt_type: z.number().int().optional(),
  full_url: z.string().min(1).optional(),
})

const messageItemSchema = z.looseObject({
  type: z.number().int().optional(),
  text_item: z.object({ text: z.string().optional() }).optional(),
  image_item: z.object({
    media: cdnMediaSchema.optional(),
    aeskey: z.string().min(1).optional(),
    mid_size: z.number().int().nonnegative().optional(),
  }).optional(),
  file_item: z.object({
    media: cdnMediaSchema.optional(),
    file_name: z.string().optional(),
    md5: z.string().optional(),
    len: z.string().optional(),
  }).optional(),
  voice_item: z.object({ media: cdnMediaSchema.optional(), text: z.string().optional() }).optional(),
  video_item: z.object({ media: cdnMediaSchema.optional() }).optional(),
})

const incomingMessageSchema = z.looseObject({
  seq: z.number().int().optional(),
  message_id: z.union([z.number(), z.string()]).optional(),
  from_user_id: z.string().optional(),
  to_user_id: z.string().optional(),
  client_id: z.string().optional(),
  create_time_ms: z.number().optional(),
  session_id: z.string().optional(),
  group_id: z.string().optional(),
  message_type: z.number().int().optional(),
  item_list: z.array(messageItemSchema).optional(),
  context_token: z.string().optional(),
})

const updatesSchema = z.object({
  ret: z.number().optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
  msgs: z.array(incomingMessageSchema).optional(),
  get_updates_buf: z.string().optional(),
  longpolling_timeout_ms: z.number().int().positive().optional(),
})

const resultSchema = z.object({
  ret: z.number().optional(),
  errmsg: z.string().optional(),
})

const configSchema = resultSchema.extend({ typing_ticket: z.string().optional() })

const uploadTargetSchema = z.object({
  upload_param: z.string().min(1).optional(),
  upload_full_url: z.string().min(1).optional(),
}).refine(value => value.upload_param !== undefined || value.upload_full_url !== undefined)

/** Pairing lifecycle values returned by the official iLink service. */
export type IlinkPairingStatus = z.infer<typeof pairingStatusSchema>
/** One decoded inbound iLink message. */
export type IlinkIncomingMessage = z.infer<typeof incomingMessageSchema>
/** One decoded text or media item inside an inbound iLink message. */
export type IlinkMessageItem = z.infer<typeof messageItemSchema>
/** Tencent CDN reference carried by one iLink media item. */
export type IlinkCdnMedia = z.infer<typeof cdnMediaSchema>
/** One decoded long-poll response. */
export type IlinkUpdates = z.infer<typeof updatesSchema>

/** Metadata required before uploading one encrypted media file. */
export interface IlinkUploadRequest {
  /** Random opaque key for this upload. */
  fileKey: string
  /** `1` for an image or `3` for a document. */
  mediaType: 1 | 3
  /** Bound scanner identity. */
  toUserId: string
  /** Plaintext byte length. */
  rawSize: number
  /** Plaintext MD5 required by iLink. */
  rawMd5: string
  /** AES-ECB ciphertext byte length. */
  encryptedSize: number
  /** Raw 16-byte AES key represented as lowercase hex. */
  aesKeyHex: string
}

/** Server-issued upload destination restricted to Tencent's CDN. */
export interface IlinkUploadTarget {
  /** Legacy encrypted upload query parameter. */
  uploadParam?: string
  /** Preferred full Tencent CDN upload URL. */
  uploadFullUrl?: string
}

/** Outbound iLink image or document item. */
export type IlinkOutboundMediaItem =
  | {
    type: 2
    image_item: {
      media: { encrypt_query_param: string; aes_key: string; encrypt_type: 1 }
      mid_size: number
    }
  }
  | {
    type: 4
    file_item: {
      media: { encrypt_query_param: string; aes_key: string; encrypt_type: 1 }
      file_name: string
      len: string
    }
  }

/** iLink transport configuration supplied by the Cordis plugin. */
export interface IlinkClientOptions {
  /** Timeout for ordinary API requests. */
  requestTimeoutMs: number
  /** Timeout for the QR and message long polls. */
  longPollTimeoutMs: number
  /** Timeout for one bounded Tencent CDN upload or download. */
  mediaTransferTimeoutMs: number
  /** Injectable fetch for protocol tests. */
  fetch?: typeof globalThis.fetch
}

function officialBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || (url.hostname !== 'weixin.qq.com' && !url.hostname.endsWith('.weixin.qq.com'))) {
    throw new Error('iLink returned a non-official service address')
  }
  url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function officialCdnUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || (url.hostname !== 'cdn.weixin.qq.com' && !url.hostname.endsWith('.cdn.weixin.qq.com'))
  ) {
    throw new Error('iLink returned a non-official CDN address')
  }
  return url
}

function cdnDownloadUrl(media: IlinkCdnMedia): URL {
  if (media.full_url !== undefined) return officialCdnUrl(media.full_url)
  if (media.encrypt_query_param === undefined) throw new Error('iLink media reference has no download address')
  const url = new URL('download', CDN_BASE_URL)
  url.searchParams.set('encrypted_query_param', media.encrypt_query_param)
  return url
}

function cdnUploadUrl(target: IlinkUploadTarget, fileKey: string): URL {
  if (target.uploadFullUrl !== undefined) return officialCdnUrl(target.uploadFullUrl)
  if (target.uploadParam === undefined) throw new Error('iLink media upload has no destination')
  const url = new URL('upload', CDN_BASE_URL)
  url.searchParams.set('encrypted_query_param', target.uploadParam)
  url.searchParams.set('filekey', fileKey)
  return url
}

async function boundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('iLink media exceeds the configured file limit')
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new Error('iLink media exceeds the configured file limit')
      }
      chunks.push(Buffer.from(next.value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, bytes)
}

function commonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': ILINK_CLIENT_VERSION,
  }
}

function authenticatedHeaders(token?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64'),
    ...commonHeaders(),
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
  }
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort() }, timeoutMs)
  const combined = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
  return { signal: combined, dispose: () => { clearTimeout(timer) } }
}

/** Tencent iLink Bot API client with fixed official authorities and redaction-safe errors. */
export class IlinkClient {
  private readonly fetch: typeof globalThis.fetch

  /** @param options - request deadlines and optional test transport. */
  constructor(private readonly options: IlinkClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  private async request(
    baseUrl: string,
    endpoint: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const base = officialBaseUrl(baseUrl)
    const deadline = withTimeout(signal, timeoutMs)
    try {
      const response = await this.fetch(new URL(endpoint, base), { ...init, signal: deadline.signal })
      if (!response.ok) throw new Error(`iLink request failed with HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      if (signal?.aborted) throw error
      if (deadline.signal.aborted) throw new Error('iLink request timed out')
      throw error
    } finally {
      deadline.dispose()
    }
  }

  /**
   * Request one QR pairing payload.
   * @param localTokens - existing local bot tokens sent only for Tencent's duplicate-binding check.
   * @returns opaque QR identity and the QR payload rendered by the Host.
   */
  async startPairing(localTokens: readonly string[] = []): Promise<{ qrcode: string; qrPayload: string }> {
    const value = await this.request(
      QR_BASE_URL,
      'ilink/bot/get_bot_qrcode?bot_type=3',
      {
        method: 'POST',
        headers: authenticatedHeaders(),
        body: JSON.stringify({ local_token_list: localTokens.slice(0, 10) }),
      },
      this.options.requestTimeoutMs,
    )
    const parsed = pairingSchema.parse(value)
    return { qrcode: parsed.qrcode, qrPayload: parsed.qrcode_img_content }
  }

  /**
   * Long-poll one QR pairing attempt.
   * @param qrcode - opaque identity returned by {@link startPairing}.
   * @param verifyCode - optional numeric code displayed by Weixin.
   * @param baseUrl - current official iLink authority, including a validated redirect.
   * @param signal - cancellation for the active pairing attempt.
   * @returns one validated pairing state.
   */
  async pairingStatus(
    qrcode: string,
    verifyCode: string | undefined,
    baseUrl: string = QR_BASE_URL,
    signal?: AbortSignal,
  ): Promise<IlinkPairingStatus> {
    const query = new URLSearchParams({ qrcode })
    if (verifyCode !== undefined) query.set('verify_code', verifyCode)
    try {
      const value = await this.request(
        baseUrl,
        `ilink/bot/get_qrcode_status?${query.toString()}`,
        { method: 'GET', headers: commonHeaders() },
        this.options.longPollTimeoutMs,
        signal,
      )
      return pairingStatusSchema.parse(value)
    } catch (error) {
      if (!signal?.aborted && error instanceof Error && error.message === 'iLink request timed out') {
        return { status: 'wait' }
      }
      throw error
    }
  }

  /**
   * Read one message batch and its replacement cursor.
   * @param baseUrl - server-issued official iLink authority.
   * @param token - private bot credential.
   * @param cursor - last committed opaque polling cursor.
   * @param timeoutMs - server-adjusted bounded long-poll deadline.
   * @param signal - channel-lifecycle cancellation.
   * @returns one validated update batch.
   */
  async getUpdates(baseUrl: string, token: string, cursor: string, timeoutMs: number, signal: AbortSignal): Promise<IlinkUpdates> {
    try {
      const value = await this.request(
        baseUrl,
        'ilink/bot/getupdates',
        {
          method: 'POST',
          headers: authenticatedHeaders(token),
          body: JSON.stringify({ get_updates_buf: cursor, base_info: BASE_INFO }),
        },
        timeoutMs,
        signal,
      )
      return updatesSchema.parse(value)
    } catch (error) {
      if (!signal.aborted && error instanceof Error && error.message === 'iLink request timed out') {
        return { ret: 0, msgs: [], get_updates_buf: cursor }
      }
      throw error
    }
  }

  /**
   * Send one finished text message with its inbound reply context.
   * @param baseUrl - server-issued official iLink authority.
   * @param token - private bot credential.
   * @param to - scanner identity that owns this connection.
   * @param contextToken - conversation context copied from the inbound message.
   * @param text - non-empty plain-text delivery part.
   * @param signal - optional channel or progress-notification cancellation.
   */
  async sendText(
    baseUrl: string,
    token: string,
    to: string,
    contextToken: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const value = await this.request(
      baseUrl,
      'ilink/bot/sendmessage',
      {
        method: 'POST',
        headers: authenticatedHeaders(token),
        body: JSON.stringify({
          msg: {
            from_user_id: '',
            to_user_id: to,
            client_id: `xiaojing-${randomUUID()}`,
            message_type: 2,
            message_state: 2,
            item_list: [{ type: 1, text_item: { text } }],
            context_token: contextToken,
          },
          base_info: BASE_INFO,
        }),
      },
      this.options.requestTimeoutMs,
      signal,
    )
    const parsed = resultSchema.parse(value)
    if (parsed.ret !== undefined && parsed.ret !== 0) throw new Error(`iLink send failed (${parsed.ret})`)
  }

  /**
   * Download one media ciphertext or plaintext from Tencent's fixed CDN authorities.
   * @param media - server-issued media reference.
   * @param maxBytes - hard response-body byte limit.
   * @param signal - channel or task cancellation.
   * @returns bounded response bytes.
   */
  async downloadMedia(media: IlinkCdnMedia, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
    const deadline = withTimeout(signal, this.options.mediaTransferTimeoutMs)
    try {
      const response = await this.fetch(cdnDownloadUrl(media), {
        method: 'GET', redirect: 'error', signal: deadline.signal,
      })
      if (!response.ok) throw new Error(`iLink CDN download failed with HTTP ${response.status}`)
      return await boundedBody(response, maxBytes)
    } catch (error) {
      if (signal?.aborted) throw error
      if (deadline.signal.aborted) throw new Error('iLink media request timed out')
      throw error
    } finally {
      deadline.dispose()
    }
  }

  /**
   * Request a Tencent CDN upload destination for one encrypted local file.
   * @param baseUrl - server-issued official iLink authority.
   * @param token - private bot credential.
   * @param request - integrity and encryption metadata required by iLink.
   * @returns a validated upload destination without exposing it to the browser or model.
   */
  async getUploadTarget(baseUrl: string, token: string, request: IlinkUploadRequest): Promise<IlinkUploadTarget> {
    const value = await this.request(
      baseUrl,
      'ilink/bot/getuploadurl',
      {
        method: 'POST',
        headers: authenticatedHeaders(token),
        body: JSON.stringify({
          filekey: request.fileKey,
          media_type: request.mediaType,
          to_user_id: request.toUserId,
          rawsize: request.rawSize,
          rawfilemd5: request.rawMd5,
          filesize: request.encryptedSize,
          no_need_thumb: true,
          aeskey: request.aesKeyHex,
          base_info: BASE_INFO,
        }),
      },
      this.options.requestTimeoutMs,
    )
    const parsed = uploadTargetSchema.parse(value)
    if (parsed.upload_full_url !== undefined) officialCdnUrl(parsed.upload_full_url)
    return {
      ...(parsed.upload_param === undefined ? {} : { uploadParam: parsed.upload_param }),
      ...(parsed.upload_full_url === undefined ? {} : { uploadFullUrl: parsed.upload_full_url }),
    }
  }

  /**
   * Upload AES-encrypted bytes to a validated Tencent CDN destination.
   * @param target - destination returned by {@link getUploadTarget}.
   * @param fileKey - opaque upload key sent to iLink.
   * @param ciphertext - complete AES-ECB ciphertext.
   * @param signal - active tool cancellation.
   * @returns the opaque CDN download parameter used in the outbound message item.
   */
  async uploadMedia(
    target: IlinkUploadTarget,
    fileKey: string,
    ciphertext: Buffer,
    signal?: AbortSignal,
  ): Promise<string> {
    const deadline = withTimeout(signal, this.options.mediaTransferTimeoutMs)
    try {
      const response = await this.fetch(cdnUploadUrl(target, fileKey), {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(ciphertext),
        signal: deadline.signal,
      })
      if (!response.ok) throw new Error(`iLink CDN upload failed with HTTP ${response.status}`)
      const downloadParam = response.headers.get('x-encrypted-param')?.trim()
      if (!downloadParam) throw new Error('iLink CDN upload response omitted its download parameter')
      return downloadParam
    } catch (error) {
      if (signal?.aborted) throw error
      if (deadline.signal.aborted) throw new Error('iLink media request timed out')
      throw error
    } finally {
      deadline.dispose()
    }
  }

  /**
   * Send an optional caption followed by one image or document item.
   * @param baseUrl - server-issued official iLink authority.
   * @param token - private bot credential.
   * @param to - bound scanner identity.
   * @param contextToken - active inbound reply context.
   * @param item - uploaded image or document reference.
   * @param caption - optional plain-text caption sent as a separate item.
   */
  async sendMedia(
    baseUrl: string,
    token: string,
    to: string,
    contextToken: string,
    item: IlinkOutboundMediaItem,
    caption?: string,
  ): Promise<void> {
    if (caption !== undefined && caption.trim() !== '') {
      await this.sendText(baseUrl, token, to, contextToken, caption.trim())
    }
    const value = await this.request(
      baseUrl,
      'ilink/bot/sendmessage',
      {
        method: 'POST',
        headers: authenticatedHeaders(token),
        body: JSON.stringify({
          msg: {
            from_user_id: '',
            to_user_id: to,
            client_id: `xiaojing-${randomUUID()}`,
            message_type: 2,
            message_state: 2,
            item_list: [item],
            context_token: contextToken,
          },
          base_info: BASE_INFO,
        }),
      },
      this.options.requestTimeoutMs,
    )
    const parsed = resultSchema.parse(value)
    if (parsed.ret !== undefined && parsed.ret !== 0) throw new Error(`iLink send failed (${parsed.ret})`)
  }

  /**
   * Resolve the server-issued typing ticket for one conversation.
   * @param baseUrl - server-issued official iLink authority.
   * @param token - private bot credential.
   * @param userId - scanner identity that owns this connection.
   * @param contextToken - conversation context copied from the inbound message.
   * @returns an opaque typing ticket, or `undefined` when the service supplies none.
   */
  async getTypingTicket(baseUrl: string, token: string, userId: string, contextToken: string): Promise<string | undefined> {
    const value = await this.request(
      baseUrl,
      'ilink/bot/getconfig',
      {
        method: 'POST',
        headers: authenticatedHeaders(token),
        body: JSON.stringify({ ilink_user_id: userId, context_token: contextToken, base_info: BASE_INFO }),
      },
      this.options.requestTimeoutMs,
    )
    const parsed = configSchema.parse(value)
    if (parsed.ret !== undefined && parsed.ret !== 0) return undefined
    return parsed.typing_ticket
  }

  /** Toggle the native “正在输入” indicator. */
  /**
   * Toggle the native typing indicator.
   * @param baseUrl - server-issued official iLink authority.
   * @param token - private bot credential.
   * @param userId - scanner identity that owns this connection.
   * @param ticket - opaque ticket returned by {@link getTypingTicket}.
   * @param typing - whether the indicator is active.
   */
  async sendTyping(baseUrl: string, token: string, userId: string, ticket: string, typing: boolean): Promise<void> {
    await this.request(
      baseUrl,
      'ilink/bot/sendtyping',
      {
        method: 'POST',
        headers: authenticatedHeaders(token),
        body: JSON.stringify({
          ilink_user_id: userId,
          typing_ticket: ticket,
          status: typing ? 1 : 2,
          base_info: BASE_INFO,
        }),
      },
      this.options.requestTimeoutMs,
    )
  }

  /**
   * Notify iLink that this desktop channel started or stopped polling.
   * @param baseUrl - server-issued official iLink authority.
   * @param token - private bot credential.
   * @param state - active polling lifecycle edge.
   */
  async notify(baseUrl: string, token: string, state: 'start' | 'stop'): Promise<void> {
    await this.request(
      baseUrl,
      `ilink/bot/msg/notify${state}`,
      {
        method: 'POST',
        headers: authenticatedHeaders(token),
        body: JSON.stringify({ base_info: BASE_INFO }),
      },
      this.options.requestTimeoutMs,
    )
  }
}

/**
 * Validate and normalize a server-issued redirect or account base URL.
 * @param value - candidate HTTPS URL returned by iLink.
 * @returns normalized URL restricted to Tencent's `weixin.qq.com` authority.
 */
export function normalizeOfficialIlinkBaseUrl(value: string): string {
  return officialBaseUrl(value)
}
