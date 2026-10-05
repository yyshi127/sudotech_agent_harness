/** Persisted operator controls for already-open Chrome and Edge tabs. @module */

import { Service, type Context, type Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import type { ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection'
import { openNativeBrowserSettings } from './native-settings-open.ts'
import type {
  NativeBrowser, NativeBrowserControlStatus, NativeBrowserInstallation, NativeBrowserSettingsRuntime, NativeBrowserSettingsService,
} from './native-settings-types.ts'

/** Operator permissions live in this plugin's profile entry. */
export interface Config {
  /** Allow native tasks to use already-open Edge tabs. */
  edge: Volatile<boolean>
  /** Allow native tasks to use already-open Chrome tabs. */
  chrome: Volatile<boolean>
  /** Deadline for opening and verifying the browser's own settings page, in milliseconds. */
  openSettingsTimeoutMs: number
}

function parseBrowser(payload: unknown): { browser: NativeBrowser; enabled: boolean } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError('Invalid browser settings request')
  const row = payload as Record<string, unknown>
  if (row.browser !== 'edge' && row.browser !== 'chrome'
    || Object.keys(row).some(key => key !== 'browser' && key !== 'enabled')
    || typeof row.enabled !== 'boolean') throw new TypeError('Invalid browser settings request')
  return { browser: row.browser, enabled: row.enabled }
}

function parseSettingsBrowser(payload: unknown): NativeBrowser {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError('Invalid browser settings request')
  const row = payload as Record<string, unknown>
  if ((row.browser !== 'edge' && row.browser !== 'chrome') || Object.keys(row).length !== 1) {
    throw new TypeError('Invalid browser settings request')
  }
  return row.browser
}

/** Owns persisted permissions and sanitized settings RPC; chat Agents own all actual connections. */
export default class NativeBrowserSettings extends Service implements NativeBrowserSettingsService {
  static inject = ['connection', 'settings']
  static Config = Schema.object({
    edge: Schema.boolean().default(false).volatile(),
    chrome: Schema.boolean().default(false).volatile(),
    openSettingsTimeoutMs: Schema.number().step(1).min(1).max(2_147_483_647).default(30_000),
  })

  private runtime: NativeBrowserSettingsRuntime | undefined
  private readonly lifetime = new AbortController()
  private readonly entryId: string | undefined
  private readonly closing = new Map<NativeBrowser, Promise<void>>()
  private readonly observed = new Map<NativeBrowser, boolean>()
  private readonly revocations = new Map<NativeBrowser, Promise<void>>()
  private readonly mutations = new Map<NativeBrowser, Promise<void>>()
  private opening: Promise<void> | undefined

  /**
   * @param ctx - profile-owned Settings and authenticated Connection services.
   * @param config - live persisted permissions, disabled on a new installation.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'xiaojingNativeBrowserSettings')
    this.entryId = ctx.fiber.entry?.options.id
    for (const browser of ['edge', 'chrome'] as const) this.observed.set(browser, this.enabled(browser))
    ctx.effect(() => ctx.connection.rpc.handle('/xiaojing-native-browser-control',
      (endpoint, payload, signal) => this.handleRpc(endpoint, payload, signal)), 'native browser settings RPC')
    ctx.on('loader/volatile-update', () => { this.observePermissions() })
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Native browser settings disposed'))
      await Promise.allSettled([
        ...this.mutations.values(), ...this.closing.values(), ...(this.opening === undefined ? [] : [this.opening]),
      ])
    }, 'native browser settings lifecycle')
  }

  enabled(browser: NativeBrowser): boolean { return this.config[browser].get() }

  registerRuntime(runtime: NativeBrowserSettingsRuntime): () => void {
    this.lifetime.signal.throwIfAborted()
    if (this.runtime !== undefined) throw new Error('Native browser runtime is already registered')
    this.runtime = runtime
    return () => { if (this.runtime === runtime) this.runtime = undefined }
  }

  private requireRuntime(): NativeBrowserSettingsRuntime {
    this.lifetime.signal.throwIfAborted()
    if (this.runtime === undefined) throw new Error('Native browser control is unavailable')
    return this.runtime
  }

  private revoke(browser: NativeBrowser): Promise<void> {
    const current = this.closing.get(browser)
    if (current !== undefined) return current
    const runtime = this.runtime
    if (runtime === undefined) return Promise.resolve()
    const task = runtime.revoke(browser).finally(() => { this.closing.delete(browser) })
    this.closing.set(browser, task)
    return task
  }

  private observePermissions(): void {
    for (const browser of ['edge', 'chrome'] as const) {
      const before = this.observed.get(browser)
      const enabled = this.enabled(browser)
      this.observed.set(browser, enabled)
      if (enabled) this.revocations.delete(browser)
      else if (before) {
        const task = this.revoke(browser)
        this.revocations.set(browser, task)
        void task.catch((error: unknown) => { this.ctx.logger.warn(error) })
      }
    }
  }

  private mutate(browser: NativeBrowser, operation: () => Promise<void>): Promise<void> {
    const previous = this.mutations.get(browser) ?? Promise.resolve()
    const task = previous.catch((_error: unknown) => {
      // A failed request does not reject an independently requested edit.
    }).then(() => {
      this.lifetime.signal.throwIfAborted()
      return operation()
    }).finally(() => { if (this.mutations.get(browser) === task) this.mutations.delete(browser) })
    this.mutations.set(browser, task)
    return task
  }

  private async status(signal: AbortSignal): Promise<NativeBrowserControlStatus> {
    const runtime = this.requireRuntime()
    const browsers = await Promise.all((['chrome', 'edge'] as const).map(async (browser) => {
      let installation: NativeBrowserInstallation
      try { installation = await runtime.inspect(browser, signal) }
      catch (error) {
        signal.throwIfAborted()
        const enabled = this.enabled(browser)
        return {
          browser, installed: null, enabled, setupReady: false,
          state: !enabled ? 'disabled' as const : runtime.state(browser) ?? 'disconnected' as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
      signal.throwIfAborted()
      const enabled = this.enabled(browser)
      const live = runtime.state(browser)
      return {
        browser, installed: installation.installed, enabled, setupReady: installation.setupReady,
        state: !enabled ? 'disabled' as const : live ?? (installation.setupReady ? 'ready' as const : 'setup-required' as const),
      }
    }))
    signal.throwIfAborted()
    return { canOpenSettings: process.platform === 'win32', browsers }
  }

  private async handleRpc(endpoint: string, payload: unknown, requestSignal: AbortSignal): Promise<ConnectionRpcHandlerResult> {
    const signal = AbortSignal.any([requestSignal, this.lifetime.signal])
    try {
      switch (endpoint) {
        case 'status':
          if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || Object.keys(payload).length !== 0) {
            throw new TypeError('Invalid browser settings request')
          }
          break
        case 'open-settings': {
          const browser = parseSettingsBrowser(payload)
          if (this.opening !== undefined) throw new Error('A browser settings page is already opening')
          const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.config.openSettingsTimeoutMs)])
          const opening = (async () => {
            const installation = await this.requireRuntime().inspect(browser, deadline)
            deadline.throwIfAborted()
            if (!installation.installed || installation.executablePath === undefined) throw new Error(`${browser} is not installed`)
            await openNativeBrowserSettings(browser, installation.executablePath, this.config.openSettingsTimeoutMs, deadline)
          })()
          this.opening = opening
          try { await opening }
          finally { if (this.opening === opening) this.opening = undefined }
          break
        }
        case 'set-enabled': {
          const { browser, enabled } = parseBrowser(payload)
          const entryId = this.entryId
          if (entryId === undefined) throw new Error('Browser settings require a profile entry')
          await this.mutate(browser, async () => {
            signal.throwIfAborted()
            const installation = enabled ? await this.requireRuntime().inspect(browser, signal) : undefined
            if (installation !== undefined && !installation.installed) throw new Error(`${browser} is not installed`)
            signal.throwIfAborted()
            await this.ctx.settings.update(entryId, { [browser]: enabled })
            this.observePermissions()
            if (!enabled) await this.revocations.get(browser)
          })
          break
        }
        default: throw new Error('Unknown browser settings operation')
      }
      return { ok: true, value: await this.status(signal) }
    } catch (error) {
      return { ok: false, error: {
        code: 'xiaojing-browser/settings', message: error instanceof Error ? error.message : String(error), details: {},
      } }
    }
  }
}
