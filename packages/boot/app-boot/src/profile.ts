/**
 * Profile discovery, initialization, and patch-layer composition for the
 * `dsh --profile` launcher family.
 *
 * A profile is a directory under `$DSH_HOME/profiles/<name>` holding a
 * `package.json` (out-of-tree plugin dependencies plus the profile manifest
 * `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml`
 * (the user's own patch layer, applied after every bundle layer). Bundles are
 * npm packages whose manifest declares
 * `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`; the tree is
 * composed by applying each bundle's patch list in `dsh.profile.bundles` order over
 * an empty entry list, then the profile's own patches, then any launcher
 * layers (`--patch` files and flag-derived patches).
 *
 * Module resolution is two-anchor by construction: a bundle name resolves
 * first from the dsh installation (the launcher's own package), then from the
 * profile directory. The Loader's `baseUrl` is the profile directory, whose
 * `node_modules` pnpm manages for out-of-tree plugins. A scoped Node module
 * hook falls back to the installation for missing imports issued by those
 * profile modules, including their Harness and Cordis peer dependencies.
 * @module @deepseek-ai/dsh-app-boot/profile
 */

import { randomBytes } from 'node:crypto'
import { createRequire, registerHooks } from 'node:module'
import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { loadOverlayPatches } from './index.ts'

/** Directory under the Harness home holding every profile. */
export const PROFILES_DIR = 'profiles'

/** The user patch layer inside a profile directory (hot-reloaded on long-lived surfaces). */
export const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** The bundle half of the `dsh` manifest section: what a bundle package exports. */
export interface DshBundleManifest {
  /** The patch layer this bundle exports, relative to its package root. */
  patch: string
}

/** The profile half of the `dsh` manifest section: what a profile directory composes. */
export interface DshProfileManifest {
  /** Ordered bundle layer list (package names). */
  bundles?: string[]
}

/**
 * The profile-launcher slice of the `dsh`-owned package.json section. A
 * manifest may declare both roles; other consumers own additional keys.
 */
export interface DshManifestSection {
  /** Bundle metadata consumed by the profile launcher. */
  bundle?: DshBundleManifest
  /** Profile metadata consumed by the profile launcher. */
  profile?: DshProfileManifest
}

/** The slice of package.json both profiles and bundles use. */
export interface ProfileManifest {
  name?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: DshManifestSection
}

/** One resolved bundle layer of a profile. */
export interface ProfileLayer {
  /** The bundle's package name, as listed in `dsh.profile.bundles`. */
  packageName: string
  /** Absolute directory of the resolved bundle package. */
  packageDir: string
  /** Absolute path of the bundle's patch file. */
  patchPath: string
  /** The parsed patch list. */
  patches: PatchOptions[]
}

/** A loaded profile: resolved bundle layers plus the user's own patch layer. */
export interface Profile {
  /** The profile name (its directory basename). */
  name: string
  /** Absolute profile directory. */
  dir: string
  /** Bundle layers in `dsh.profile.bundles` order. */
  layers: ProfileLayer[]
  /** Absolute path of the profile's own patch file. */
  patchPath: string
  /** The profile's own patches; empty when the file is absent. */
  patches: PatchOptions[]
}

/**
 * Resolve a profile's directory under the Harness home.
 * @param name - the profile name (`dsh --profile <name>`).
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 * @returns the absolute profile directory (which may not exist yet).
 */
export function resolveProfileDir(name: string, home: string = resolveDshHome()): string {
  if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..'
    // Reserved for the retired launcher fallback from releases before the
    // scoped module resolver.
    || name === 'node_modules') {
    throw new Error(`dsh: invalid profile name ${JSON.stringify(name)}`)
  }
  return join(home, PROFILES_DIR, name)
}

/** The shipped profile templates auto-initialized on first use, by name. */
export const PROFILE_TEMPLATES: Record<string, readonly string[]> = {
  web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-file-uploads'],
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
}

/** Installation-owned bundle tuples normalized to the shipped template. */
const INSTALLATION_OWNED_PROFILE_TUPLES: Record<string, readonly (readonly string[])[]> = {
  web: [
    ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@liustack/modlens', 'dsh-file-uploads'],
  ],
  headless: [['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless']],
}

/** The bundle list a `dsh plugin` init uses for a name with no shipped template. */
export const DEFAULT_PROFILE_BUNDLES: readonly string[] = ['@deepseek-ai/dsh-base']

const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

