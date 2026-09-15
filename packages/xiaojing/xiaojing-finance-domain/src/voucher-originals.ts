/** Bounded downloads of allowlisted Youcheng copies; vendor filenames and sizes are not evidence. */
import { createHash } from 'node:crypto'
import { z } from 'zod'

/** Host-owned original identity, independent of vendor display metadata. */
export interface VoucherOriginalIdentity { sha256: string; size: number; expiresAt: number; downloadUrl: string }

/** Deployment-owned destinations and total verification limits. */
export interface VoucherOriginalVerificationOptions { hosts: string[]; maxBytes: number; timeoutMs: number }

/** No URLs or vendor filenames cross into this model-visible result. */
export interface VoucherOriginalVerification {
  association: 'matched' | 'mismatch' | 'unavailable' | 'not-required'
  retention: 'verified' | 'pending' | 'unavailable' | 'not-required'
  verifiedCount: number
  metadataWarning: boolean
}

/**
 * Download the exact number of allowlisted copies and compare a multiset of original byte hashes/sizes.
 * @param data - Bounded detail response after account and voucher identity validation.
 * @param expected - Selected private upload receipts; no display-name matching.
 * @param options - Exact trusted hostnames, aggregate byte limit and whole verification timeout.
 * @param stopped - Caller and Host cancellation.
 * @returns Independent association and post-source-expiry retention evidence; failures never imply absent originals.
 */
export async function verifyVoucherOriginals(data: unknown, expected: readonly VoucherOriginalIdentity[],
  options: VoucherOriginalVerificationOptions, stopped: AbortSignal): Promise<VoucherOriginalVerification> {
  const result: VoucherOriginalVerification = { association: 'unavailable', retention: 'unavailable', verifiedCount: 0, metadataWarning: false }
  if (expected.length === 0) return { ...result, association: 'not-required', retention: 'not-required' }
  if (expected.reduce((sum, item) => sum + item.size, 0) > options.maxBytes) return result
  const parsed = z.object({ attachmentList: z.array(z.object({ downloadUrl: z.url(), fileName: z.string().optional(),
    fileSize: z.string().optional() })) }).safeParse(data)
  if (!parsed.success) return result
  const files = parsed.data.attachmentList
  if (files.length !== expected.length) return { ...result, association: 'mismatch' }
  const urls = files.map(file => new URL(file.downloadUrl))
  const sources = expected.map(item => new URL(item.downloadUrl))
  if (urls.some(url => url.protocol !== 'https:' || url.username || url.password || url.hash || url.port
    || !options.hosts.includes(url.hostname)
    || sources.some(source => source.origin === url.origin && source.pathname === url.pathname))
    || new Set(urls.map(url => url.href)).size !== urls.length) return result
  result.metadataWarning = files.some(file => /x-oss-signature|x-oss-credential|aliyun_v4_request/.test(file.fileName ?? ''))
  const signal = AbortSignal.any([stopped, AbortSignal.timeout(options.timeoutMs)])
  const startedAt = Date.now()
  const observed: string[] = []
  let aggregate = 0
  try {
    for (const [index, url] of urls.entries()) {
      signal.throwIfAborted()
      const response = await fetch(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal })
      if (!response.ok) { await response.body?.cancel(); return result }
      const reader = response.body?.getReader()
      if (reader === undefined) return result
      const hash = createHash('sha256')
      let size = 0
      try {
        while (true) {
          signal.throwIfAborted()
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          aggregate += chunk.value.byteLength
          if (aggregate > options.maxBytes) return result
          hash.update(chunk.value)
        }
      } finally { await reader.cancel() }
      if (files[index]?.fileSize !== String(size)) result.metadataWarning = true
      observed.push(`${size}:${hash.digest('hex')}`)
    }
    signal.throwIfAborted()
    const identities = expected.map(item => `${item.size}:${item.sha256}`).sort()
    observed.sort()
    if (!observed.every((identity, index) => identity === identities[index])) return { ...result, association: 'mismatch' }
    return { ...result, association: 'matched', verifiedCount: expected.length,
      retention: expected.every(item => startedAt > item.expiresAt) ? 'verified' : 'pending' }
  } catch {
    // Network, abort and stream errors leave copy verification unavailable; none authorizes a resend.
    return result
  }
}
