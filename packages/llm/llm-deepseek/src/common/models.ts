/** Default catalog shared by every DeepSeek protocol. */
import { DEFAULT_CONTEXT_WINDOW } from './defaults.ts'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from './types.ts'

const FLASH_MODEL: DeepSeekCatalogModel = {
  id: 'deepseek-flash',
  name: 'DeepSeek-V41-Flash',
  description: 'Fast text-and-image model for everyday tasks.',
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  inputModalities: ['text', 'image'],
  systemPromptUpdate: 'in-history',
}

/** Advisory official model entries; deployments may replace the catalog. */
export const DEFAULT_MODELS: DeepSeekCatalogModel[] = [FLASH_MODEL]

/** Resolve configured capabilities while keeping retired Flash wire aliases out of the selector. */
export function configuredModel(connection: DeepSeekConnectionOptions, id: string): DeepSeekCatalogModel | undefined {
  const configured = connection.models.find(model => model.id === id)
  if (configured !== undefined) return configured
  return id === 'deepseek-v4-flash' || id === 'deepseek-v4-flash-vision-exp'
    ? { ...FLASH_MODEL, id, name: id }
    : undefined
}
