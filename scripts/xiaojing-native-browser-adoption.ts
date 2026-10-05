/**
 * Exact package edges adopted by the Xiaojing native-browser composition.
 * @see ../.agents/notes/implemented/process/2026-10-03-xiaojing-native-browser-adoption.md
 */

/** Workspace identity used by the source and manifest isolation checks. */
export interface NativeBrowserPackageIdentity {
  /** Repository-relative package directory, with forward slashes. */
  dir: string
  /** Declared package name; missing names cannot claim adoption. */
  name: string | undefined
}

const consumer = {
  dir: 'packages/xiaojing/xiaojing-browser-control',
  name: '@deepseek-ai/dsh-xiaojing-browser-control',
}
const providers = [
  { dir: 'packages/experimental/browser-use-chrome-devtools-mcp', name: '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp' },
  { dir: 'packages/experimental/browser-use-playwright-mcp', name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp' },
]
const runtime = {
  dir: 'packages/experimental/browser-use-runtime',
  name: '@deepseek-ai/dsh-experimental-browser-use-runtime',
}

function matches(actual: NativeBrowserPackageIdentity, expected: NativeBrowserPackageIdentity): boolean {
  return actual.dir === expected.dir && actual.name === expected.name
}

/**
 * Identify the exact adopted packages whose outgoing edges require inspection.
 * @param identity - repository directory and declared package name.
 * @returns whether both values identify an adopted package.
 */
export function isAdoptedNativeBrowserPackage(identity: NativeBrowserPackageIdentity): boolean {
  return [consumer, ...providers, runtime].some(expected => matches(identity, expected))
}

/**
 * Accept only the native consumer's three direct dependencies and the two providers' runtime dependency.
 * @param owner - importing package's exact identity.
 * @param section - manifest dependency section.
 * @param target - resolved dependency's exact identity.
 * @param specifier - dependency key; aliases and subpaths do not qualify.
 * @returns whether the declared dependency is an adopted native-browser edge.
 */
export function isAdoptedNativeBrowserDependency(
  owner: NativeBrowserPackageIdentity, section: string, target: NativeBrowserPackageIdentity, specifier: string,
): boolean {
  if (section !== 'dependencies' || specifier !== target.name) return false
  if (matches(owner, consumer)) return [...providers, runtime].some(expected => matches(target, expected))
  return providers.some(provider => matches(owner, provider)) && matches(target, runtime)
}

/**
 * Accept the product's native entry imports and each provider's runtime/mcp import only.
 * @param owner - importing package's exact identity.
 * @param sourcePath - repository-relative importing source file.
 * @param target - resolved imported package's exact identity.
 * @param specifier - literal module specifier; alternate entrypoints and local paths do not qualify.
 * @returns whether the source import is one of the adopted native-browser edges.
 */
export function isAdoptedNativeBrowserSource(
  owner: NativeBrowserPackageIdentity, sourcePath: string, target: NativeBrowserPackageIdentity, specifier: string,
): boolean {
  if (matches(owner, consumer) && sourcePath === `${consumer.dir}/src/native.ts`) {
    return specifier === target.name && [...providers, runtime].some(expected => matches(target, expected))
  }
  return providers.some(provider => matches(owner, provider) && sourcePath === `${provider.dir}/src/index.ts`)
    && matches(target, runtime) && specifier === `${runtime.name}/mcp`
}
