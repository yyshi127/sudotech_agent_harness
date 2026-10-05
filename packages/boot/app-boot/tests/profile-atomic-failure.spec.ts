/** Atomic shipped-profile migration cleanup when the filesystem rejects replacement. */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const renameFailure = new Error('rename denied')

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: vi.fn(() => { throw renameFailure }),
  }
})

import { loadProfile, resolveProfileDir, writeProfileManifest } from '../src/profile.ts'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true })
})

describe('shipped profile migration', () => {
  it('removes the staging manifest and preserves the original when atomic replacement fails', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-atomic-'))
    roots.push(home)
    const dir = resolveProfileDir('web', home)
    mkdirSync(dir, { recursive: true })
    const original = {
      name: 'web',
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-file-uploads'] } },
    }
    writeProfileManifest(dir, original)

    expect(() => loadProfile('dsh', 'web', join(home, 'unused-anchor.json'), home)).toThrow(renameFailure)
    expect(readdirSync(dir)).toEqual(['package.json'])
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).toEqual(original)
  })
})
