/**
 * Profile machinery of `dsh-app-boot`: directory resolution and init,
 * manifest round-trips, two-anchor bundle resolution, patch-layer loading,
 * empty-root composition, and the installation module-fallback healing.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ModuleLoader } from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
import {
  assertNoProfileRuntimeShadows,
  composeEntries,
  findProfileRuntimeShadows,
  initProfile,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  readProfileManifest,
  registerProfileModuleFallback,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
} from '../src/index.ts'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-profile-'))

/** Stage a fake installed app: package.json with deps and a node_modules holding bundles. */
function stageInstallation(bundles: Record<string, { patch?: string; deps?: Record<string, string> }>): string {
  const root = tmp()
  const appDir = join(root, 'app')
  mkdirSync(join(appDir, 'node_modules'), { recursive: true })
  const appDeps: Record<string, string> = {}
  for (const [name, spec] of Object.entries(bundles)) {
    appDeps[name] = '0.0.0'
    const dir = join(appDir, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name,
      version: '0.0.0',
      dependencies: spec.deps ?? {},
      ...spec.patch === undefined ? {} : { dsh: { bundle: { patch: './cordis.patch.yml' } } },
    }))
    if (spec.patch !== undefined) writeFileSync(join(dir, 'cordis.patch.yml'), spec.patch)
  }
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'dsh-app', dependencies: appDeps }))
  return join(appDir, 'package.json')
}

describe('resolveProfileDir', () => {
  it('joins the home and rejects traversal-shaped names', () => {
    const home = tmp()
    expect(resolveProfileDir('tui', home)).toBe(join(home, 'profiles', 'tui'))
    for (const bad of ['', '.', '..', 'a/b', 'a\\b']) {
      expect(() => resolveProfileDir(bad, home)).toThrow('invalid profile name')
    }
  })
})

describe('initProfile', () => {
  it('creates manifest, user patch layer, and pnpm workspace once, never overwriting', () => {
    const home = tmp()
    const dir = resolveProfileDir('tui', home)
    initProfile(dir, ['@deepseek-ai/dsh-base'])
    const manifest = readProfileManifest('t', dir)
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
    expect(readFileSync(join(dir, PROFILE_PATCH_FILENAME), 'utf8')).toContain('[]')
    expect(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')).toContain('nodeLinker: hoisted')
    // Re-init keeps user edits.
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), '- id: x\n  config: {}\n')
    initProfile(dir, ['other'])
    expect(readProfileManifest('t', dir).dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
    expect(readFileSync(join(dir, PROFILE_PATCH_FILENAME), 'utf8')).toContain('- id: x')
  })
})

describe('manifest round-trip', () => {
  it('writes and reads back, and fails loud on a broken manifest', () => {
    const dir = tmp()
    writeProfileManifest(dir, { name: 'p', dsh: { profile: { bundles: ['a'] } } })
    expect(readProfileManifest('t', dir).dsh?.profile?.bundles).toEqual(['a'])
    writeFileSync(join(dir, 'package.json'), '[]')
    expect(() => readProfileManifest('t', dir)).toThrow('must hold a JSON object')
    expect(() => readProfileManifest('t', join(dir, 'nope'))).toThrow('failed to read profile manifest')
  })
})

describe('resolveBundleDir', () => {
  it('prefers the installation anchor, falls back to the profile, and fails loud', () => {
    const anchor = stageInstallation({ 'in-box': { patch: '[]\n' } })
    const profileDir = tmp()
    mkdirSync(join(profileDir, 'node_modules', 'local-only'), { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), '{}')
    writeFileSync(join(profileDir, 'node_modules', 'local-only', 'package.json'), JSON.stringify({ name: 'local-only', version: '0.0.0' }))
    expect(resolveBundleDir('t', 'in-box', anchor, profileDir)).toContain('in-box')
    expect(resolveBundleDir('t', 'local-only', anchor, profileDir)).toContain('local-only')
    expect(() => resolveBundleDir('t', 'absent', anchor, profileDir)).toThrow('cannot resolve profile bundle')
  })

  it('resolves a package whose exports map omits ./package.json', () => {
    // Common on npm: an exports map without "./package.json" makes
    // require.resolve('<pkg>/package.json') throw ERR_PACKAGE_PATH_NOT_EXPORTED;
    // resolution must fall through to the paths probe instead of misreporting
    // the installed package as missing.
    const anchor = stageInstallation({})
    const profileDir = tmp()
    writeFileSync(join(profileDir, 'package.json'), '{}')
    const dir = join(profileDir, 'node_modules', 'sealed-bundle')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'sealed-bundle',
      version: '0.0.0',
      exports: { '.': './index.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(dir, 'index.js'), '')
    writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
    expect(resolveBundleDir('t', 'sealed-bundle', anchor, profileDir)).toBe(dir)
  })
})

describe('profile runtime shadows', () => {
  it('reports only differing profile-local copies of installation-owned DSH and Cordis packages', () => {
    const anchor = stageInstallation({
      '@deepseek-ai/dsh-client-ui-shell': {},
      '@deepseek-ai/cordis-plugin-loader': {},
      'plain-library': {},
    })
    const profileDir = tmp()
    writeFileSync(join(profileDir, 'package.json'), '{}')
    for (const name of [
      '@deepseek-ai/dsh-client-ui-shell',
      '@deepseek-ai/cordis-plugin-loader',
      'plain-library',
    ]) {
      const dir = join(profileDir, 'node_modules', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '99.0.0' }))
    }

    expect(findProfileRuntimeShadows(anchor, profileDir)).toEqual([
      '@deepseek-ai/cordis-plugin-loader',
      '@deepseek-ai/dsh-client-ui-shell',
    ])
    expect(() => { assertNoProfileRuntimeShadows('t', anchor, profileDir) })
      .toThrow('profile-local copies of app runtime packages')

    rmSync(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true })
    const packageName = '@deepseek-ai/dsh-client-ui-shell'
    const linkedDir = join(profileDir, 'node_modules', packageName)
    mkdirSync(dirname(linkedDir), { recursive: true })
    symlinkSync(
      join(dirname(anchor), 'node_modules', packageName),
      linkedDir,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(findProfileRuntimeShadows(anchor, profileDir)).toEqual([])
    expect(() => { assertNoProfileRuntimeShadows('t', anchor, profileDir) }).not.toThrow()
  })
})

