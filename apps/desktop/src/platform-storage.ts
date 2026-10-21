/** Short persistent Chromium paths with atomic migration of the account's legacy partition. */
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountUserId } from '@deepseek-ai/dsh-deepseek-account'

function directoryExists(path: string): boolean {
  try {
    if (!lstatSync(path).isDirectory()) throw new Error('Platform storage path is not a directory')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Resolve an account-private Chromium directory before opening its Session.
 * An existing legacy partition moves atomically; conflicting directories are preserved and rejected.
 * @param root - Electron's absolute sessionData directory.
 * @param origin - Authenticated Platform issuer.
 * @param userId - Stable account identity; access tokens do not affect the path.
 * @returns Short directory retaining the complete SHA-256 account/issuer identity.
 */
export function platformStorageDirectory(root: string, origin: string, userId: AccountUserId): string {
  const digest = createHash('sha256').update(JSON.stringify([origin, userId])).digest()
  const previous = join(root, 'Partitions', `dsh-platform-${digest.toString('hex')}`)
  const parent = join(root, 'p')
  const current = join(parent, digest.toString('base64url'))
  const legacy = directoryExists(previous)
  const existing = directoryExists(current)
  if (legacy && existing) throw new Error('Conflicting Platform storage directories; preserve both before repairing account storage')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  if (legacy) renameSync(previous, current)
  return current
}
