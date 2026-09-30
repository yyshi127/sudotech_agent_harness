import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertXiaojingDesktopClientBuild } from '../src/xiaojing-product.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(record?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'xiaojing-desktop-build-'))
  roots.push(root)
  if (record !== undefined) {
    const path = join(root, '.dsh-build', 'client-build-environment.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(record)}\n`)
  }
  return root
}

describe('desktop Client build profile', () => {
  it('accepts only Xiaojing artifacts for an unpackaged preview', () => {
    const root = fixture({ environment: { DSH_CLIENT_BUILD_PROFILE: 'xiaojing' } })
    expect(() => { assertXiaojingDesktopClientBuild(root, false) }).not.toThrow()
  })

  it('rejects missing and non-Xiaojing build records before opening a preview', () => {
    expect(() => { assertXiaojingDesktopClientBuild(fixture(), false) }).toThrow(/build:xiaojing/u)
    expect(() => {
      assertXiaojingDesktopClientBuild(
        fixture({ environment: { DSH_CLIENT_BUILD_PROFILE: 'official' } }),
        false,
      )
    }).toThrow(/build:xiaojing/u)
  })

  it('does not require the repository-only record in a packaged application', () => {
    expect(() => { assertXiaojingDesktopClientBuild(fixture(), true) }).not.toThrow()
  })
})
