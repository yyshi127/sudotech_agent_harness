/** Installed-product isolation uses resolved package identities and runtime edges. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyInstalledProductIsolation } from './installed-product-isolation.ts'

const roots: string[] = []
const experimental = '@deepseek-ai/dsh-experimental-example'
const browser = '@deepseek-ai/dsh-xiaojing-browser-control'
const nativeRuntime = '@deepseek-ai/dsh-experimental-browser-use-runtime'
const nativeProviders = ['browser-use-chrome-devtools-mcp', 'browser-use-playwright-mcp']
  .map(name => `@deepseek-ai/dsh-experimental-${name}`)

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-installed-isolation-'))
  roots.push(root)
  return root
}

function writePackage(root: string, key: string, manifest: Record<string, unknown>): string {
  const directory = join(root, 'node_modules', key)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ name: key, ...manifest })}\n`)
  return directory
}

function nativePackage(root: string, name: string, fields: Record<string, unknown> = {}): string {
  const directory = name === browser ? 'packages/xiaojing/xiaojing-browser-control'
    : `packages/experimental/${name.replace('@deepseek-ai/dsh-experimental-', '')}`
  return writePackage(root, name, { repository: { directory }, ...fields })
}

function nativeFixture(): { root: string; entry: string } {
  const root = fixture()
  const entry = writePackage(root, '@deepseek-ai/dsh', { dependencies: { [browser]: '1.0.0' } })
  nativePackage(root, browser, { dependencies: Object.fromEntries([...nativeProviders, nativeRuntime].map(name => [name, '1.0.0'])) })
  for (const name of nativeProviders) nativePackage(root, name, { dependencies: { [nativeRuntime]: '1.0.0' } })
  nativePackage(root, nativeRuntime)
  return { root, entry }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('installed default-product isolation', () => {
  it('inspects the exact native adoption graph using resolved names and repository directories', () => {
    const { entry } = nativeFixture()
    expect(verifyInstalledProductIsolation(entry)).toBe(5)
  })

  it.each(['optionalDependencies', 'peerDependencies'])(
    'rejects native adoption through %s', (section) => {
      const { root, entry } = nativeFixture()
      nativePackage(root, browser, { [section]: { [nativeRuntime]: '1.0.0' } })
      expect(() => verifyInstalledProductIsolation(entry)).toThrow(nativeRuntime)
    },
  )

  it.each(['npm:', 'file:', 'link:'])(
    'rejects an alias range starting with %s', (prefix) => {
      const { root, entry } = nativeFixture()
      nativePackage(root, browser, { dependencies: { [nativeRuntime]: `${prefix}${nativeRuntime}@1.0.0` } })
      expect(() => verifyInstalledProductIsolation(entry)).toThrow(nativeRuntime)
    },
  )

  it.each([browser, ...nativeProviders, nativeRuntime])('rejects a forged repository directory for %s', (name) => {
    const { root, entry } = nativeFixture()
    nativePackage(root, name, { repository: { directory: 'packages/core/copied' },
      ...name === browser ? { dependencies: { [nativeRuntime]: '1.0.0' } } : {} })
    expect(() => verifyInstalledProductIsolation(entry)).toThrow('experimental')
  })

  it('rejects a resolved target name hidden behind the adopted dependency key', () => {
    const { root, entry } = nativeFixture()
    nativePackage(root, nativeRuntime, { name: experimental })
    expect(() => verifyInstalledProductIsolation(entry)).toThrow('experimental')
  })

  it('rejects consumer identity forgery and a different consumer after the provider has already been visited', () => {
    const { root, entry } = nativeFixture()
    nativePackage(root, nativeRuntime, { dependencies: { other: '1.0.0' } })
    writePackage(root, 'other', { dependencies: { [nativeRuntime]: '1.0.0' } })
    expect(() => verifyInstalledProductIsolation(entry)).toThrow(`other -> ${nativeRuntime}`)
    nativePackage(root, browser, { name: 'other', dependencies: { [nativeRuntime]: '1.0.0' } })
    expect(() => verifyInstalledProductIsolation(entry)).toThrow(nativeRuntime)
  })

  it.each([...nativeProviders, nativeRuntime])('rejects experimental dependency expansion from %s', (name) => {
    const { root, entry } = nativeFixture()
    nativePackage(root, name, { dependencies: { [experimental]: '1.0.0' } })
    writePackage(root, experimental, {})
    expect(() => verifyInstalledProductIsolation(entry)).toThrow(experimental)
  })

  it('requires an authorized incoming edge even when the entry itself has an adopted package identity', () => {
    const { root } = nativeFixture()
    expect(() => verifyInstalledProductIsolation(join(root, 'node_modules', nativeRuntime))).toThrow(nativeRuntime)
  })

  it('ignores development dependencies and unrelated installed experimental packages', () => {
    const root = fixture()
    const entry = writePackage(root, '@deepseek-ai/dsh', {
      dependencies: { core: '1.0.0' },
      devDependencies: { [experimental]: '1.0.0' },
    })
    writePackage(root, 'core', { peerDependencies: { '@deepseek-ai/dsh': '1.0.0' } })
    writePackage(root, experimental, {})

    expect(verifyInstalledProductIsolation(entry)).toBe(2)
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'])(
    'rejects a transitive experimental %s',
    (section) => {
      const root = fixture()
      const entry = writePackage(root, '@deepseek-ai/dsh', { dependencies: { thirdParty: '1.0.0' } })
      writePackage(root, 'thirdParty', { [section]: { [experimental]: '1.0.0' } })

      expect(() => verifyInstalledProductIsolation(entry)).toThrow(
        `@deepseek-ai/dsh -> thirdParty -> ${experimental}`,
      )
    },
  )

  it('skips the entry package\'s optional bundles, which must be installed, and still rejects other experimental edges', () => {
    const root = fixture()
    const entry = writePackage(root, '@deepseek-ai/dsh', { dependencies: { core: '1.0.0', [experimental]: '1.0.0' } })
    writePackage(root, 'core', {})
    writePackage(root, experimental, { dependencies: { '@deepseek-ai/dsh-experimental-inner': '1.0.0' } })
    expect(verifyInstalledProductIsolation(entry, [experimental])).toBe(2)

    writePackage(root, 'core', { dependencies: { [experimental]: '1.0.0' } })
    expect(() => verifyInstalledProductIsolation(entry, [experimental])).toThrow(`core -> ${experimental}`)

    const missing = writePackage(root, '@deepseek-ai/dsh-missing', { dependencies: { absent: '1.0.0' } })
    expect(() => verifyInstalledProductIsolation(missing, ['absent'])).toThrow('optional bundle is missing: @deepseek-ai/dsh-missing -> absent')
  })

  it('rejects experimental identities hidden behind an installed alias', () => {
    const root = fixture()
    const entry = writePackage(root, '@deepseek-ai/dsh', { dependencies: { safeName: 'file:../prototype' } })
    writePackage(root, 'safeName', { name: experimental })

    expect(() => verifyInstalledProductIsolation(entry)).toThrow(experimental)
  })

  it('rejects experimental npm aliases even when an optional package is omitted', () => {
    const root = fixture()
    const entry = writePackage(root, '@deepseek-ai/dsh', {
      optionalDependencies: { safeName: `npm:${experimental}@1.0.0` },
    })

    expect(() => verifyInstalledProductIsolation(entry)).toThrow(experimental)
  })

  it('follows nested installations rather than an unrelated hoisted package', () => {
    const root = fixture()
    const entry = writePackage(root, '@deepseek-ai/dsh', { dependencies: { core: '1.0.0' } })
    writePackage(root, 'core', {})
    writePackage(entry, 'core', { dependencies: { [experimental]: '1.0.0' } })

    expect(() => verifyInstalledProductIsolation(entry)).toThrow(experimental)
  })

  it('permits missing optional packages and optional peers but rejects missing dependencies', () => {
    const root = fixture()
    const entry = writePackage(root, '@deepseek-ai/dsh', {
      dependencies: { optional: '1.0.0' },
      optionalDependencies: { optional: '1.0.0' },
      peerDependencies: { peer: '1.0.0' },
      peerDependenciesMeta: { peer: { optional: true } },
    })
    expect(verifyInstalledProductIsolation(entry)).toBe(1)
    writePackage(root, '@deepseek-ai/dsh', { dependencies: { missing: '1.0.0' } })
    expect(() => verifyInstalledProductIsolation(entry)).toThrow('dependency is missing')
  })
})