describe('loadProfile', () => {
  it('resolves each dsh.profile.bundles entry to its patch layer in order, plus the user layer', () => {
    const anchor = stageInstallation({
      'bundle-a': { patch: '- insert:\n    - id: a\n      name: pkg-a\n' },
      'bundle-b': { patch: '- id: a\n  config:\n    v: 2\n' },
    })
    const home = tmp()
    const dir = resolveProfileDir('demo', home)
    initProfile(dir, ['bundle-a', 'bundle-b'])
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), '- id: a\n  config:\n    v: 3\n')
    const profile = loadProfile('t', 'demo', anchor, home)
    expect(profile.layers.map(layer => layer.packageName)).toEqual(['bundle-a', 'bundle-b'])
    expect(profile.patches).toHaveLength(1)
    const entries = composeEntries([
      ...profile.layers.map(layer => layer.patches),
      profile.patches,
    ])
    expect(entries).toEqual([{ id: 'a', name: 'pkg-a', config: { v: 3 } }])
    // A hand-made profile without the user layer file or dsh section: empty layers, no throw.
    rmSync(join(dir, PROFILE_PATCH_FILENAME))
    expect(loadProfile('t', 'demo', anchor, home).patches).toEqual([])
    writeProfileManifest(dir, { name: 'bare' })
    const bare = loadProfile('t', 'demo', anchor, home)
    expect(bare.layers).toEqual([])
  })

  it('auto-initializes only shipped templates and fails loud otherwise', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    expect(() => loadProfile('t', 'custom', anchor, home))
      .toThrow('profile "custom" does not exist')
    // The web template auto-initializes on first load. Bundle resolution
    // cannot be asserted to fail here: the source-plane test runner resolves
    // @deepseek-ai/* through tsconfig paths regardless of the staged anchor.
    expect(PROFILE_TEMPLATES.web).toContain('@deepseek-ai/dsh-base')
    expect(PROFILE_TEMPLATES.web).not.toContain('@liustack/modlens')
    expect(PROFILE_TEMPLATES.web).toContain('dsh-file-uploads')
    try {
      loadProfile('t', 'web', anchor, home)
    } catch {
      // Resolution failure is the plain-Node outcome for this empty anchor.
    }
    expect(readProfileManifest('t', resolveProfileDir('web', home)).dsh?.profile?.bundles)
      .toEqual([...PROFILE_TEMPLATES.web ?? []])
  })

  it('normalizes only exact installation-owned bundle tuples', () => {
    const anchor = stageInstallation({
      '@deepseek-ai/dsh-base': { patch: '[]\n' },
      '@deepseek-ai/dsh-web-app': { patch: '[]\n' },
      '@deepseek-ai/dsh-headless': { patch: '[]\n' },
      '@liustack/modlens': { patch: '[]\n' },
      'dsh-file-uploads': { patch: '[]\n' },
      'custom-bundle': { patch: '[]\n' },
    })
    const webHome = tmp()
    const web = resolveProfileDir('web', webHome)
    initProfile(web, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    loadProfile('t', 'web', anchor, webHome)
    expect(readProfileManifest('t', web).dsh?.profile?.bundles)
      .toEqual([...PROFILE_TEMPLATES.web ?? []])

    const legacyWebHome = tmp()
    const legacyWeb = resolveProfileDir('web', legacyWebHome)
    initProfile(legacyWeb, [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@liustack/modlens', 'dsh-file-uploads',
    ])
    const legacyManifest = readProfileManifest('t', legacyWeb)
    legacyManifest.dependencies = { 'user-installed-package': '1.0.0' }
    writeProfileManifest(legacyWeb, legacyManifest)
    loadProfile('t', 'web', anchor, legacyWebHome)
    expect(readProfileManifest('t', legacyWeb)).toMatchObject({
      dependencies: { 'user-installed-package': '1.0.0' },
      dsh: { profile: { bundles: [...PROFILE_TEMPLATES.web ?? []] } },
    })

    const home = tmp()
    const stock = resolveProfileDir('headless', home)
    initProfile(stock, [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless',
    ])
    loadProfile('t', 'headless', anchor, home)
    expect(readProfileManifest('t', stock).dsh?.profile?.bundles)
      .toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'])

    const customHome = tmp()
    const custom = resolveProfileDir('headless', customHome)
    initProfile(custom, [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless', 'custom-bundle',
    ])
    loadProfile('t', 'headless', anchor, customHome)
    expect(readProfileManifest('t', custom).dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless', 'custom-bundle',
    ])

    const customWebHome = tmp()
    const customWeb = resolveProfileDir('web', customWebHome)
    initProfile(customWeb, [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-file-uploads', '@liustack/modlens',
    ])
    const customWebPath = join(customWeb, 'package.json')
    const customWebBefore = readFileSync(customWebPath, 'utf8')
    loadProfile('t', 'web', anchor, customWebHome)
    expect(readFileSync(customWebPath, 'utf8')).toBe(customWebBefore)
  })

  it('fails loud when a listed bundle declares no dsh.bundle', () => {
    const anchor = stageInstallation({ 'not-a-bundle': {} })
    const home = tmp()
    const dir = resolveProfileDir('demo', home)
    initProfile(dir, ['not-a-bundle'])
    expect(() => loadProfile('t', 'demo', anchor, home)).toThrow('declares no dsh.bundle')
  })
})