// The hoisted linker gives out-of-tree plugins a flat node_modules; missing
// app-owned peers (Cordis and friends) fall through to the launcher's scoped
// installation resolver, so every plugin shares the installation's single
// Cordis instance instead of a duplicate. pnpm ≥10
// reads its settings from pnpm-workspace.yaml, not .npmrc.
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/**
 * Initialize a profile directory: manifest, empty user patch layer, and the
 * pnpm settings out-of-tree plugins need. Existing files are never touched,
 * so re-running is a no-op on an initialized profile.
 * @param dir - the profile directory from {@link resolveProfileDir}.
 * @param bundles - the initial `dsh.profile.bundles` layer list.
 */
export function initProfile(dir: string, bundles: readonly string[]): void {
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    const manifest: ProfileManifest & { private: boolean } = {
      name: `dsh-profile-${basename(dir)}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...bundles] } },
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
  }
  const patchPath = join(dir, PROFILE_PATCH_FILENAME)
  if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE)
  const workspacePath = join(dir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
}

/** Return whether one installed package belongs to the Harness/Cordis runtime supplied by the app. */
function isProtectedRuntimePackage(packageName: string): boolean {
  return /^@deepseek-ai\/(?:dsh|cordis)(?:-|$)/.test(packageName)
}

/**
 * Resolve the installation's dependency closure by package name. The first
 * resolution wins, matching Node's nearest-package lookup from each owner.
 * @param installAnchor - absolute path of the dsh app's package.json.
 * @returns package name to installed package directory.
 */
function installationPackageDirs(installAnchor: string): Map<string, string> {
  const appManifest = JSON.parse(readFileSync(installAnchor, 'utf8')) as ProfileManifest
  const packages = new Map<string, string>()
  /* v8 ignore next -- a real app manifest always declares its name */
  if (appManifest.name !== undefined) packages.set(appManifest.name, dirname(installAnchor))
  const queue: { anchor: string; manifest: ProfileManifest }[] = [{ anchor: installAnchor, manifest: appManifest }]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    // Peer dependencies participate because out-of-tree plugins import the
    // installation's Service Definition packages directly.
    /* v8 ignore next -- a real app manifest always declares dependencies */
    for (const dependency of [
      ...Object.keys(next.manifest.dependencies ?? {}),
      ...Object.keys(next.manifest.peerDependencies ?? {}),
    ]) {
      if (packages.has(dependency)) continue
      const dir = packageDirFromAnchor(next.anchor, dependency)
      // A declared but uninstalled package cannot shadow or supply a plugin.
      if (dir === undefined) continue
      packages.set(dependency, dir)
      const manifestPath = join(dir, 'package.json')
      queue.push({
        anchor: manifestPath,
        manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest,
      })
    }
  }
  return packages
}

/**
 * Find profile-local copies of app-owned Harness/Cordis runtime packages.
 * Such copies win Loader resolution from the profile and can replace the
 * app's shipped backend or browser modules even though bundle manifests use
 * installation-first resolution.
 * @param installAnchor - absolute path of the dsh app's package.json.
 * @param profileDir - profile directory whose pnpm-managed node_modules is inspected.
 * @returns stable package-name list of runtime shadows.
 */
export function findProfileRuntimeShadows(installAnchor: string, profileDir: string): string[] {
  const shadows: string[] = []
  for (const [packageName, installationDir] of installationPackageDirs(installAnchor)) {
    if (!isProtectedRuntimePackage(packageName)) continue
    const profilePackageDir = join(profileDir, 'node_modules', packageName)
    if (!existsSync(join(profilePackageDir, 'package.json'))) continue
    if (realpathSync(profilePackageDir) !== realpathSync(installationDir)) shadows.push(packageName)
  }
  return shadows.sort()
}

/**
 * Reject a profile whose local dependencies can shadow the app-owned runtime.
 * @param binName - diagnostic prefix.
 * @param installAnchor - absolute path of the dsh app's package.json.
 * @param profileDir - profile directory to inspect.
 */
export function assertNoProfileRuntimeShadows(
  binName: string,
  installAnchor: string,
  profileDir: string,
): void {
  const shadows = findProfileRuntimeShadows(installAnchor, profileDir)
  if (shadows.length === 0) return
  throw new Error(
    `${binName}: profile ${JSON.stringify(basename(profileDir))} contains profile-local copies of app runtime packages: `
    + `${shadows.join(', ')}; remove the plugin that depends on them before starting this profile`,
  )
}

function isPathInside(parentUrl: string | undefined, directory: string): boolean {
  if (parentUrl === undefined || !parentUrl.startsWith('file:')) return false
  const path = relative(directory, fileURLToPath(parentUrl))
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function isBarePackageSpecifier(specifier: string): boolean {
  return specifier !== ''
    && !specifier.startsWith('.')
    && !specifier.startsWith('#')
    && !isAbsolute(specifier)
    && !specifier.includes(':')
}

function packageNameFromSpecifier(specifier: string): string {
  const firstSlash = specifier.indexOf('/')
  if (firstSlash === -1 || !specifier.startsWith('@')) {
    return firstSlash === -1 ? specifier : specifier.slice(0, firstSlash)
  }
  const secondSlash = specifier.indexOf('/', firstSlash + 1)
  return secondSlash === -1 ? specifier : specifier.slice(0, secondSlash)
}

function packageResolutionParent(packageName: string, packageDir: string): string {
  const modulesDir = packageName.startsWith('@') ? dirname(dirname(packageDir)) : dirname(packageDir)
  return pathToFileURL(join(modulesDir, '.dsh-profile-module-fallback.mjs')).href
}

/** Return whether Node resolved a package through the retired shared profile directory, including a dereferenced link. */
function isLegacyProfileResolution(resolvedUrl: string, legacyModules: string, packageName: string): boolean {
  if (isPathInside(resolvedUrl, legacyModules)) return true
  if (!resolvedUrl.startsWith('file:')) return false
  const legacyPackageDir = join(legacyModules, packageName)
  try {
    return isPathInside(resolvedUrl, realpathSync(legacyPackageDir))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Register the profile-only module fallback used by the dsh launcher.
 * Imports resolve normally from a profile first; a missing bare package
 * imported by code under `$DSH_HOME/profiles` retries from the dsh
 * installation. App-owned packages resolved from the deprecated shared link
 * directory are ignored, so copied directories and stale links cannot shadow
 * the current installation; the legacy directory itself remains untouched.
 * @param installAnchor - absolute path of the dsh app's package.json.
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 * @returns an idempotent disposer that unregisters the process-wide hook.
 */
export function registerProfileModuleFallback(
  installAnchor: string,
  home: string = resolveDshHome(),
): () => void {
  const profilesDir = join(home, PROFILES_DIR)
  const legacyModules = join(profilesDir, 'node_modules')
  const installationPackages = installationPackageDirs(installAnchor)
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!isBarePackageSpecifier(specifier) || !isPathInside(context.parentURL, profilesDir)) {
        return nextResolve(specifier, context)
      }
      const packageName = packageNameFromSpecifier(specifier)
      const packageDir = installationPackages.get(packageName)
      try {
        const resolved = nextResolve(specifier, context)
        if (packageDir === undefined || !isLegacyProfileResolution(resolved.url, legacyModules, packageName)) {
          return resolved
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND' || packageDir === undefined) throw error
      }
      return nextResolve(specifier, {
        ...context,
        parentURL: packageResolutionParent(packageName, packageDir),
      })
    },
  })
  let active = true
  return () => {
    if (!active) return
    active = false
    hooks.deregister()
  }
}

/**
 * Read a profile's manifest.
 * @param binName - the diagnostic prefix on the thrown error.
 * @param dir - the profile directory.
 * @returns the parsed manifest.
 */
export function readProfileManifest(binName: string, dir: string): ProfileManifest {
  const path = join(dir, 'package.json')
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`${binName}: failed to read profile manifest ${path}: ${String(error)}`)
  }
  // The field checks below validate the file data before trusting the parse type.
  const parsed = JSON.parse(raw) as ProfileManifest | null
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${binName}: profile manifest ${path} must hold a JSON object`)
  }
  return parsed
}

