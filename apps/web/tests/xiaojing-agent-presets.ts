/** Xiaojing declarative preset fixtures shared by Web product tests. */
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { LaunchOptions } from './scaffold.ts'

type PresetDefinition = NonNullable<NonNullable<LaunchOptions['agentPresets']>['definitions']>[number]

const FINANCE_PATCH = fileURLToPath(
  new URL('../../cli/config/xiaojing-agent-presets/finance/agent.cordis.yml', import.meta.url),
)

/** Load the product-owned Finance declaration with its Cordis expressions intact. */
export function financePresetDefinition(): PresetDefinition {
  for (const patch of loadOverlayPatches('xiaojing Web test', FINANCE_PATCH)) {
    if (!Array.isArray(patch.insert)) continue
    for (const candidate of patch.insert) {
      if (typeof candidate !== 'object' || candidate === null) continue
      const row = candidate as { name?: unknown; config?: unknown }
      if (row.name !== '@deepseek-ai/dsh-agent-preset') continue
      const config = row.config as Partial<PresetDefinition> | undefined
      if (config?.id === 'finance' && Array.isArray(config.plugins)) return config as PresetDefinition
    }
  }
  throw new Error(`xiaojing Web test: Finance preset declaration is missing from ${FINANCE_PATCH}`)
}
