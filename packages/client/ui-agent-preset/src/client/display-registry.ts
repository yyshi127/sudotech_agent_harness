/** Extensible display-copy registry for product-owned system presets. */

import type { AgentPresetSettingsKey, PresetDisplaySource, PresetDisplayText } from './locales.ts'
import { presetDisplayText } from './locales.ts'

/** Product-owned display-copy resolver for one system preset. */
export type AgentPresetDisplayProvider = (preset: PresetDisplaySource) => PresetDisplayText

/** Function passed to Agent-preset surfaces after locale and product overrides are resolved. */
export type AgentPresetDisplayResolver = (preset: PresetDisplaySource) => PresetDisplayText

/**
 * Registry of product-owned system-preset display copy.
 *
 * Official presets remain localized by this package. Product plugins register
 * only their own ids, so removing a product plugin restores file metadata
 * without leaving product names in the generic UI implementation.
 */
export class AgentPresetDisplayRegistry {
  private readonly providers = new Map<string, AgentPresetDisplayProvider>()

  /**
   * Register display copy for one product-owned system preset.
   * @param id - stable system-preset id.
   * @param provider - active-locale copy provider owned by the product plugin.
   * @returns idempotent disposer for this exact registration.
   */
  register(id: string, provider: AgentPresetDisplayProvider): () => void {
    if (this.providers.has(id)) throw new Error(`agent preset display provider already registered: ${id}`)
    this.providers.set(id, provider)
    return () => {
      if (this.providers.get(id) === provider) this.providers.delete(id)
    }
  }

  /**
   * Resolve one roster row through product copy, official copy, then file metadata.
   * @param preset - roster row being displayed.
   * @param t - generic Agent-preset locale lookup.
   * @returns display name and optional description for the active locale.
   */
  resolve(
    preset: PresetDisplaySource,
    t: (key: AgentPresetSettingsKey) => string,
  ): PresetDisplayText {
    const provider = preset.trust === 'system' ? this.providers.get(preset.id) : undefined
    return provider?.(preset) ?? presetDisplayText(preset, t)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Product-extensible display copy for system Agent presets. */
    agentPresetDisplay: AgentPresetDisplayRegistry
  }
}
