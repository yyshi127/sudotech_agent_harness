/** Legacy account storage moves without overwriting either source or an existing destination. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AccountUserId } from '@deepseek-ai/dsh-deepseek-account/types'
import { platformStorageDirectory } from '../src/platform-storage.ts'

const origin = 'https://platform.deepseek.com'
const account = 'fixture-user' as AccountUserId
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'platform-storage-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function legacyDirectory(): string {
  const digest = createHash('sha256').update(JSON.stringify([origin, account])).digest('hex')
  return join(root, 'Partitions', `dsh-platform-${digest}`)
}

it('uses a shorter complete account digest and isolates different issuers and accounts', () => {
  const directory = platformStorageDirectory(root, origin, account)
  expect(directory).toMatch(/[/\\]p[/\\][A-Za-z0-9_-]{43}$/)
  expect(directory.length).toBeLessThan(legacyDirectory().length)
  expect(platformStorageDirectory(root, origin, account)).toBe(directory)
  expect(platformStorageDirectory(root, origin, 'another-user' as AccountUserId)).not.toBe(directory)
  expect(platformStorageDirectory(root, 'https://another.example', account)).not.toBe(directory)
})

it('moves the entire old partition once while preserving preferences, cookies and unrelated storage', () => {
  const previous = legacyDirectory()
  const preference = join(previous, 'Local Storage', 'leveldb', '000003.log')
  mkdirSync(dirname(preference), { recursive: true })
  writeFileSync(preference, 'existing preference bytes')
  writeFileSync(join(previous, 'Cookies'), 'existing cookie bytes')
  writeFileSync(join(root, 'unrelated.txt'), 'leave unchanged')
  const directory = platformStorageDirectory(root, origin, account)
  expect(existsSync(previous)).toBe(false)
  expect(readFileSync(join(directory, 'Local Storage', 'leveldb', '000003.log'), 'utf8')).toBe('existing preference bytes')
  expect(readFileSync(join(directory, 'Cookies'), 'utf8')).toBe('existing cookie bytes')
  expect(readFileSync(join(root, 'unrelated.txt'), 'utf8')).toBe('leave unchanged')
  expect(platformStorageDirectory(root, origin, account)).toBe(directory)
})

it('preserves both trees when legacy and current account storage conflict', () => {
  const previous = legacyDirectory()
  const directory = platformStorageDirectory(root, origin, account)
  mkdirSync(previous, { recursive: true })
  mkdirSync(directory)
  writeFileSync(join(previous, 'preference'), 'old')
  writeFileSync(join(directory, 'preference'), 'current')
  expect(() => platformStorageDirectory(root, origin, account)).toThrow('Conflicting Platform storage directories')
  expect(readFileSync(join(previous, 'preference'), 'utf8')).toBe('old')
  expect(readFileSync(join(directory, 'preference'), 'utf8')).toBe('current')
})

it('retains legacy bytes when the destination parent cannot contain a directory', () => {
  const previous = legacyDirectory()
  mkdirSync(previous, { recursive: true })
  writeFileSync(join(previous, 'preference'), 'preserve')
  writeFileSync(join(root, 'p'), 'blocked parent')
  expect(() => platformStorageDirectory(root, origin, account)).toThrow()
  expect(readFileSync(join(previous, 'preference'), 'utf8')).toBe('preserve')
})

it('rejects a file occupying the legacy partition path without modifying it', () => {
  const previous = legacyDirectory()
  mkdirSync(dirname(previous), { recursive: true })
  writeFileSync(previous, 'preserve unexpected file')
  expect(() => platformStorageDirectory(root, origin, account)).toThrow('not a directory')
  expect(readFileSync(previous, 'utf8')).toBe('preserve unexpected file')
})
