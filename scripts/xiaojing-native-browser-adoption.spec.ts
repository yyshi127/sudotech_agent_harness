/** Manifest-policy regressions for the product's exact native-browser adoption. */

import { describe, expect, it } from 'vitest'
import { checkExperimentalDependencyIsolation, type WorkspaceManifest } from './check-workspace-constraints.ts'

const runtime = {
  dir: 'packages/experimental/browser-use-runtime',
  manifest: { name: '@deepseek-ai/dsh-experimental-browser-use-runtime' },
} satisfies WorkspaceManifest
const providers = ['browser-use-chrome-devtools-mcp', 'browser-use-playwright-mcp'].map(name => ({
  dir: `packages/experimental/${name}`,
  manifest: { name: `@deepseek-ai/dsh-experimental-${name}`, dependencies: { [runtime.manifest.name]: 'workspace:*' } },
}))
const consumer = {
  dir: 'packages/xiaojing/xiaojing-browser-control',
  manifest: { name: '@deepseek-ai/dsh-xiaojing-browser-control',
    dependencies: Object.fromEntries([...providers, runtime].map(target => [target.manifest.name, 'workspace:*'])) },
} satisfies WorkspaceManifest
const other = { dir: 'packages/experimental/other', manifest: { name: '@deepseek-ai/dsh-experimental-other' } }

describe('native-browser dependency adoption', () => {
  it('accepts only the exact consumer dependencies and provider-to-runtime edges', () => {
    expect(checkExperimentalDependencyIsolation([consumer, ...providers, runtime])).toEqual([])
  })

  it.each(['peerDependencies', 'optionalDependencies'])(
    'rejects an adopted dependency in %s', (section) => {
      const invalid = { ...consumer, manifest: { name: consumer.manifest.name, [section]: consumer.manifest.dependencies } }
      expect(checkExperimentalDependencyIsolation([invalid, ...providers, runtime])).toHaveLength(3)
    },
  )

  it.each([
    { ...consumer, dir: `${consumer.dir}-copy` },
    { ...consumer, manifest: { ...consumer.manifest, name: `${consumer.manifest.name}-copy` } },
  ])('rejects a consumer that only partially matches its identity', (invalid) => {
    expect(checkExperimentalDependencyIsolation([invalid, ...providers, runtime])).toHaveLength(3)
  })

  it('rejects a known provider name at another directory or absent from the inventory', () => {
    const moved = providers.map(provider => ({ ...provider, dir: provider.dir.replace('/experimental/', '/core/') }))
    expect(checkExperimentalDependencyIsolation([consumer, ...moved, runtime]).length).toBeGreaterThan(0)
    expect(checkExperimentalDependencyIsolation([consumer, runtime])).toHaveLength(2)
  })

  it.each([...providers, runtime])('rejects another experimental outgoing dependency from $dir', (owner) => {
    const invalid = { ...owner, manifest: { ...owner.manifest, dependencies: { [other.manifest.name]: 'workspace:*' } } }
    expect(checkExperimentalDependencyIsolation([consumer, ...providers.filter(provider => provider.dir !== owner.dir),
      ...owner.dir === runtime.dir ? [] : [runtime], invalid, other]).join('\n')).toContain(other.manifest.name)
  })

  it('does not authorize the same providers for another stable or private application consumer', () => {
    for (const dir of ['packages/core/probe', 'apps/web']) {
      const invalid = { ...consumer, dir, manifest: { ...consumer.manifest, name: '@fixture/other' } }
      expect(checkExperimentalDependencyIsolation([invalid, ...providers, runtime])).toHaveLength(3)
    }
  })
})
