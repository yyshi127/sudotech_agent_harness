/** Browser-safe status and durable record types for the Xiaojing Weixin channel. */

/** Connection states presented by the local channel settings page. */
export type WeixinConnectionState =
  | 'disconnected'
  | 'pairing'
  | 'scanned'
  | 'verification-required'
  | 'connected'
  | 'reconnecting'
  | 'expired'
  | 'token-expired'
  | 'instance-busy'
  | 'error'

/** Sanitized channel state returned to the loopback browser Client. */
export interface WeixinChannelStatus {
  /** Current pairing or monitor lifecycle state. */
  state: WeixinConnectionState
  /** Whether the long-poll monitor is currently accepting messages. */
  online: boolean
  /** Masked bot account identity; absent before a successful pairing. */
  accountLabel?: string
  /** QR image bytes for the active pairing attempt. */
  qrCodeDataUrl?: string
  /** QR expiry as Unix epoch milliseconds. */
  qrExpiresAt?: number
  /** Whether the phone requested a numeric verification code. */
  verificationRequired: boolean
  /** User-safe diagnostic without tokens, context values, or local paths. */
  error?: string
}

/** One inbound image or document retained with its originating task. */
export interface WeixinPendingAttachment {
  /** Transport-level media kind; images are not automatically understood or OCR-processed. */
  kind: 'image' | 'file'
  /** Sanitized unique filename in the local upload directory. */
  name: string
  /** Absolute private local path supplied to the Agent. */
  path: string
  /** Best-effort MIME type. */
  mediaType: string
  /** Decrypted plaintext size. */
  bytes: number
}

/** One inbound task retained until its result has been delivered. */
export interface WeixinPendingMessage {
  /** Stable iLink message identity used for deduplication. */
  id: string
  /** Stable Host RPC identity recorded on the corresponding user message. */
  rpcId: string
  /** Scanner identity authorized for this installation. */
  fromUserId: string
  /** iLink reply context, kept only in the private Host state file. */
  contextToken: string
  /** Plain inbound instruction; empty for a media-only message. */
  text: string
  /** Images and documents already saved in the local upload directory. */
  attachments: WeixinPendingAttachment[]
  /** Receipt time as Unix epoch milliseconds. */
  receivedAt: number
  /** Durable progress marker for crash recovery. */
  phase: 'received' | 'submitted'
}

/** Versioned private state; the bot token is deliberately absent. */
export interface WeixinChannelStateFile {
  schemaVersion: 2
  /** Bot identity issued by iLink. */
  accountId?: string
  /** Scanner identity accepted for direct messages. */
  ownerUserId?: string
  /** Server-issued official iLink base URL. */
  baseUrl?: string
  /** Durable Agent session visible as “微信助手”. */
  sessionId?: string
  /** Whether the dedicated session title was committed after creation. */
  sessionReady: boolean
  /** Opaque long-poll cursor. */
  updatesCursor: string
  /** Tasks not yet delivered back to Weixin. */
  pending: WeixinPendingMessage[]
  /** Bounded stable ids already delivered or intentionally rejected. */
  completedMessageIds: string[]
}