describe('composeEntries', () => {
  it('applies layers over an empty root and reports skipped patches', () => {
    const warnings: string[] = []
    const entries = composeEntries([
      [{ insert: [{ id: 'x', name: 'pkg-x', config: { a: 1 } }] }],
      [{ id: 'x', config: { a: 2 } }, { id: 'missing', config: {} }],
    ], message => warnings.push(message))
    expect(entries).toEqual([{ id: 'x', name: 'pkg-x', config: { a: 2 } }])
    expect(warnings.join('\n')).toContain('"missing"')
    // Default warn sink: skipped patches are silently dropped (boot repeats them).
    expect(composeEntries([[{ id: 'missing', config: {} }]])).toEqual([])
  })
})

describe('registerProfileModuleFallback', () => {
  it('leaves a legacy shared module directory untouched', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    const legacy = join(home, 'profiles', 'node_modules')
    mkdirSync(join(legacy, 'copied-package'), { recursive: true })
    writeFileSync(join(legacy, 'copied-package', 'marker'), 'preserved')

    const unregister = registerProfileModuleFallback(anchor, home)
    try {
      expect(readFileSync(join(legacy, 'copied-package', 'marker'), 'utf8')).toBe('preserved')
    } finally {
      unregister()
      unregister()
    }
  })

  it('ignores a dereferenced legacy link to an obsolete app package', () => {
    const packageName = '@deepseek-ai/dsh-client-ui-shell'
    const anchor = stageInstallation({ [packageName]: {} })
    const installedDir = join(dirname(anchor), 'node_modules', packageName)
    writeFileSync(join(installedDir, 'index.js'), "module.exports = { source: 'current' }\n")

    const home = tmp()
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    const obsoleteDir = join(tmp(), 'obsolete-client-ui-shell')
    mkdirSync(obsoleteDir, { recursive: true })
    writeFileSync(join(obsoleteDir, 'package.json'), JSON.stringify({ name: packageName, version: 'old', main: './index.js' }))
    writeFileSync(join(obsoleteDir, 'index.js'), "module.exports = { source: 'obsolete' }\n")
    const legacyLink = join(home, 'profiles', 'node_modules', packageName)
    mkdirSync(dirname(legacyLink), { recursive: true })
    symlinkSync(obsoleteDir, legacyLink, process.platform === 'win32' ? 'junction' : 'dir')
    const unregister = registerProfileModuleFallback(anchor, home)
    try {
      const internal = ModuleLoader.fromInternal()
      if (internal === undefined) throw new Error('Node internal module loader unavailable')
      const parentUrl = pathToFileURL(profileDir).href + '/'
      const specifier = `${packageName}/package.json`
      const result = internal.version === 'v1'
        ? internal.resolveSync(specifier, parentUrl, { type: 'json' })
        : internal.resolveSync(parentUrl, { specifier, attributes: { type: 'json' } })
      expect(fileURLToPath(result.url)).toBe(join(installedDir, 'package.json'))
    } finally {
      unregister()
    }
  })
})
