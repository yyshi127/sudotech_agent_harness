/** Default DeepSeek model catalog. */
import { DEFAULT_CONTEXT_WINDOW } from './defaults.ts'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from './types.ts'

const FLASH_MODEL: DeepSeekCatalogModel = {
  id: 'deepseek-flash',
  name: 'DeepSeek-V4.1-Flash',
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  inputModalities: ['text', 'image'],
  systemPromptUpdate: 'in-history',
  toolUpdate: 'addition-only',
}

/** Advisory official model entries; deployments may replace the catalog. */
export const DEFAULT_MODELS: DeepSeekCatalogModel[] = [
  FLASH_MODEL,
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    description: 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
]

/**
 * Resolve configured capabilities while keeping retired Flash wire aliases out of the selector.
 * @param connection - selected connection and its configured model catalog.
 * @param id - requested model identifier, including a retained Flash alias.
 * @returns configured model capabilities, or undefined for an unknown identifier.
 */
export function configuredModel(connection: DeepSeekConnectionOptions, id: string): DeepSeekCatalogModel | undefined {
  const configured = connection.models.find(model => model.id === id)
  if (configured !== undefined) return configured
  return id === 'deepseek-v4-flash' || id === 'deepseek-v4-flash-vision-exp'
    ? { ...FLASH_MODEL, id, name: id }
    : undefined
}
