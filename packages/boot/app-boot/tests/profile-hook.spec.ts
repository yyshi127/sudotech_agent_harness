/** Profile module-fallback branch coverage through the registered Node hook. */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'

interface ResolveContext {
  parentURL?: string
}

type NextResolve = (specifier: string, context: ResolveContext) => { url: string }

const hookState = vi.hoisted(() => ({
  deregister: vi.fn(),
  resolve: undefined as ((specifier: string, context: ResolveContext, nextResolve: NextResolve) => { url: string }) | undefined,
}))

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>()
  return {
    createRequire: actual.createRequire,
    registerHooks: vi.fn((hooks: { resolve: typeof hookState.resolve }) => {
      hookState.resolve = hooks.resolve
      return { deregister: hookState.deregister }
    }),
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    realpathSync: vi.fn((path: Parameters<typeof actual.realpathSync>[0]) => {
      if (String(path).includes('denied-package')) {
        const error = new Error('realpath denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      }
      return actual.realpathSync(path)
    }),
  }
})

import { registerProfileModuleFallback } from '../src/profile.ts'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true })
})

function stageInstallation(packageNames: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-profile-hook-'))
  roots.push(root)
  const appDir = join(root, 'app')
  const dependencies = Object.fromEntries(packageNames.map(name => [name, '0.0.0']))
  for (const name of packageNames) {
    const packageDir = join(appDir, 'node_modules', name)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name, version: '0.0.0' }))
  }
  mkdirSync(appDir, { recursive: true })
  const anchor = join(appDir, 'package.json')
  writeFileSync(anchor, JSON.stringify({ name: 'dsh-app', dependencies }))
  return anchor
}

function resolveHook(): NonNullable<typeof hookState.resolve> {
  if (hookState.resolve === undefined) throw new Error('profile resolve hook was not registered')
  return hookState.resolve
}

describe('profile module fallback resolver', () => {
  it('delegates non-profile and non-bare imports unchanged', () => {
    const anchor = stageInstallation(['plain-package'])
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-hook-home-'))
    roots.push(home)
    const dispose = registerProfileModuleFallback(anchor, home)
    const resolve = resolveHook()
    const nextResolve = vi.fn((specifier: string) => ({ url: `node:${specifier}` }))

    for (const [specifier, parentURL] of [
      ['plain-package', undefined],
      ['plain-package', 'node:test'],
      ['./local.js', pathToFileURL(join(home, 'profiles', 'web', 'entry.js')).href],
      ['#internal', pathToFileURL(join(home, 'profiles', 'web', 'entry.js')).href],
      ['node:test', pathToFileURL(join(home, 'profiles', 'web', 'entry.js')).href],
    ] as const) {
      const context: ResolveContext = parentURL === undefined ? {} : { parentURL }
      expect(resolve(specifier, context, nextResolve)).toEqual({ url: `node:${specifier}` })
    }

    dispose()
    dispose()
    expect(hookState.deregister).toHaveBeenCalledTimes(1)
  })

  it('keeps ordinary profile resolutions and falls back for missing app packages', () => {
    const anchor = stageInstallation(['plain-package', '@scope/scoped-package'])
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-hook-home-'))
    roots.push(home)
    registerProfileModuleFallback(anchor, home)
    const resolve = resolveHook()
    const parentURL = pathToFileURL(join(home, 'profiles', 'web', 'entry.js')).href

    const ordinary = vi.fn(() => ({ url: pathToFileURL(join(home, 'profiles', 'web', 'node_modules', 'other', 'index.js')).href }))
    expect(resolve('other/subpath', { parentURL }, ordinary)).toEqual(ordinary.mock.results[0]?.value)

    const missing = vi.fn((_specifier: string, context: ResolveContext) => {
      if (context.parentURL === parentURL) {
        const error = new Error('missing') as NodeJS.ErrnoException
        error.code = 'ERR_MODULE_NOT_FOUND'
        throw error
      }
      return { url: context.parentURL ?? '' }
    })
    expect(resolve('plain-package/subpath', { parentURL }, missing).url)
      .toContain('/node_modules/.dsh-profile-module-fallback.mjs')
    expect(resolve('@scope/scoped-package/subpath', { parentURL }, missing).url)
      .toContain('/node_modules/.dsh-profile-module-fallback.mjs')

    const unknownMissing = vi.fn(() => {
      const error = new Error('missing') as NodeJS.ErrnoException
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    })
    expect(() => resolve('unknown-package', { parentURL }, unknownMissing)).toThrow('missing')

    const otherFailure = vi.fn(() => {
      const error = new Error('denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      throw error
    })
    expect(() => resolve('plain-package', { parentURL }, otherFailure)).toThrow('denied')
  })

  it('rejects a dereferenced legacy package and tolerates an absent legacy path', () => {
    const packageName = '@scope/scoped-package'
    const anchor = stageInstallation([packageName])
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-hook-home-'))
    roots.push(home)
    const profilesDir = join(home, 'profiles')
    const legacyPackageDir = join(profilesDir, 'node_modules', packageName)
    const obsoleteDir = join(home, 'obsolete')
    mkdirSync(obsoleteDir, { recursive: true })
    mkdirSync(dirname(legacyPackageDir), { recursive: true })
    symlinkSync(obsoleteDir, legacyPackageDir, process.platform === 'win32' ? 'junction' : 'dir')

    registerProfileModuleFallback(anchor, home)
    const resolve = resolveHook()
    const parentURL = pathToFileURL(join(profilesDir, 'web', 'entry.js')).href
    const dereferenced = pathToFileURL(join(obsoleteDir, 'index.js')).href
    const calls: ResolveContext[] = []
    const nextResolve = vi.fn((_specifier: string, context: ResolveContext) => {
      calls.push(context)
      return calls.length === 1 ? { url: dereferenced } : { url: context.parentURL ?? '' }
    })
    expect(resolve(`${packageName}/subpath`, { parentURL }, nextResolve).url)
      .toContain('/node_modules/.dsh-profile-module-fallback.mjs')

    rmSync(legacyPackageDir, { force: true, recursive: true })
    const current = pathToFileURL(join(dirname(anchor), 'node_modules', packageName, 'index.js')).href
    expect(resolve(packageName, { parentURL }, () => ({ url: current }))).toEqual({ url: current })
  })

  it('handles direct legacy, non-file, and unexpected realpath resolutions', () => {
    const anchor = stageInstallation(['plain-package', 'denied-package'])
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-hook-home-'))
    roots.push(home)
    registerProfileModuleFallback(anchor, home)
    const resolve = resolveHook()
    const parentURL = pathToFileURL(join(home, 'profiles', 'web', 'entry.js')).href
    const legacyUrl = pathToFileURL(join(home, 'profiles', 'node_modules', 'plain-package', 'index.js')).href
    const fallback = vi.fn((_specifier: string, context: ResolveContext) => ({ url: context.parentURL ?? '' }))

    expect(resolve('plain-package', { parentURL }, vi.fn()
      .mockReturnValueOnce({ url: legacyUrl })
      .mockImplementation(fallback)).url)
      .toContain('/node_modules/.dsh-profile-module-fallback.mjs')
    expect(resolve('plain-package', { parentURL }, () => ({ url: 'node:plain-package' })))
      .toEqual({ url: 'node:plain-package' })
    expect(() => resolve('denied-package', { parentURL }, () => ({
      url: pathToFileURL(join(home, 'elsewhere', 'denied-package.js')).href,
    }))).toThrow('realpath denied')
  })
})
