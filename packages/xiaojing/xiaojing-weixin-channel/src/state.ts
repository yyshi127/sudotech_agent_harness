/** Private versioned state and cross-process ownership for the Weixin channel. */

import { open, readFile, rm, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import type { WeixinChannelStateFile } from './types.ts'

const pendingV1Schema = z.object({
  id: z.string().min(1),
  rpcId: z.uuid(),
  fromUserId: z.string().min(1),
  contextToken: z.string().min(1),
  text: z.string().min(1),
  receivedAt: z.number().int().nonnegative(),
  phase: z.enum(['received', 'submitted']),
})

const stateV1Schema = z.object({
  schemaVersion: z.literal(1),
  accountId: z.string().min(1).optional(),
  ownerUserId: z.string().min(1).optional(),
  baseUrl: z.url().optional(),
  sessionId: z.uuid().optional(),
  sessionReady: z.boolean(),
  updatesCursor: z.string(),
  pending: z.array(pendingV1Schema).max(100),
  completedMessageIds: z.array(z.string().min(1)).max(1000),
})

const attachmentSchema = z.object({
  kind: z.enum(['image', 'file']),
  name: z.string().min(1).max(180),
  path: z.string().min(1),
  mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
})

const pendingV2Schema = pendingV1Schema.extend({
  text: z.string(),
  attachments: z.array(attachmentSchema).max(10),
})

const stateSchema = stateV1Schema.omit({ schemaVersion: true, pending: true }).extend({
  schemaVersion: z.literal(2),
  pending: z.array(pendingV2Schema).max(100),
})

/**
 * Empty state used only when no file has ever been committed.
 * @returns a schema-v2 disconnected channel record.
 */
export function emptyWeixinState(): WeixinChannelStateFile {
  return { schemaVersion: 2, sessionReady: false, updatesCursor: '', pending: [], completedMessageIds: [] }
}

/** Atomic private state store; an unsupported or corrupt file fails without replacement. */
export class WeixinStateStore {
  /** @param filename - absolute state file under DSH_HOME. */
  constructor(readonly filename: string) {}

  /**
   * Read and validate the complete current state.
   * @returns validated state, or the empty record when the file is absent.
   */
  async load(): Promise<WeixinChannelStateFile> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filename, 'utf8'))
      const version = z.object({ schemaVersion: z.number().int() }).parse(value).schemaVersion
      if (version === 1) {
        const previous = stateV1Schema.parse(value)
        const migrated = stateSchema.parse({
          ...previous,
          schemaVersion: 2,
          pending: previous.pending.map(item => ({ ...item, attachments: [] })),
        }) as WeixinChannelStateFile
        await this.save(migrated)
        return migrated
      }
      return stateSchema.parse(value) as WeixinChannelStateFile
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyWeixinState()
      throw new Error(`微信频道状态文件无法读取：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Commit one complete validated state through the shared writer lock.
   * @param state - complete next state; partial records are rejected.
   */
  async save(state: WeixinChannelStateFile): Promise<void> {
    const validated = stateSchema.parse(state)
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    await withFileLock(this.filename, () => writeFileAtomic(
      this.filename,
      `${JSON.stringify(validated, null, 2)}\n`,
      { mode: 0o600, dirMode: 0o700 },
    ))
  }
}

interface LeaseRecord {
  pid: number
  startedAt: number
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Lifetime lock that prevents two local Harness processes from consuming one bot token. */
export class WeixinInstanceLease {
  private owned = false

  /** @param filename - exact lock path under the private plugin state directory. */
  constructor(private readonly filename: string) {}

  /**
   * Acquire ownership, recovering only a lock whose recorded process is no longer alive.
   * @returns whether this process owns the channel lease.
   */
  async acquire(): Promise<boolean> {
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.filename, 'wx', 0o600)
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`)
        await handle.close()
        this.owned = true
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      let record: LeaseRecord
      try {
        record = JSON.parse(await readFile(this.filename, 'utf8')) as LeaseRecord
      } catch {
        return false
      }
      if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || alive(record.pid)) return false
      await rm(this.filename, { force: true })
    }
    return false
  }

  /** Release only ownership acquired by this process. */
  async release(): Promise<void> {
    if (!this.owned) return
    this.owned = false
    let record: LeaseRecord | undefined
    try {
      record = JSON.parse(await readFile(this.filename, 'utf8')) as LeaseRecord
    } catch {
      return
    }
    if (record.pid === process.pid) await rm(this.filename, { force: true })
  }
}
