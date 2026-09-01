/** Versioned atomic storage for Finance consultation Workspace directories. */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'

const SCHEMA_VERSION = 1
const FILE_MODE = 0o600
const DIR_MODE = 0o700

const recordSchema = z.object({
  path: z.string().min(1).max(32_768).refine(isAbsolute, 'must be an absolute path'),
  title: z.string().min(1).max(200),
  createdAt: z.number().int().nonnegative(),
}).strict()

const documentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  workspaces: z.array(recordSchema),
}).strict()

/** One persisted custom consultation Workspace. */
export interface FinanceConsultationWorkspaceRecord {
  /** Canonical absolute directory path. */
  path: string
  /** Sidebar title captured when the directory was added. */
  title: string
  /** Creation time as Unix epoch milliseconds. */
  createdAt: number
}

interface FinanceConsultationWorkspaceDocument {
  schemaVersion: 1
  revision: number
  workspaces: FinanceConsultationWorkspaceRecord[]
}

async function readOptional(filename: string): Promise<string | undefined> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseDocument(text: string, filename: string): FinanceConsultationWorkspaceDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`xiaojing-finance-domain: cannot parse ${filename}; preserve the file and repair it`, { cause: error })
  }
  const parsed = documentSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`xiaojing-finance-domain: ${filename} is not a valid consultation workspace schema v1 document`)
  }
  const document = parsed.data
  const paths = new Set<string>()
  for (const workspace of document.workspaces) {
    if (paths.has(workspace.path)) {
      throw new Error(`xiaojing-finance-domain: duplicate consultation workspace path in ${filename}`)
    }
    paths.add(workspace.path)
  }
  return document
}

function render(document: FinanceConsultationWorkspaceDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

/** Atomic store rooted at `$DSH_HOME/finance/consultation-workspaces-v1.json`. */
export class FinanceConsultationWorkspaceStore {
  /** Versioned consultation Workspace catalog path. */
  readonly filePath: string

  /** @param dshHome - Fixed Harness data root. */
  constructor(dshHome: string) {
    this.filePath = join(dshHome, 'finance', 'consultation-workspaces-v1.json')
  }

  /** Validate existing data or initialize an empty catalog. */
  async init(): Promise<void> {
    const root = dirname(this.filePath)
    await mkdir(root, { recursive: true, mode: DIR_MODE })
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
      await writeFileAtomic(this.filePath, render({ schemaVersion: 1, revision: 0, workspaces: [] }), {
        mode: FILE_MODE,
        dirMode: DIR_MODE,
      })
    })
  }

  /**
   * Read all custom consultation Workspace records.
   * @returns Detached custom consultation Workspace records.
   */
  async list(): Promise<FinanceConsultationWorkspaceRecord[]> {
    return structuredClone((await this.readDocument()).workspaces)
  }

  /**
   * Add one canonical directory idempotently.
   * @param path - Canonical absolute directory path.
   * @param title - Sidebar title.
   * @returns Stored record.
   */
  async add(path: string, title: string): Promise<FinanceConsultationWorkspaceRecord> {
    return withFileLock(this.filePath, async () => {
      const current = await this.readDocument()
      const existing = current.workspaces.find(workspace => workspace.path === path)
      if (existing !== undefined) return structuredClone(existing)
      const workspace = { path, title, createdAt: Date.now() }
      const next: FinanceConsultationWorkspaceDocument = {
        schemaVersion: 1,
        revision: current.revision + 1,
        workspaces: [...current.workspaces, workspace],
      }
      documentSchema.parse(next)
      await writeFileAtomic(this.filePath, render(next), { mode: FILE_MODE, dirMode: DIR_MODE })
      return structuredClone(workspace)
    })
  }

  private async readDocument(): Promise<FinanceConsultationWorkspaceDocument> {
    return parseDocument(await readFile(this.filePath, 'utf8'), this.filePath)
  }
}
