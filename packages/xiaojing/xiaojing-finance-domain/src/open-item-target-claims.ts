/** Shared Host-private send claims for mutually exclusive open-item mutations. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const identifier = z.string().regex(/^[1-9]\d*$/)
const direction = z.enum(['receivable', 'payable'])
const claimSchema = z.strictObject({ schemaVersion: z.literal(1), id: z.uuid(), ownerDigest: digest,
  operation: z.enum(['deletion', 'write-off']), ledgerId: identifier, openItemId: identifier, direction })

/** One ledger/open-item target shared by deletion and full settlement. */
export interface OpenItemClaimTarget {
  ledgerId: string
  openItemId: string
}

/** Durable active send claim; released outcomes remove it only after their operation record is saved. */
export type OpenItemTargetClaim = z.infer<typeof claimSchema>

/** Owns the common target path and lock used by every open-item mutation type. */
export class OpenItemTargetClaims {
  private readonly ownerDigest: string
  private readonly directory: string

  /**
   * @param root - Host-private root shared by deletion and write-off records.
   * @param owner - Host-derived client/environment/ledger identity.
   * @param maxBytes - Maximum complete claim size.
   */
  constructor(root: string, owner: string, private readonly maxBytes: number) {
    this.ownerDigest = hash(owner)
    this.directory = join(root, this.ownerDigest)
  }

  private path(target: OpenItemClaimTarget): string {
    const ledgerId = identifier.parse(target.ledgerId)
    const openItemId = identifier.parse(target.openItemId)
    return join(this.directory, `target-${hash(JSON.stringify([ledgerId, openItemId]))}.json`)
  }

  private encode(value: unknown): string {
    const content = JSON.stringify(value) + '\n'
    if (Buffer.byteLength(content) > this.maxBytes) throw new Error('应收应付目标占用记录超过大小限制。')
    return content
  }

  /**
   * Serialize every claim decision for one ledger/open-item pair across processes.
   * @param target - Exact ledger and vendor open-item identity.
   * @param task - Work performed while the common target lock is held.
   * @returns The task result.
   */
  async withLock<T>(target: OpenItemClaimTarget, task: () => Promise<T>): Promise<T> {
    const path = this.path(target)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    return withFileLock(path, task)
  }

  /**
   * Read an active claim while treating every malformed or mismatched file as occupied.
   * @param target - Expected ledger and open-item identity encoded in the file name.
   * @returns The validated claim, or undefined only when no claim file exists.
   */
  async read(target: OpenItemClaimTarget): Promise<OpenItemTargetClaim | undefined> {
    const path = this.path(target)
    let bytes: Buffer
    try { bytes = await readFile(path) }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
    if (bytes.length > this.maxBytes) throw new Error('应收应付目标占用记录超过大小限制。')
    const claim = claimSchema.parse(JSON.parse(bytes.toString('utf8')))
    if (claim.ownerDigest !== this.ownerDigest || claim.ledgerId !== target.ledgerId
      || claim.openItemId !== target.openItemId) throw new Error('应收应付目标占用记录不一致，不能发送。')
    return claim
  }

  /**
   * Persist an active claim before its operation records outcome-unknown; the caller must hold {@link withLock}.
   * @param target - Exact ledger and open-item identity.
   * @param claim - Operation identity authorized for one send.
   */
  async create(target: OpenItemClaimTarget,
    claim: Pick<OpenItemTargetClaim, 'id' | 'operation' | 'direction'>): Promise<void> {
    if (await this.read(target) !== undefined) throw new Error('该往来已有发送意图，请只读核查原记录。')
    const value = claimSchema.parse({ schemaVersion: 1, ...claim, ownerDigest: this.ownerDigest, ...target })
    await writeFileAtomic(this.path(target), this.encode(value), { mode: 0o600, dirMode: 0o700 })
  }

  /**
   * Remove only the exact active claim after a rejected or not-sent operation record is durable; the caller must hold {@link withLock}.
   * @param target - Exact ledger and open-item identity.
   * @param expected - Operation identity that owns the active claim.
   */
  async release(target: OpenItemClaimTarget,
    expected: Pick<OpenItemTargetClaim, 'id' | 'operation' | 'direction'>): Promise<void> {
    const current = await this.read(target)
    if (current === undefined || current.id !== expected.id || current.operation !== expected.operation
      || current.direction !== expected.direction) throw new Error('应收应付目标占用记录不一致，不能释放。')
    await unlink(this.path(target))
  }
}