/**
 * Write a profile's manifest back (2-space JSON, trailing newline).
 * @param dir - the profile directory.
 * @param manifest - the manifest value to persist.
 */
export function writeProfileManifest(dir: string, manifest: ProfileManifest): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n')
}

/** Replace an existing profile manifest through a same-directory atomic rename. */
function writeProfileManifestAtomic(dir: string, manifest: ProfileManifest): void {
  const path = join(dir, 'package.json')
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(manifest, undefined, 2) + '\n', {
      flag: 'wx',
      mode: lstatSync(path).mode & 0o777,
    })
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/** Return whether two bundle lists have the same values in the same order. */
function sameBundles(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * Normalize an exact installation-owned bundle tuple to its shipped template
 * while preserving every other manifest field. Any other list is user-owned.
 */
function normalizeShippedProfile(name: string, dir: string, manifest: ProfileManifest): ProfileManifest {
  const installationOwnedTuples = INSTALLATION_OWNED_PROFILE_TUPLES[name]
  const current = PROFILE_TEMPLATES[name]
  const bundles = manifest.dsh?.profile?.bundles
  if (installationOwnedTuples === undefined || current === undefined || bundles === undefined
    || !installationOwnedTuples.some(tuple => sameBundles(bundles, tuple))) return manifest
  const normalized: ProfileManifest = {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles: [...current] },
    },
  }
  writeProfileManifestAtomic(dir, normalized)
  return normalized
}

