/** Source authorization, hash verification, serialized parsing, and cache reuse. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { financeDocumentKindFromName } from './parser.ts'
import { FinanceDocumentStore } from './store.ts'
import type { DocumentSource } from './compat.ts'
import type {
  FinanceDocumentExtractedVisual,
  FinanceDocumentParseLimits,
  FinanceDocumentVisual,
  FinanceNormalizedDocument,
} from './types.ts'
import { FinanceDocumentWorkerError, runFinanceDocumentWorker } from './worker-runner.ts'

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child.length > 0 && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && child !== '..' && !isAbsolute(child)
}

async function canonicalSource(source: DocumentSource): Promise<string> {
  const [root, fileStat] = await Promise.all([realpath(source.sourceRoot), lstat(source.file.path)])
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new FinanceDocumentWorkerError('source-not-regular-file')
  }
  if (fileStat.size !== source.file.size) throw new FinanceDocumentWorkerError('source-size-changed')
  const file = await realpath(source.file.path)
  if (!isWithin(root, file)) throw new FinanceDocumentWorkerError('source-outside-authorized-root')
  return file
}

async function verifyDigest(filename: string, expected: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new FinanceDocumentWorkerError('aborted')
  const digest = createHash('sha256')
  const stream = createReadStream(filename)
  const onAbort = (): void => { stream.destroy(new FinanceDocumentWorkerError('aborted')) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const chunk of stream) digest.update(chunk as Buffer)
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  if (digest.digest('hex') !== expected) throw new FinanceDocumentWorkerError('source-digest-changed')
}

function failedDocument(
  source: DocumentSource,
  code: string,
  normalizedAt: number,
): FinanceNormalizedDocument {
  return {
    schemaVersion: 3,
    normalizerVersion: 4,
    sha256: source.file.sha256,
    size: source.file.size,
    kind: financeDocumentKindFromName(source.file.name),
    status: 'failed',
    normalizedAt,
    summary: { unitCount: 0, charCount: 0 },
    units: [],
    visuals: [],
    warnings: [],
    failureCode: code,
  }
}

/** Serial normalizer that protects the Host while preserving hash-cache reuse. */
export class FinanceDocumentNormalizer {
  private readonly inflight = new Map<string, Promise<FinanceNormalizedDocument>>()
  private queue: Promise<void> = Promise.resolve()
  private closed = false

  /**
   * @param store - Private normalized-document cache.
   * @param limits - Parser resource limits.
   * @param timeoutMs - Worker wall deadline.
   * @param workerMemoryMb - Worker V8 heap ceiling.
   * @param serviceSignal - Service-lifetime cancellation signal.
   */
  constructor(
    private readonly store: FinanceDocumentStore,
    private readonly limits: FinanceDocumentParseLimits,
    private readonly timeoutMs: number,
    private readonly workerMemoryMb: number,
    private readonly serviceSignal: AbortSignal,
  ) {}

  private assertRunning(): void {
    if (this.closed || this.serviceSignal.aborted) throw new FinanceDocumentWorkerError('service-stopped')
  }

