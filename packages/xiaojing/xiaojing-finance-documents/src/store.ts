/** Private versioned content-hash cache for normalized Xiaojing documents. */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseNormalizedDocument } from './schema.ts'
import type { FinanceDocumentKind, FinanceNormalizedDocument } from './types.ts'

const FILE_MODE = 0o600
const DIR_MODE = 0o700
const SHA256 = /^[a-f0-9]{64}$/u
const KIND = /^(?:pdf|docx|xlsx|pptx|xml|ofd|csv|txt|image|unsupported)$/u

function render(document: FinanceNormalizedDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

async function readOptional(filename: string): Promise<string | undefined> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseRecord(text: string, filename: string): FinanceNormalizedDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`xiaojing-finance-documents: cannot parse ${filename}; preserve the file and repair or migrate it`, { cause: error })
  }
  try {
    return parseNormalizedDocument(value)
  } catch (error) {
    throw new Error(`xiaojing-finance-documents: ${filename} is not a valid schema v3, normalizer v4 record; preserve it and repair or migrate it`, { cause: error })
  }
}

function cacheFilename(sha256: string, kind: FinanceDocumentKind): string {
  if (!SHA256.test(sha256)) throw new Error('xiaojing-finance-documents: cache digest must be lowercase SHA-256')
  if (!KIND.test(kind)) throw new Error('xiaojing-finance-documents: unsupported cache kind')
  return `${sha256}.${kind}.n4.json`
}

function scopeDirectory(scope: string): string {
  if (scope.length === 0) throw new Error('xiaojing-finance-documents: cache scope cannot be empty')
  return createHash('sha256').update(scope).digest('hex')
}

/** Atomic cache whose key contains no client or filename data. */
export class FinanceDocumentStore {
  /** Versioned private cache directory. */
  readonly directory: string

  /** @param dshHome - Fixed Harness data root. */
  constructor(dshHome: string) {
    this.directory = join(dshHome, 'finance', 'documents', 'v3', 'normalizer-v4')
  }

  /** Create the cache directory and reject any corrupt existing record. */
  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: DIR_MODE })
    const scopeEntries = await readdir(this.directory, { withFileTypes: true })
    for (const scopeEntry of scopeEntries) {
      if (!scopeEntry.isDirectory() || !SHA256.test(scopeEntry.name)) continue
      const scopePath = join(this.directory, scopeEntry.name)
      const entries = await readdir(scopePath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const filename = join(scopePath, entry.name)
        const record = parseRecord(await readFile(filename, 'utf8'), filename)
        const expected = cacheFilename(record.sha256, record.kind)
        if (entry.name !== expected) {
          throw new Error(`xiaojing-finance-documents: cache record ${filename} does not match its content key; preserve it and repair or migrate it`)
        }
      }
    }
  }

  /**
   * Read one exact hash-and-format cache record.
   * @param scope - Bound client identity or consultation-session identity; hashed before entering the path.
   * @param sha256 - Verified source digest.
   * @param kind - Filename-selected format.
   * @returns Normalized document or undefined.
   */
  async get(scope: string, sha256: string, kind: FinanceDocumentKind): Promise<FinanceNormalizedDocument | undefined> {
    const filename = join(this.directory, scopeDirectory(scope), cacheFilename(sha256, kind))
    const text = await readOptional(filename)
    return text === undefined ? undefined : parseRecord(text, filename)
  }

  /**
   * Commit one normalized document if another process has not already done so.
   * @param scope - Bound client identity or consultation-session identity; hashed before entering the path.
   * @param document - Validated normalized record.
   * @returns Authoritative stored record.
   */
  async put(scope: string, document: FinanceNormalizedDocument): Promise<FinanceNormalizedDocument> {
    const filename = join(this.directory, scopeDirectory(scope), cacheFilename(document.sha256, document.kind))
    await mkdir(join(this.directory, scopeDirectory(scope)), { recursive: true, mode: DIR_MODE })
    return await withFileLock(filename, async () => {
      const existing = await readOptional(filename)
      if (existing !== undefined) return parseRecord(existing, filename)
      await writeFileAtomic(filename, render(document), { mode: FILE_MODE, dirMode: DIR_MODE })
      return document
    })
  }
}