/**
 * Resolve a package's root directory from one anchor without depending on the
 * package exporting `./package.json` (`require.resolve` would need that):
 * probe the require resolution paths for a directory holding the named
 * manifest. This is Node's own node_modules lookup order, so the result
 * matches what the Loader would import from the same anchor, and
 * `existsSync` follows the symlinks pnpm's isolated layout uses.
 */
function packageDirFromAnchor(anchor: string, packageName: string): string | undefined {
  // resolve.paths returns null only for builtins, which no bundle name is.
  /* v8 ignore next */
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Resolve one bundle package's directory: installation anchor first, then the
 * profile directory. The installation-first order is the contract that
 * `@deepseek-ai/dsh-base` (and every other in-box bundle) always comes from
 * the same installation as the running dsh, never from a profile-local copy.
 * Resolution does not require the package to export `./package.json`.
 * @param binName - the diagnostic prefix on the thrown error.
 * @param packageName - the bundle's package name from `dsh.profile.bundles`.
 * @param installAnchor - absolute path of a file inside the dsh app package (its package.json).
 * @param profileDir - the profile directory (second anchor).
 * @returns the bundle package's absolute directory.
 */
export function resolveBundleDir(
  binName: string, packageName: string, installAnchor: string, profileDir: string,
): string {
  for (const anchor of [installAnchor, join(profileDir, 'package.json')]) {
    const dir = packageDirFromAnchor(anchor, packageName)
    if (dir !== undefined) return dir
  }
  throw new Error(
    `${binName}: cannot resolve profile bundle ${JSON.stringify(packageName)} from the dsh installation or ${profileDir}; `
    + `run 'dsh plugin --profile ${basename(profileDir)} install' if its dependency is not installed`,
  )
}

/**
 * Load a profile: resolve every `dsh.profile.bundles` entry to its patch
 * layer and parse the profile's own patch file. A listed bundle without a
 * `dsh.bundle` manifest fails loud — naming a bundle-less package as a layer
 * is a misconfiguration, not "no patches".
 * @param binName - the diagnostic prefix on thrown errors.
 * @param name - the profile name.
 * @param installAnchor - absolute path of the dsh app's package.json (first resolution anchor).
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 * @param options - `userLayer: false` skips reading `cordis.patch.yml`, so a
 * bundles-only consumer (`--dump-default-config`, a recovery diagnostic)
 * cannot fail on a broken user layer.
 * @returns the loaded profile (empty `patches` when the user layer is skipped).
 */
export function loadProfile(
  binName: string, name: string, installAnchor: string, home: string = resolveDshHome(),
  options: { userLayer?: boolean } = {},
): Profile {
  const dir = resolveProfileDir(name, home)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[name]
    if (template === undefined) {
      throw new Error(
        `${binName}: profile ${JSON.stringify(name)} does not exist; create it with 'dsh plugin --profile ${name} add <package>'`,
      )
    }
    initProfile(dir, template)
  }
  const manifest = normalizeShippedProfile(name, dir, readProfileManifest(binName, dir))
  // A hand-written profile manifest may omit the dsh section entirely.
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const layers = bundles.map((packageName): ProfileLayer => {
    const packageDir = resolveBundleDir(binName, packageName, installAnchor, dir)
    const bundleManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as ProfileManifest
    const declared = bundleManifest.dsh?.bundle?.patch
    if (declared === undefined) {
      throw new Error(`${binName}: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json`)
    }
    const patchPath = join(packageDir, declared)
    return { packageName, packageDir, patchPath, patches: loadOverlayPatches(binName, patchPath) }
  })
  const patchPath = join(dir, PROFILE_PATCH_FILENAME)
  const patches = options.userLayer !== false && existsSync(patchPath)
    ? loadOverlayPatches(binName, patchPath)
    : []
  return { name, dir, layers, patchPath, patches }
}

/**
 * Compose patch layers into the effective entry list over an empty root —
 * the same single `applyEntryPatches` call the boot include makes, so flag
 * derivation and config dumps see exactly what mounts.
 * @param layers - patch lists in application order.
 * @param warn - sink for skipped-patch diagnostics; defaults to silent (boot repeats them).
 * @returns the composed entry list.
 */
export function composeEntries(
  layers: readonly PatchOptions[][], warn: (message: string) => void = () => {},
): EntryOptions[] {
  return applyEntryPatches([], structuredClone(layers.flat()), (message: string, ...args: unknown[]) => {
    let index = 0
    warn(message.replace(/%C/g, () => JSON.stringify(args[index++])))
  })
}