  /** Refuse new work and await every admitted parser. */
  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.inflight.values(), this.queue])
  }

  /**
   * Normalize one authorized import or reuse its isolated hash cache.
   * @param source - Authorized original-material source.
   * @returns Durable normalized record, or an uncached failure record when the authorized file exceeds the parser limit.
   */
  async ensure(source: DocumentSource): Promise<FinanceNormalizedDocument> {
    this.assertRunning()
    const sourcePath = await canonicalSource(source)
    const kind = financeDocumentKindFromName(source.file.name)
    if (source.file.size > this.limits.maxFileBytes) {
      return failedDocument(source, 'file-too-large', Date.now())
    }
    await verifyDigest(sourcePath, source.file.sha256, this.serviceSignal)
    const cached = await this.store.get(source.cacheScope, source.file.sha256, kind)
    if (cached !== undefined) return cached
    const key = `${source.cacheScope}:${source.file.sha256}:${kind}`
    const current = this.inflight.get(key)
    if (current !== undefined) return await current
    let release!: () => void
    const predecessor = this.queue
    this.queue = new Promise<void>((resolve) => { release = resolve })
    const promise = predecessor.then(async () => {
      this.assertRunning()
      const raced = await this.store.get(source.cacheScope, source.file.sha256, kind)
      if (raced !== undefined) return raced
      const message = await runFinanceDocumentWorker({
        action: 'normalize',
        sourcePath,
        originalName: source.file.name,
        expectedSha256: source.file.sha256,
        expectedSize: source.file.size,
        limits: this.limits,
      }, this.timeoutMs, this.workerMemoryMb, this.serviceSignal)
      if (message.action !== 'normalize') throw new FinanceDocumentWorkerError('worker-result-action-mismatch')
      const document = message.ok ? message.document : failedDocument(source, message.code, Date.now())
      if (document.kind !== kind || document.sha256 !== source.file.sha256 || document.size !== source.file.size) {
        throw new FinanceDocumentWorkerError('worker-result-source-mismatch')
      }
      return await this.store.put(source.cacheScope, document)
    }).finally(() => {
      release()
      this.inflight.delete(key)
    })
    this.inflight.set(key, promise)
    return await promise
  }

  /**
   * Extract one exact bounded document-image batch after normalization selected its source keys.
   * @param source - Adapter-authorized source.
   * @param visuals - Visual metadata selected from the source's normalized record.
   * @param maxOutputBytes - Maximum aggregate bytes returned by the worker.
   * @returns Verified image bytes in requested order.
   */
  async extractVisuals(
    source: DocumentSource,
    visuals: readonly FinanceDocumentVisual[],
    maxOutputBytes: number,
  ): Promise<FinanceDocumentExtractedVisual[]> {
    this.assertRunning()
    if (visuals.length === 0) return []
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
      throw new FinanceDocumentWorkerError('invalid-visual-byte-limit')
    }
    const sourcePath = await canonicalSource(source)
    const kind = financeDocumentKindFromName(source.file.name)
    if (kind !== 'pdf' && kind !== 'docx' && kind !== 'xlsx' && kind !== 'pptx' && kind !== 'ofd') {
      throw new FinanceDocumentWorkerError('document-kind-has-no-visuals')
    }
    await verifyDigest(sourcePath, source.file.sha256, this.serviceSignal)
    let release!: () => void
    const predecessor = this.queue
    this.queue = new Promise<void>((resolve) => { release = resolve })
    try {
      await predecessor
      this.assertRunning()
      const message = await runFinanceDocumentWorker({
        action: 'extract-visuals',
        sourcePath,
        originalName: source.file.name,
        expectedSha256: source.file.sha256,
        expectedSize: source.file.size,
        kind,
        visualKeys: visuals.map(visual => visual.sourceKey),
        maxVisuals: visuals.length,
        maxFileBytes: this.limits.maxFileBytes,
        maxOutputBytes,
      }, this.timeoutMs, this.workerMemoryMb, this.serviceSignal)
      if (message.action !== 'extract-visuals') {
        throw new FinanceDocumentWorkerError('worker-result-action-mismatch')
      }
      if (!message.ok) throw new FinanceDocumentWorkerError(message.code)
      if (message.visuals.length !== visuals.length) throw new FinanceDocumentWorkerError('worker-result-visual-count-mismatch')
      for (let index = 0; index < visuals.length; index += 1) {
        const expected = visuals[index]
        const actual = message.visuals[index]
        if (expected === undefined || actual === undefined
          || actual.sourceKey !== expected.sourceKey
          || actual.mediaType !== expected.mediaType
          || actual.data.byteLength !== expected.bytes) {
          throw new FinanceDocumentWorkerError('worker-result-visual-mismatch')
        }
      }
      return message.visuals
    } finally {
      release()
    }
  }
}
