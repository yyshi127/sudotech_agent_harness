import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Files staged for one plugin-runtime-shadow CLI scenario. */
export interface RuntimeShadowPluginFixture {
  /** Temporary root removed by the caller. */
  root: string
  /** Isolated Harness home passed as `DSH_HOME`. */
  harnessHome: string
  /** Local file dependency spec for the incompatible plugin. */
  pluginSpec: string
}

/**
 * Stage a bundle whose transitive dependency impersonates an app-owned runtime package.
 * @returns isolated profile home and plugin spec.
 */
export function stageRuntimeShadowPlugin(): RuntimeShadowPluginFixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-runtime-shadow-'))
  const harnessHome = join(root, 'harness-home')
  const shadow = join(root, 'runtime-shadow')
  const plugin = join(root, 'incompatible-bundle')
  mkdirSync(harnessHome, { recursive: true })
  mkdirSync(shadow, { recursive: true })
  mkdirSync(plugin, { recursive: true })
  writeFileSync(join(shadow, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-app-boot',
    version: '99.0.0',
  }))
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({
    name: 'incompatible-bundle',
    version: '1.0.0',
    dependencies: {
      '@deepseek-ai/dsh-app-boot': `file:${shadow.replaceAll('\\', '/')}`,
    },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(plugin, 'cordis.patch.yml'), '[]\n')
  return {
    root,
    harnessHome,
    pluginSpec: `file:${plugin.replaceAll('\\', '/')}`,
  }
}
