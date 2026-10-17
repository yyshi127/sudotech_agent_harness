/** API-key authentication and credential-gated discovery for the official DeepSeek route. */
import { createHash } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-settings'
import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { registerDeepSeekProvider, catalogModelInfo } from '@deepseek-ai/dsh-llm-deepseek'
import { Config, plainOptions, resolveAdapterOptions } from './config.ts'
import type { ResolvedDeepSeekOptions } from './config.ts'

export type { DeepSeekRequestIdentity } from './request-identity.ts'
export { Config, plainOptions, resolveAdapterOptions } from './config.ts'
export type { Options, ResolvedDeepSeekOptions } from './config.ts'
export const name = 'llm-deepseek-api-key'
export const inject = ['llm']

const PROVIDER = 'deepseek-official'

export function apply(ctx: Context, config: Config): void {
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  ctx.inject(['settings'], (child) => {
    const migrateLegacyModels = async (): Promise<void> => {
      const section = child.settings.describe().find(item => item.ns === settingsNs)
      const user = section?.user
      const storedModels = user !== null && typeof user === 'object' && !Array.isArray(user) && 'models' in user
        ? user.models : undefined
      if (section !== undefined && isLegacyDefaultModels(storedModels)) {
        await child.settings.mutate(settingsNs, [{ op: 'unset', path: ['models'] }], section.revision)
      } else if (section !== undefined && hasLegacyFlashWithoutCurrent(storedModels)) {
        const storedIds = new Set(storedModels.map(model => model['id']))
        const missing = resolveAdapterOptions({}).models.filter(model => !storedIds.has(model.id))
        await child.settings.mutate(settingsNs, [{ op: 'set', path: ['models'], value: [...missing, ...storedModels] }], section.revision)
      }
    }
    let migrations = Promise.resolve()
    const scheduleMigration = (): void => {
      migrations = migrations.then(migrateLegacyModels).catch((error: unknown) => {
        ctx.logger.warn('llm-deepseek: could not migrate a legacy model catalog')
        ctx.logger.warn(error)
      })
    }
    child.on('settings/document-updated', (ns) => {
      if (ns === settingsNs) scheduleMigration()
    })
    scheduleMigration()
  })
  const options = () => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))
  options()
  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepseek', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) return assertUsableApiKey(ambient.value, 'llm-deepseek', ref)
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'DeepSeek', settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: [] },
  ])
  registerDeepSeekProvider(ctx, PROVIDER, {
    options, providerName: 'DeepSeek',
    resolveAuth: async (connection) => {
      const key = await resolveApiKey(connection)
      ctx.emit('llm-deepseek/request-identity', {
        baseURL: connection.baseURL,
        authentication: { kind: 'api-key', keyFingerprint: createHash('sha256').update(key, 'utf8').digest('hex') },
      })
      return { headers: { 'x-api-key': key } }
    },
    discoverModels: async (provider) => {
      const connection = options()
      try { await resolveApiKey(connection) }
      catch (error) {
        if (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL') return []
        throw error
      }
      return connection.models.map(model => catalogModelInfo(provider, model))
    },
  })
}

function hasLegacyFlashWithoutCurrent(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every((entry: unknown) => entry !== null && typeof entry === 'object' && !Array.isArray(entry))) return false
  const ids = value.map((entry: unknown) => (entry as Record<string, unknown>)['id'])
  return !ids.includes('deepseek-flash')
    && (ids.includes('deepseek-v4-flash') || ids.includes('deepseek-v4-flash-vision-exp'))
}

function isLegacyDefaultModels(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 3) return false
  const expected = [
    { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', image: false },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', image: false },
    { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Flash-Vision-Exp', image: true },
  ] as const
  return value.every((entry: unknown, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
    const model = entry as Record<string, unknown>
    const known = expected[index]
    if (known === undefined) return false
    if (Object.keys(model).some(key => !['id', 'name', 'contextWindow', 'inputModalities', 'imagePixelBudget', 'imageMaxBytes'].includes(key))) return false
    if (model['id'] !== known.id || model['name'] !== known.name || model['contextWindow'] !== 1_000_000) return false
    const modalities = model['inputModalities']
    if (modalities !== undefined
      && (!Array.isArray(modalities) || modalities.join(',') !== (known.image ? 'text,image' : 'text'))) return false
    return known.image
      ? (model['imagePixelBudget'] === undefined || model['imagePixelBudget'] === 640_000)
        && (model['imageMaxBytes'] === undefined || model['imageMaxBytes'] === 1_048_576)
      : model['imagePixelBudget'] === undefined && model['imageMaxBytes'] === undefined
  })
}
