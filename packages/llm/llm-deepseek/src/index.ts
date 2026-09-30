/** Register DeepSeek Messages with live configuration and request-local credentials. */
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { DeepSeekAdapter } from './adapter.ts'
import { Config, plainOptions, resolveAdapterOptions } from './config.ts'
import type { ResolvedDeepSeekOptions } from './config.ts'
import { DEFAULT_MODELS } from './models.ts'
import type { DeepSeekRequestIdentity } from './types.ts'

export { Config, plainOptions, resolveAdapterOptions, PUBLIC_BASE_URL } from './config.ts'
export type { Options, ResolvedDeepSeekOptions } from './config.ts'
export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from './defaults.ts'
export { DeepSeekAdapter } from './adapter.ts'
export type {
  DeepSeekAdapterOptions,
  DeepSeekCatalogModel,
  DeepSeekConnectionOptions,
  DeepSeekRequestAuthentication,
  DeepSeekRequestIdentity,
} from './types.ts'
export {
  DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  REQUEST_IMAGE_MAX_DIMENSION,
  deepSeekImageRequestPricing,
  resolveRequestImageMaxBytes,
  resolveRequestImageTarget,
} from './request-pricing.ts'
export { deepSeekImageTokens, deepSeekRequestImageDimensions } from './image-tokens.ts'
export { DeepSeekFileStore, MAX_IMAGE_BYTES } from './file-store.ts'
export type { DeepSeekFileConnection, DeepSeekFilePolicy, DeepSeekFileReference } from './file-store.ts'
export { DeepSeekFilesClient, MAX_FILE_EXPIRY_SECONDS, MAX_FILE_UPLOAD_BYTES, MAX_STORED_FILE_BYTES, MAX_STORED_FILE_COUNT, MIN_FILE_EXPIRY_SECONDS } from './files-api.ts'
export type { DeepSeekFileObject, DeepSeekFilePage } from './files-api.ts'
export { DeepSeekFileId } from './file-id.ts'
export type { DeepSeekFileId as DeepSeekFileIdType } from './file-id.ts'
export { DeepSeekUploadIndex, deepSeekFileScope } from './upload-index.ts'
export type { DeepSeekUploadRecord } from './upload-index.ts'
export type { RequestDefaults } from './types.ts'

export const name = 'llm-deepseek'
export const inject = ['llm']

const NS = 'llm-deepseek'
const PROVIDER = 'deepseek-official'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Reports the endpoint and non-secret authentication identity selected for one DeepSeek Messages wire request.
     * @param identity - request facts selected immediately before the model fetch.
     * @mode emit
     */
    'llm-deepseek/request-identity'(identity: DeepSeekRequestIdentity): void
  }
}

export function apply(ctx: Context, config: Config): void {
  const settingsNs = ctx.fiber.entry?.options.id ?? NS
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    const migrateLegacyModels = async (): Promise<void> => {
      const section = child.settings.describe().find(item => item.ns === settingsNs)
      const user = section?.user
      const storedModels = user !== null && typeof user === 'object' && !Array.isArray(user) && 'models' in user
        ? user.models : undefined
      if (section !== undefined && isLegacyDefaultModels(storedModels)) {
        await child.settings.mutate(settingsNs, [{ op: 'unset', path: ['models'] }], section.revision)
      } else if (section !== undefined && hasLegacyFlashWithoutCurrent(storedModels)) {
        await child.settings.mutate(settingsNs, [{ op: 'set', path: ['models'], value: [...DEFAULT_MODELS, ...storedModels] }], section.revision)
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
  const options = (): ResolvedDeepSeekOptions => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))
  options()

  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepseek', ref)
    } else {
      // Without the seam there is no managed store to rank against, so the
      // environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-deepseek', ref)
      }
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()
  const adapter = new DeepSeekAdapter({
    options,
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(`llm-deepseek: unusable Messages replay state on assistant history for route "${provider}/${model}"; sending provider-neutral content (${reason})`)
    },
    onRequestIdentity: (identity) => { ctx.emit('llm-deepseek/request-identity', identity) },
    resolveApiKey,
    resolveAccountToken: connection => ctx.get('deepseekAccount')?.resolveToken(connection.baseURL) ?? Promise.resolve(undefined),
    resolveUserId,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    prepareExtensions: (request) => {
      const extensions = ctx.get('deepseekLlmApiExtensions')
      return extensions?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
    },
  })
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'DeepSeek', settingsNs: ctx.fiber.entry?.options.id ?? NS, settingsPath: [] },
  ])
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below.
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    let policy: ResolvedDeepSeekOptions['retryPolicy']
    try {
      policy = options().retryPolicy
    } catch (error) {
      // A stored config the resolver refuses keeps the current registration; each request fails on its own resolve.
      ctx.logger.warn(error)
      return
    }
    if (deepEqualJson(policy, registeredPolicy)) return
    // The registry captures the retry policy at registration, so it is the one
    // fact per-request resolution cannot refresh. `replace` re-reads it in one
    // synchronous registry section: disposing and re-registering instead would
    // publish an empty route set between the two, and an observer that reacted
    // to it would see this provider disappear and come back.
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  ctx.on('loader/volatile-update', ensureRegistrationFacts)
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
