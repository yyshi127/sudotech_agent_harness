/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the
 * `dsh.profile.bundles` layer list against the installed state (a dependency
 * resolving to a package that declares `dsh.bundle` joins the layer stack; a
 * removed or bundle-less dependency leaves it). Reconciling by installed
 * state, not by dependency diff, means `update` activates a package that
 * gained its `dsh.bundle` declaration in a newer version.
 * @module @deepseek-ai/dsh/plugin
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  findProfileRuntimeShadows,
  initProfile,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR } from './profile-boot.ts'

const NAME = 'dsh'

/** Profile files pnpm may rewrite while changing the dependency graph. */
const PROFILE_TRANSACTION_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'] as const

/** One dependency-file value before a pnpm operation. */
interface ProfileFileSnapshot {
  path: string
  content: Buffer | undefined
}

/** Capture the profile dependency files needed to roll back an incompatible graph. */
function snapshotProfileFiles(profileDir: string): ProfileFileSnapshot[] {
  return PROFILE_TRANSACTION_FILES.map((filename) => {
    const path = join(profileDir, filename)
    return { path, content: existsSync(path) ? readFileSync(path) : undefined }
  })
}

/** Restore dependency files exactly, including removing files pnpm created. */
function restoreProfileFiles(snapshots: readonly ProfileFileSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (snapshot.content === undefined) {
      rmSync(snapshot.path, { force: true })
    } else {
      writeFileSync(snapshot.path, snapshot.content)
    }
  }
}

/** Run pnpm with the profile's Windows shim handling. */
function spawnPnpm(profileDir: string, args: readonly string[]) {
  return spawnSync('pnpm', [...args], {
    cwd: profileDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

/**
 * Restore the old dependency graph after pnpm introduced app-runtime copies.
 * @param profileDir - profile directory pnpm changed.
 * @param snapshots - dependency files captured before the operation.
 * @returns true when pnpm materialized the restored graph successfully.
 */
function rollbackPluginChange(profileDir: string, snapshots: readonly ProfileFileSnapshot[]): boolean {
  restoreProfileFiles(snapshots)
  const result = spawnPnpm(profileDir, ['install', '--ignore-scripts'])
  // pnpm may create a lockfile when the prior profile had none. The rollback
  // promises the exact dependency-file state that preceded the rejected run.
  restoreProfileFiles(snapshots)
  return result.error === undefined && result.status === 0
}

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
function exportsPatch(packageName: string, profileDir: string): boolean {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
  }
  const manifest = readProfileManifest(NAME, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order); a
 * dependency-listed name that no longer does — removed, or the installed
 * version dropped the declaration — leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched. Warns once
 * per newly-added bundle-less dependency (a plain library is fine; the
 * warning is orientation).
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      process.stderr.write(
        `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)\n',
      )
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code.
 */
export function runPlugin(profile: string, args: readonly string[]): number {
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  const snapshots = snapshotProfileFiles(dir)
  const shadowsBefore = new Set(findProfileRuntimeShadows(INSTALL_ANCHOR, dir))
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening.
  const result = spawnPnpm(dir, args.map(argument => anchorPathSpec(argument, process.cwd())))
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      process.stderr.write(`${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
      return 127
    }
    throw result.error
  }
  const exitCode = result.status ?? 1
  if (exitCode === 0) {
    const introducedShadows = findProfileRuntimeShadows(INSTALL_ANCHOR, dir)
      .filter(packageName => !shadowsBefore.has(packageName))
    if (introducedShadows.length > 0) {
      process.stderr.write(
        `${NAME}: refused incompatible plugin change because it installed app runtime package(s): `
        + `${introducedShadows.join(', ')}\n`,
      )
      process.stderr.write(
        `${NAME}: plugins must use the app's DSH/Cordis runtime through peerDependencies instead of dependencies\n`,
      )
      let rolledBack = false
      try {
        rolledBack = rollbackPluginChange(dir, snapshots)
      } catch (error) {
        process.stderr.write(`${NAME}: automatic plugin rollback failed: ${String(error)}\n`)
      }
      const remaining = findProfileRuntimeShadows(INSTALL_ANCHOR, dir)
        .filter(packageName => !shadowsBefore.has(packageName))
      if (rolledBack && remaining.length === 0) {
        process.stderr.write(`${NAME}: restored the profile to its pre-install dependency state\n`)
      } else {
        process.stderr.write(
          `${NAME}: the profile remains blocked from startup; repair its dependencies in ${dir} before retrying\n`,
        )
      }
      return 1
    }
    reconcilePlugins(before, dir)
  } else {
    // pnpm's own diagnostics name pnpm-workspace.yaml without saying WHICH
    // one; the profile owns it, and the commonest failure here is pnpm ≥10
    // blocking a git dependency's prepare (build) script until allowlisted.
    process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
    if (args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
      process.stderr.write(
        `${NAME}: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — `
        + `add the exact key pnpm printed above under allowBuilds in ${join(dir, 'pnpm-workspace.yaml')}, then re-run\n`,
      )
    }
  }
  return exitCode
}
