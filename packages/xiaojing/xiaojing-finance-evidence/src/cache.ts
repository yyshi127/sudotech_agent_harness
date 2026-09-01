/** Versioned bounded cache for structured official evidence metadata and short excerpts. */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import type { FinanceEvidenceItem } from './types.ts'

const SCHEMA_VERSION = 1
const FILE_MODE = 0o600
const DIR_MODE = 0o700

const itemSchema = z.object({
  sourceId: z.string().min(1),
  authority: z.string().min(1),
  authorityLevel: z.enum(['L0', 'L1', 'L2', 'L3']),
  title: z.string().min(1),
  documentNumber: z.string().optional(),
  publicationDate: z.string().optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
  lifecycle: z.enum(['current', 'historical', 'future', 'repealed', 'draft', 'amended', 'transitional', 'unverified']),
  legalEffect: z.enum(['law', 'administrative-regulation', 'departmental-rule', 'normative-document', 'official-guidance', 'unknown']),
  applicability: z.enum(['national-conditional', 'local-conditional', 'background-only', 'unverified']),
  role: z.literal('official-text'),
  url: z.url(),
  retrievedAt: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  excerpt: z.string(),
  retrieval: z.enum(['network', 'cache']),
  rightsStatus: z.literal('terms-review-pending'),
  limitations: z.array(z.string()),
}).strict()

const entrySchema = z.object({
  url: z.url(),
  cachedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  item: itemSchema,
}).strict()

const documentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  entries: z.array(entrySchema),
}).strict()

interface CacheEntry {
  url: string
  cachedAt: number
  expiresAt: number
  item: FinanceEvidenceItem
}

interface CacheDocument {
  schemaVersion: 1
  entries: CacheEntry[]
}

async function readOptional(filename: string): Promise<string | undefined> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseDocument(text: string, filename: string): CacheDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`xiaojing-finance-evidence: cannot parse ${filename}; preserve the file and repair or migrate it`, { cause: error })
  }
  const parsed = documentSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`xiaojing-finance-evidence: ${filename} is not a valid evidence cache schema v1 document; preserve it and repair or migrate it`)
  }
  return parsed.data as CacheDocument
}

function render(document: CacheDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

/** Local cache that never stores full official documents. */
export class FinanceEvidenceCache {
  /** Versioned cache file path. */
  readonly filePath: string

  /** @param dshHome - Fixed Harness data root. @param maxEntries - Entry ceiling. @param ttlMs - Entry lifetime. */
  constructor(
    dshHome: string,
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {
    this.filePath = join(dshHome, 'finance', 'evidence-cache-v1.json')
  }

  /** Validate the existing cache or create an empty schema document. */
  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: DIR_MODE })
    const existing = await readOptional(this.filePath)
    if (existing !== undefined) {
      parseDocument(existing, this.filePath)
      return
    }
    await withFileLock(this.filePath, async () => {
      const raced = await readOptional(this.filePath)
      if (raced !== undefined) {
        parseDocument(raced, this.filePath)
        return
      }
      await writeFileAtomic(this.filePath, render({ schemaVersion: 1, entries: [] }), {
        mode: FILE_MODE,
        dirMode: DIR_MODE,
      })
    })
  }

  /**
   * Read one unexpired item.
   * @param url - Official URL.
   * @param now - Epoch milliseconds.
   * @returns Cached item, or undefined when absent or expired.
   */
  async get(url: string, now: number): Promise<FinanceEvidenceItem | undefined> {
    const document = await this.readDocument()
    const entry = document.entries.find(candidate => candidate.url === url && candidate.expiresAt > now)
    return entry === undefined ? undefined : { ...structuredClone(entry.item), retrieval: 'cache' }
  }

  /**
   * Store one fetched item after enforcing TTL and count limits.
   * @param item - Structured official evidence.
   * @param now - Epoch milliseconds.
   */
  async put(item: FinanceEvidenceItem, now: number): Promise<void> {
    if (item.role !== 'official-text' || item.excerpt === undefined || item.sha256 === undefined || item.retrievedAt === undefined) {
      throw new Error('xiaojing-finance-evidence: only bounded fetched official evidence may enter the cache')
    }
    await withFileLock(this.filePath, async () => {
      const document = await this.readDocument()
      const retained = document.entries.filter(entry => entry.expiresAt > now && entry.url !== item.url)
      const entries = [
        ...retained,
        { url: item.url, cachedAt: now, expiresAt: now + this.ttlMs, item: { ...structuredClone(item), retrieval: 'network' as const } },
      ].sort((a, b) => b.cachedAt - a.cachedAt).slice(0, this.maxEntries)
      await writeFileAtomic(this.filePath, render({ schemaVersion: 1, entries }), {
        mode: FILE_MODE,
        dirMode: DIR_MODE,
      })
    })
  }

  private async readDocument(): Promise<CacheDocument> {
    const text = await readOptional(this.filePath)
    if (text === undefined) throw new Error('xiaojing-finance-evidence: cache was not initialized')
    return parseDocument(text, this.filePath)
  }
}
