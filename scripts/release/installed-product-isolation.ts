/** Experimental-package isolation for the installed default product's dependency graph. */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { OPTIONAL_BUNDLES } from '../../packages/boot/app-boot/src/profile.ts'
import { isAdoptedNativeBrowserDependency, type NativeBrowserPackageIdentity } from '../xiaojing-native-browser-adoption.ts'

interface InstalledManifest {
  name: string
  repository?: { directory?: string }
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/**
 * Reject unadopted experimental dependencies reachable from one installed product entry.
 * Other packages installed beside the entry and development dependencies do not join its graph.
 * @param directory - installed entry package directory.
 * @param optionalBundles - installation-owned bundles whose runtime graph is inactive by default.
 * @returns number of distinct installed packages visited.
 */
export function verifyInstalledProductIsolation(directory: string, optionalBundles: readonly string[] = OPTIONAL_BUNDLES): number {
  const visited = new Set<string>()
  const queue = [{ directory, chain: [] as string[], adopted: false }]
  for (const item of queue) {
    const canonical = realpathSync(item.directory)
    if (visited.has(canonical)) continue
    visited.add(canonical)
    const manifest = JSON.parse(readFileSync(join(canonical, 'package.json'), 'utf8')) as InstalledManifest
    const chain = [...item.chain, manifest.name]
    if (!item.adopted) rejectExperimentalManifest(manifest, chain)
    // The bundles the entry package ships switched off are installed beside the product, not required by it.
    const offered = item.chain.length === 0 ? new Set(optionalBundles) : new Set<string>()
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (section === 'dependencies' && offered.has(name)) {
          if (installedPackage(canonical, name) === undefined) throw new Error(`optional bundle is missing: ${[...chain, name].join(' -> ')}`)
          continue
        }
        if (range.startsWith('npm:')) {
          rejectExperimental(range.slice(4), [...chain, `${name} (${range})`])
        }
        const dependency = installedPackage(canonical, name)
        if (dependency === undefined) {
          rejectExperimental(name, [...chain, name])
          if (section === 'optionalDependencies'
            || Object.hasOwn(manifest.optionalDependencies ?? {}, name)
            || section === 'peerDependencies' && manifest.peerDependenciesMeta?.[name]?.optional === true) continue
          throw new Error(`default product dependency is missing: ${[...chain, name].join(' -> ')}`)
        }
        const resolved = JSON.parse(readFileSync(join(dependency, 'package.json'), 'utf8')) as InstalledManifest
        const adopted = !/^(?:npm:|file:|link:|workspace:(?:\.|@|[a-zA-Z]))/.test(range)
          && isAdoptedNativeBrowserDependency(packageIdentity(manifest), section, packageIdentity(resolved), name)
        // Validate every incoming edge before the visited check, including aliases to an already reached package.
        if (!adopted) {
          rejectExperimental(name, [...chain, name])
          rejectExperimentalManifest(resolved, [...chain, resolved.name])
        }
        queue.push({ directory: dependency, chain, adopted })
      }
    }
  }
  return visited.size
}

function packageIdentity(manifest: InstalledManifest): NativeBrowserPackageIdentity {
  const directory = manifest.repository?.directory
  return { name: manifest.name, dir: typeof directory === 'string' ? directory : '' }
}

function rejectExperimentalManifest(manifest: InstalledManifest, chain: readonly string[]): void {
  rejectExperimental(manifest.name, chain)
  if (packageIdentity(manifest).dir.startsWith('packages/experimental/')) {
    throw new Error(`default product includes an experimental package: ${chain.join(' -> ')}`)
  }
}

function rejectExperimental(name: string, chain: readonly string[]): void {
  if (name.startsWith('@deepseek-ai/dsh-experimental-')) {
    throw new Error(`default product includes an experimental package: ${chain.join(' -> ')}`)
  }
}

/** Resolve a dependency directory through the installed package's ancestor node_modules. */
function installedPackage(from: string, name: string): string | undefined {
  const resolver = createRequire(join(from, 'package.json'))
  for (const directory of resolver.resolve.paths(name) ?? []) {
    const candidate = join(directory, name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}
