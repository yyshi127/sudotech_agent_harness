/** Durable Finance workspace titles and sidebar-list membership. */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'

const SCHEMA_VERSION = 1
const FILE_MODE = 0o600
const DIR_MODE = 0o700

const recordSchema = z.object({
  key: z.string().min(1).max(32_768),
  title: z.string().min(1).max(200).optional(),
  listed: z.boolean(),
}).strict()

const documentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  workspaces: z.array(recordSchema),
}).strict()

/** One persisted presentation override for a Finance-owned Workspace. */
export interface FinanceWorkspacePresentationRecord {
  /** Stable Finance-domain key, independent of the Workspace registry row. */
  key: string
  /** User-assigned sidebar title; omission follows the domain default. */
  title?: string
  /** Whether the Workspace appears in the Finance sidebar and picker. */
  listed: boolean
}

interface FinanceWorkspacePresentationDocument {
  schemaVersion: 1
  revision: number
  workspaces: FinanceWorkspacePresentationRecord[]
}

async function readOptional(filename: string): Promise<string | undefined> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseDocument(text: string, filename: string): FinanceWorkspacePresentationDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`xiaojing-finance-domain: cannot parse ${filename}; preserve the file and repair it`, { cause: error })
  }
  const parsed = documentSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`xiaojing-finance-domain: ${filename} is not a valid Finance workspace presentation schema v1 document`)
  }
  const document = parsed.data as FinanceWorkspacePresentationDocument
  const keys = new Set<string>()
  for (const workspace of document.workspaces) {
    if (keys.has(workspace.key)) {
      throw new Error(`xiaojing-finance-domain: duplicate Finance workspace key in ${filename}`)
    }
    keys.add(workspace.key)
  }
  return document
}

function render(document: FinanceWorkspacePresentationDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function sameRecord(
  left: FinanceWorkspacePresentationRecord | undefined,
  right: FinanceWorkspacePresentationRecord,
): boolean {
  return left?.key === right.key && left.title === right.title && left.listed === right.listed
}

/** Atomic store rooted at `$DSH_HOME/finance/workspace-presentation-v1.json`. */
export class FinanceWorkspacePresentationStore {
  /** Versioned presentation catalog path. */
  readonly filePath: string

  /** @param dshHome - Fixed Harness data root. */
  constructor(dshHome: string) {
    this.filePath = join(dshHome, 'finance', 'workspace-presentation-v1.json')
  }

  /** Validate existing data or initialize an empty override catalog. */
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
   * Read all Finance Workspace presentation records.
   * @returns Detached presentation records.
   */
  async list(): Promise<FinanceWorkspacePresentationRecord[]> {
    return structuredClone((await this.readDocument()).workspaces)
  }

  /**
   * Persist a user-assigned sidebar title without changing client identity.
   * @param key - Stable Finance workspace key.
   * @param title - Validated display title.
   * @returns Updated detached presentation record.
   */
  rename(key: string, title: string): Promise<FinanceWorkspacePresentationRecord> {
    return this.update(key, current => ({ key, title, listed: current?.listed ?? true }))
  }

  /**
   * Hide a Workspace from Finance lists while retaining its registry row and sessions.
   * @param key - Stable Finance workspace key.
   * @param requiredListedKeys - Collection that must retain another listed member.
   * @returns Updated detached presentation record.
   */
  remove(
    key: string,
    requiredListedKeys: readonly string[] = [],
  ): Promise<FinanceWorkspacePresentationRecord> {
    return this.update(key, (current, document) => {
      if (requiredListedKeys.length > 0) {
        const stored = new Map(document.workspaces.map(workspace => [workspace.key, workspace]))
        const otherListed = requiredListedKeys.some(candidate =>
          candidate !== key && (stored.get(candidate)?.listed ?? true))
        if (!otherListed) {
          throw new Error('xiaojing-finance-domain: at least one consultation workspace must remain')
        }
      }
      return {
        key,
        ...current?.title === undefined ? {} : { title: current.title },
        listed: false,
      }
    })
  }

  /**
   * Restore a previously removed Workspace to Finance lists.
   * @param key - Stable Finance workspace key.
   * @returns Updated detached presentation record.
   */
  restore(key: string): Promise<FinanceWorkspacePresentationRecord> {
    return this.update(key, current => ({
      key,
      ...current?.title === undefined ? {} : { title: current.title },
      listed: true,
    }))
  }

  private async update(
    key: string,
    change: (
      current: FinanceWorkspacePresentationRecord | undefined,
      document: FinanceWorkspacePresentationDocument,
    ) => FinanceWorkspacePresentationRecord,
  ): Promise<FinanceWorkspacePresentationRecord> {
    return withFileLock(this.filePath, async () => {
      const current = await this.readDocument()
      const index = current.workspaces.findIndex(workspace => workspace.key === key)
      const previous = index === -1 ? undefined : current.workspaces[index]
      const workspace = change(previous, current)
      recordSchema.parse(workspace)
      if (sameRecord(previous, workspace)) return structuredClone(workspace)
      const workspaces = [...current.workspaces]
      if (index === -1) workspaces.push(workspace)
      else workspaces[index] = workspace
      const next: FinanceWorkspacePresentationDocument = {
        schemaVersion: 1,
        revision: current.revision + 1,
        workspaces,
      }
      documentSchema.parse(next)
      await writeFileAtomic(this.filePath, render(next), { mode: FILE_MODE, dirMode: DIR_MODE })
      return structuredClone(workspace)
    })
  }

  private async readDocument(): Promise<FinanceWorkspacePresentationDocument> {
    return parseDocument(await readFile(this.filePath, 'utf8'), this.filePath)
  }
}
