/** Browser object layer for Finance client records and pre-turn context staging. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AddFinanceConsultationWorkspaceRequest,
  ArchiveFinanceClientRequest,
  CreateFinanceClientRequest,
  FinanceClientListView,
  FinanceClientMutationResult,
  FinanceClientReadView,
  FinanceConnectionStatus,
  FinanceYouchengAccountsResult,
  ListFinanceYouchengAccountsRequest,
  FinanceClientId,
  FinanceImportedFile,
  FinanceGeneralWorkspaceEntry,
  FinanceSessionContextView,
  FinanceWorkspaceEntry,
  FinanceWorkspaceId,
  FinanceWorkspaceListView,
  RemoveFinanceWorkspaceRequest,
  RenameFinanceWorkspaceRequest,
  RestoreFinanceClientWorkspaceRequest,
  ImportFinanceUploadRequest,
  StageFinanceClientRequest,
  UpdateFinanceClientRequest,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'

/** Generated Finance Remote subset consumed by this presentation plugin. */
export interface FinanceClientsRemote {
  list: () => Promise<RemoteResult<FinanceClientListView>>
  workspaces: () => Promise<RemoteResult<FinanceWorkspaceListView>>
  addConsultationWorkspace: (
    request: AddFinanceConsultationWorkspaceRequest,
  ) => Promise<RemoteResult<FinanceGeneralWorkspaceEntry>>
  renameWorkspace: (request: RenameFinanceWorkspaceRequest) => Promise<RemoteResult<FinanceWorkspaceEntry>>
  removeWorkspace: (request: RemoveFinanceWorkspaceRequest) => Promise<RemoteResult<FinanceWorkspaceEntry>>
  restoreClientWorkspace: (
    request: RestoreFinanceClientWorkspaceRequest,
  ) => Promise<RemoteResult<FinanceWorkspaceEntry | null>>
  read: (clientId: FinanceClientId) => Promise<RemoteResult<FinanceClientReadView>>
  checkConnection: (clientId: FinanceClientId) => Promise<RemoteResult<FinanceConnectionStatus>>
  listYouchengAccounts: (request: ListFinanceYouchengAccountsRequest) => Promise<RemoteResult<FinanceYouchengAccountsResult>>
  create: (request: CreateFinanceClientRequest) => Promise<RemoteResult<FinanceClientMutationResult>>
  update: (request: UpdateFinanceClientRequest) => Promise<RemoteResult<FinanceClientMutationResult>>
  archive: (request: ArchiveFinanceClientRequest) => Promise<RemoteResult<FinanceClientMutationResult>>
  stage: (sessionId: SessionId, request: StageFinanceClientRequest) => Promise<RemoteResult<FinanceSessionContextView>>
  sessionContext: (sessionId: SessionId) => Promise<RemoteResult<FinanceSessionContextView>>
  importUpload: (
    sessionId: SessionId,
    request: ImportFinanceUploadRequest,
  ) => Promise<RemoteResult<FinanceImportedFile>>
}

/** Observable Finance client catalog state. */
export interface FinanceClientsView {
  status: 'idle' | 'loading' | 'ready' | 'error'
  catalog: FinanceClientListView
  workspaces: FinanceWorkspaceListView | null
  error: string | null
  /** Selected directory awaiting customer details in the product-owned modal. */
  clientCreation: { workspacePath: string } | null
  /** Customer currently opened from the workspace action menu. */
  clientEditing?: FinanceClientId | null
  /** Monotonic signal requiring blank-session context to be re-read from Host. */
  contextEpoch: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** A local check belongs to one saved record version and one Host connection lifetime. */
interface ConnectionAttempt {
  version: number | undefined
  pending: boolean
  status: FinanceConnectionStatus
}

/** Shared client-catalog controller with revision-safe writes. */
export class FinanceClientsController {
  /** Catalog snapshot consumed by settings and the Finance hero selector. */
  readonly store: SnapshotStore<FinanceClientsView> = createSnapshotStore({
    status: 'idle', catalog: { revision: 0, clients: [] }, workspaces: null, error: null,
    clientCreation: null, clientEditing: null, contextEpoch: 0,
  })

  private generation = 0
  private readonly connectionAttempts = new Map<FinanceClientId, ConnectionAttempt>()
  private clientCreationResolver: ((clientId: FinanceClientId | undefined) => void) | undefined

  /** @param remote - generated Finance Host Remote. */
  constructor(private readonly remote: FinanceClientsRemote) {}

