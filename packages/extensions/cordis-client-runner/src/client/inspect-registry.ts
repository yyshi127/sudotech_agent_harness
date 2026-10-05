/** Browser registry for read-only Cordis capability providers. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  CordisInspectProviderManifest, CordisInspectQueryRequest, CordisInspectQueryResolution,
  CordisInspectRequestId, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Context supplied to a Client inspect provider query. */
export interface ClientCordisInspectQueryContext {
  /** Cancellation broadcast by the Host. */
  signal: AbortSignal
  /** Session whose model requested the query. */
  sessionId: SessionId
}

/** Client provider registration retained beside its serializable manifest. */
export interface ClientCordisInspectProviderRegistration {
  /** Provider and explicit query directory. */
  manifest: CordisInspectProviderManifest
  /** Execute one declared read-only method. */
  query(method: string, input: JsonValue | undefined, context: ClientCordisInspectQueryContext): Promise<JsonValue>
}

/** Remote operations needed by the Client registry. */
export interface ClientCordisInspectHost {
  /** Replace the Host's mirrored Client manifest. */
  sync(providers: readonly CordisInspectProviderManifest[]): Promise<void>
  /** Submit one query result; the first accepted page wins. */
  resolve(
    sessionId: SessionId,
    requestId: CordisInspectRequestId,
    resolution: CordisInspectQueryResolution,
  ): Promise<void>
}

/** Client provider registry, manifest publisher, and live query dispatcher. */
export class ClientCordisInspectRegistry {
  private readonly providers = new Map<string, ClientCordisInspectProviderRegistration>()
  private readonly active = new Map<CordisInspectRequestId, AbortController>()
  private readonly pendingQueries = new Set<Promise<void>>()
  private disposed = false
  private publishQueued = false
  private syncChain = Promise.resolve()

  /** @param host - folded manifest and query result transport. */
  constructor(private readonly host: ClientCordisInspectHost) {}

  /**
   * Register one Client provider and publish a new complete manifest.
   * @param registration - provider manifest and local handler.
   * @returns idempotent disposer.
   * @throws when closed, when the provider id is empty or registered, or when method names repeat.
   */
  register(registration: ClientCordisInspectProviderRegistration): () => void {
    if (this.disposed) throw new Error('Client Cordis inspect registry is disposed')
    const { manifest } = registration
    if (manifest.id.trim() === '') throw new Error('Client Cordis inspect provider id must not be empty')
    if (this.providers.has(manifest.id)) throw new Error(`Client Cordis inspect provider "${manifest.id}" is already registered`)
    const names = new Set<string>()
    for (const method of manifest.methods) {
      if (names.has(method.name)) throw new Error(`Client Cordis inspect provider "${manifest.id}" repeats method "${method.name}"`)
      names.add(method.name)
    }
    this.providers.set(manifest.id, registration)
    this.publish()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.providers.get(manifest.id) === registration) {
        this.providers.delete(manifest.id)
        this.publish()
      }
    }
  }

  /** Publish the current complete manifest, including after reconnect; closed registries ignore publication. */
  publish(): void {
    if (this.disposed || this.publishQueued) return
    this.publishQueued = true
    queueMicrotask(() => {
      this.publishQueued = false
      if (this.disposed) return
      const manifests = [...this.providers.values()].map(provider => provider.manifest)
      this.syncChain = this.syncChain.then(async () => {
        if (this.disposed) return
        await this.host.sync(manifests)
      }).catch((error: unknown) => {
        console.error('[cordis-client-runner] syncing inspect providers failed:', error)
      })
    })
  }

  /**
   * Execute and answer one Host-broadcast query.
   * @param request - exact provider query and Session correlation received from Host.
   * @returns after this query settles; closed registries accept no new query.
   */
  query(request: CordisInspectQueryRequest): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const pending = this.runQuery(request)
    this.pendingQueries.add(pending)
    void pending.then(
      () => { this.pendingQueries.delete(pending) },
      () => { this.pendingQueries.delete(pending) },
    )
    return pending
  }

  private async runQuery(request: CordisInspectQueryRequest): Promise<void> {
    if (this.active.has(request.requestId)) return
    const controller = new AbortController()
    this.active.set(request.requestId, controller)
    let resolution: CordisInspectQueryResolution
    try {
      const provider = this.providers.get(request.provider)
      if (provider === undefined) {
        resolution = { ok: false, reason: 'provider-missing', message: `Client inspect provider "${request.provider}" is unavailable` }
      } else if (!provider.manifest.methods.some(method => method.name === request.method)) {
        resolution = { ok: false, reason: 'method-missing', message: `Client inspect provider "${request.provider}" has no method "${request.method}"` }
      } else {
        const data = await provider.query(request.method, request.input, {
          signal: controller.signal,
          sessionId: request.agentId,
        })
        resolution = controller.signal.aborted
          ? { ok: false, reason: 'cancelled', message: 'Client inspect query was cancelled' }
          : { ok: true, data }
      }
    } catch (error) {
      resolution = controller.signal.aborted
        ? { ok: false, reason: 'cancelled', message: 'Client inspect query was cancelled' }
        : { ok: false, reason: 'provider-error', message: error instanceof Error ? error.message : String(error) }
    } finally {
      this.active.delete(request.requestId)
    }
    if (controller.signal.aborted) return
    await this.host.resolve(request.agentId, request.requestId, resolution)
  }

  /**
   * Cancel local work after another page answered or the Tool call ended.
   * @param requestId - query correlation that is no longer answerable.
   */
  close(requestId: CordisInspectRequestId): void {
    this.active.get(requestId)?.abort()
    this.active.delete(requestId)
  }

  /**
   * Stop manifest publication, cancel queries, and join their transport work.
   * Provider handlers must settle after cancellation for disposal to complete.
   * @returns after started publications and queries, including result delivery, settle.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this.providers.clear()
    for (const controller of this.active.values()) controller.abort()
    this.active.clear()
    await Promise.allSettled([this.syncChain, ...this.pendingQueries])
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser registry for pre-definition Cordis capability discovery. */
    cordisInspect: ClientCordisInspectRegistry
  }
}

/**
 * Provide the registry as a normal Client service.
 * @param ctx - Client Cordis context receiving the service.
 * @param registry - page-local inspect registry to publish.
 */
export function provideClientCordisInspect(ctx: Context, registry: ClientCordisInspectRegistry): void {
  ctx.provide('cordisInspect', registry)
}
