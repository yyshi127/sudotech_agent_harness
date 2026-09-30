/** Xiaojing declarative preset fixtures shared by Web product tests. */
import { xiaojingPresetPatches } from '../../cli/src/profile-boot.ts'
import type { LaunchOptions } from './scaffold.ts'

type PresetDefinition = NonNullable<NonNullable<LaunchOptions['agentPresets']>['definitions']>[number]

/** Load the product-owned Finance declaration with its Cordis expressions intact. */
export function financePresetDefinition(): PresetDefinition {
  for (const patch of xiaojingPresetPatches('xiaojing')) {
    if (!Array.isArray(patch.insert)) continue
    for (const candidate of patch.insert) {
      if (typeof candidate !== 'object' || candidate === null) continue
      const row = candidate as { name?: unknown; config?: unknown }
      if (row.name !== '@deepseek-ai/dsh-agent-preset') continue
      const config = row.config as Partial<PresetDefinition> | undefined
      if (config?.id === 'finance' && Array.isArray(config.plugins)) return config as PresetDefinition
    }
  }
  throw new Error('xiaojing Web test: Finance preset declaration is missing')
}