  /** Refresh the catalog; the newest request wins. */
  async load(): Promise<void> {
    const generation = ++this.generation
    const attemptsAtStart = new Map(this.connectionAttempts)
    const pendingAtStart = new Set([...attemptsAtStart.values()].filter(attempt => attempt.pending))
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const [catalog, workspaces] = await Promise.all([
        this.remote.list().then(result => unwrap(result)),
        this.remote.workspaces().then(result => unwrap(result)),
      ])
      if (generation !== this.generation) return
      for (const [id, attempt] of this.connectionAttempts) {
        if (catalog.clients.find(client => client.id === id)?.version !== attempt.version) {
          this.connectionAttempts.delete(id)
        }
      }
      const clients = workspaces.clients.map((entry) => {
        const attempt = this.connectionAttempts.get(entry.clientId)
        // A list sampled during a check must not restore its earlier idle/checking status.
        return attempt !== undefined && (attempt.pending || pendingAtStart.has(attempt)
          || attemptsAtStart.get(entry.clientId) !== attempt)
          ? { ...entry, connection: attempt.status } : entry
      })
      this.store.update((state) => {
        state.status = 'ready'
        state.catalog = catalog
        state.workspaces = { ...workspaces, clients }
        state.error = null
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => { state.status = 'error'; state.error = messageOf(error) })
    }
  }

  /**
   * Read complete loopback-only client detail.
   * @param clientId - Client identity.
   * @returns Full client record.
   */
  async read(clientId: FinanceClientId): Promise<FinanceClientReadView> {
    return unwrap(await this.remote.read(clientId))
  }

  /**
   * Discover ledger choices without committing the editor or changing connection badges.
   * @param request - Unsaved connection fields and the customer owning any stored secret.
   * @returns Vendor ledger choices or a sanitized failure.
   */
  async listYouchengAccounts(request: ListFinanceYouchengAccountsRequest): Promise<FinanceYouchengAccountsResult> {
    return unwrap(await this.remote.listYouchengAccounts(request))
  }

  /**
   * Create a record, then refresh the catalog.
   * @param request - Revision-guarded client fields.
   * @returns Created record and new catalog revision.
   */
  async create(request: CreateFinanceClientRequest): Promise<FinanceClientMutationResult> {
    const result = unwrap(await this.remote.create(request))
    await this.load()
    if (result.client.financeSystem?.system === 'youcheng') await this.checkConnection(result.client.id)
    return result
  }

  /**
   * Register one custom consultation directory and refresh Finance workspaces.
   * @param path - Directory selected by the user.
   * @returns Registered Finance Workspace entry.
   */
  async addConsultationWorkspace(path: string): Promise<FinanceGeneralWorkspaceEntry> {
    const entry = unwrap(await this.remote.addConsultationWorkspace({ path }))
    await this.load()
    return entry
  }

  /**
   * Rename a Finance-owned Workspace and refresh product lists.
   * @param workspaceId - Workspace selected in the Finance sidebar.
   * @param title - New sidebar title.
   */
  async renameWorkspace(workspaceId: FinanceWorkspaceId, title: string): Promise<void> {
    unwrap(await this.remote.renameWorkspace({ workspaceId, title }))
    await this.load()
  }

  /**
   * Remove a Finance-owned Workspace from product lists and refresh state.
   * @param workspaceId - Workspace selected in the Finance sidebar.
   */
  async removeWorkspace(workspaceId: FinanceWorkspaceId): Promise<void> {
    unwrap(await this.remote.removeWorkspace({ workspaceId }))
    await this.load()
  }

  /**
   * Restore an existing client Workspace selected through the folder picker.
   * @param path - Selected existing client directory.
   * @returns Restored entry, or null when the path belongs to no known client.
   */
  async restoreClientWorkspace(path: string): Promise<FinanceWorkspaceEntry | null> {
    const entry = unwrap(await this.remote.restoreClientWorkspace({ path }))
    if (entry !== null) await this.load()
    return entry
  }

  /**
   * Open the customer-details modal for one selected directory.
   * @param workspacePath - Directory selected by the user.
   * @returns Created customer id, or undefined when cancelled.
   */
  beginClientWorkspaceCreation(workspacePath: string): Promise<FinanceClientId | undefined> {
    if (this.clientCreationResolver !== undefined) {
      throw new Error('A customer workspace is already being created')
    }
    this.store.update((state) => { state.clientCreation = { workspacePath } })
    return new Promise((resolve) => { this.clientCreationResolver = resolve })
  }

  /**
   * Open a customer record from the Finance workspace menu.
   * @param clientId - Customer selected in the workspace menu.
   */
  openClientEditor(clientId: FinanceClientId): void {
    this.store.update((state) => { state.clientEditing = clientId })
  }

  /** Close the customer record editor. */
  closeClientEditor(): void {
    this.store.update((state) => { state.clientEditing = null })
  }

  /**
   * Resolve the active customer-creation flow after a successful save.
   * @param clientId - Newly created customer identity.
   */
  completeClientWorkspaceCreation(clientId: FinanceClientId): void {
    this.settleClientWorkspaceCreation(clientId)
  }

  /** Resolve the active customer-creation flow without creating a record. */
  cancelClientWorkspaceCreation(): void {
    this.settleClientWorkspaceCreation(undefined)
  }

  /**
   * Replace a record, then refresh the catalog.
   * @param request - Revision-guarded replacement fields.
   * @returns Updated record and new catalog revision.
   */
  async update(request: UpdateFinanceClientRequest): Promise<FinanceClientMutationResult> {
    const result = unwrap(await this.remote.update(request))
    await this.load()
    if (result.client.financeSystem?.system === 'youcheng') await this.checkConnection(result.client.id)
    return result
  }

  /**
   * Verify saved settings once at a time per client; failures remain retryable status, not save errors.
   * @param clientId - Customer owning the saved settings.
   */
  async checkConnection(clientId: FinanceClientId): Promise<void> {
    if (this.connectionAttempts.get(clientId)?.pending) return
    const entry = this.store.getSnapshot().workspaces?.clients.find(item => item.clientId === clientId)
    const previous = entry?.connection
    const attempt: ConnectionAttempt = {
      version: this.store.getSnapshot().catalog.clients.find(client => client.id === clientId)?.version,
      pending: true,
      status: { accountId: previous?.accountId ?? '', state: 'checking' },
    }
    this.connectionAttempts.set(clientId, attempt)
    const publish = (connection: FinanceConnectionStatus): void => {
      if (this.connectionAttempts.get(clientId) !== attempt) return
      attempt.status = connection
      this.store.update((state) => {
        const target = state.workspaces?.clients.find(item => item.clientId === clientId)
        if (target !== undefined) target.connection = connection
      })
    }
    publish(attempt.status)
    try { publish(unwrap(await this.remote.checkConnection(clientId))) }
    catch { publish({ accountId: previous?.accountId ?? '', state: 'failed', failure: 'network', checkedAt: Date.now() }) }
    finally { attempt.pending = false }
  }

  /**
   * Archive a record, then refresh the catalog.
   * @param request - Revision-guarded archive request.
   * @returns Archived record and new catalog revision.
   */
  async archive(request: ArchiveFinanceClientRequest): Promise<FinanceClientMutationResult> {
    const result = unwrap(await this.remote.archive(request))
    await this.load()
    return result
  }

  /**
   * Read the sanitized current context for one Finance session.
   * @param sessionId - Session identity.
   * @returns Browser-safe Finance context.
   */
  async sessionContext(sessionId: SessionId): Promise<FinanceSessionContextView> {
    return unwrap(await this.remote.sessionContext(sessionId))
  }

  /**
   * Register one completed shared upload in the active Finance context.
   * @param sessionId - Finance session that owns the consultation or selected customer.
   * @param request - Upload-service path and original browser filename.
   * @returns Durable consultation or managed client record.
   */
  async importUpload(
    sessionId: SessionId,
    request: ImportFinanceUploadRequest,
  ): Promise<FinanceImportedFile> {
    const file = unwrap(await this.remote.importUpload(sessionId, request))
    this.store.update((state) => { state.contextEpoch += 1 })
    return file
  }

  /**
   * Stage a selection for one blank Finance session and refresh displayed context after success.
   * @param sessionId - Session identity.
   * @param request - General or client selection.
   * @returns Browser-safe staged context.
   */
  async stage(sessionId: SessionId, request: StageFinanceClientRequest): Promise<FinanceSessionContextView> {
    const context = unwrap(await this.remote.stage(sessionId, request))
    this.store.update((state) => { state.contextEpoch += 1 })
    return context
  }

  /** Invalidate Host-memory staging, connection checks, and pending lists after a connection reset. */
  resetSessionContexts(): void {
    this.generation += 1
    this.connectionAttempts.clear()
    this.store.update((state) => {
      state.contextEpoch += 1
      for (const entry of state.workspaces?.clients ?? []) {
        if (entry.connection !== undefined) {
          entry.connection = { accountId: entry.connection.accountId, state: 'unverified' }
        }
      }
    })
  }

  private settleClientWorkspaceCreation(clientId: FinanceClientId | undefined): void {
    const resolve = this.clientCreationResolver
    this.clientCreationResolver = undefined
    this.store.update((state) => { state.clientCreation = null })
    resolve?.(clientId)
  }
}
