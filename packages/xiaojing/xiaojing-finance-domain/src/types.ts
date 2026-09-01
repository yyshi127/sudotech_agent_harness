/** Client-record and immutable session-context types for the Xiaojing Finance domain. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one locally maintained taxpayer entity. */
export type FinanceClientId = Branded<'FinanceClientId'>

/** Workspace identity returned by the Finance Remote; structurally matches the Harness Workspace id. */
export type FinanceWorkspaceId = Branded<'WorkspaceId'>

/** Stable identity of one file committed by the Finance file lifecycle. */
export type FinanceManagedFileId = Branded<'FinanceManagedFileId'>

/**
 * Brand a stored client identifier.
 * @param value - Raw UUID-backed identifier.
 * @returns Branded client identifier.
 */
export function FinanceClientId(value: string): FinanceClientId {
  return value as FinanceClientId
}

/**
 * Brand a persisted Finance file identifier.
 * @param value - Raw UUID-backed identifier.
 * @returns Branded managed-file identifier.
 */
export function FinanceManagedFileId(value: string): FinanceManagedFileId {
  return value as FinanceManagedFileId
}

/** Supported taxpayer classifications in the first local-record schema. */
export type FinanceTaxpayerType = 'general-vat' | 'small-scale-vat' | 'other'

/** Supported accounting standards in the first local-record schema. */
export type FinanceAccountingStandard = 'enterprise' | 'small-enterprise' | 'government' | 'nonprofit' | 'other'

/** One local-to-external account-code association. */
export interface FinanceChartMapping {
  /** Account code used in Xiaojing's local client policy. */
  localAccountCode: string
  /** Corresponding account code in the referenced accounting system. */
  externalAccountCode: string
}

/** Non-secret identifiers for one external finance system. */
export interface FinanceExternalSystemRef {
  /** Supported external product. */
  system: 'youcheng' | 'sdoo'
  /** External tenant identifier, when applicable. */
  tenantId?: string
  /** External company identifier, when applicable. */
  companyId?: string
  /** External account-set identifier, when applicable. */
  accountSetId?: string
}

/** User-editable client fields. */
export interface FinanceClientDraft {
  /** Registered legal entity name. */
  legalName: string
  /** Optional short display name. */
  shortName?: string
  /** Optional unified social credit code. */
  unifiedSocialCreditCode?: string
  /** Taxpayer classification. */
  taxpayerType: FinanceTaxpayerType
  /** Registered province/city or comparable jurisdiction text. */
  registeredRegion: string
  /** Accounting standard used by the entity. */
  accountingStandard: FinanceAccountingStandard
  /** Optional industry description. */
  industry?: string
  /** Optional client-specific finance policy notes. */
  financePolicyNotes?: string
  /** Account-code mappings used by later finance connectors. */
  chartMappings: FinanceChartMapping[]
  /** Non-secret external-system references used by later connectors. */
  externalSystemRefs: FinanceExternalSystemRef[]
}

/** Durable local client record. */
export interface FinanceClientRecord extends FinanceClientDraft {
  /** Stable record identity. */
  id: FinanceClientId
  /** Record-local version copied into immutable session bindings. */
  version: number
  /** Whether new sessions may bind the record. */
  status: 'active' | 'archived'
  /** Canonical directory dedicated to this client. */
  workspacePath: string
  /** Creation time as Unix epoch milliseconds. */
  createdAt: number
  /** Last mutation time as Unix epoch milliseconds. */
  updatedAt: number
  /** Archive time as Unix epoch milliseconds. */
  archivedAt?: number
}

/** Immutable client fields copied into one Finance session. */
export type FinanceClientSnapshot = Readonly<FinanceClientDraft & { id: FinanceClientId }>

/** Durable event payload fixing one client snapshot to one Finance session. */
export interface FinanceClientBinding {
  /** Binding payload schema version. */
  schemaVersion: 1
  /** Version of the client record at binding time. */
  clientVersion: number
  /** Immutable client snapshot. */
  client: FinanceClientSnapshot
  /** Immutable client Workspace directory used by historical sessions. */
  workspacePath: string
}

/** Safe session projection exposed to browser clients. */
export type FinanceClientProjection =
  | { state: 'unbound' }
  | { state: 'bound'; clientName: string }

/** Internal projection state retaining the immutable binding. */
export type FinanceClientProjectionState =
  | { state: 'unbound' }
  | { state: 'bound'; binding: FinanceClientBinding }

/** Safe row returned by the customer-list Remote. */
export interface FinanceClientSummary {
  /** Client identity. */
  id: FinanceClientId
  /** Legal name. */
  legalName: string
  /** Short name when one is configured. */
  shortName?: string
  /** Taxpayer classification. */
  taxpayerType: FinanceTaxpayerType
  /** Registered region. */
  registeredRegion: string
  /** Accounting standard. */
  accountingStandard: FinanceAccountingStandard
  /** Record version. */
  version: number
  /** Record lifecycle state. */
  status: 'active' | 'archived'
}

/** Current client catalog and its compare-and-swap revision. */
export interface FinanceClientListView {
  /** Whole-file revision expected by the next mutation. */
  revision: number
  /** Client summaries in creation order. */
  clients: FinanceClientSummary[]
}

/** Fields shared by generated Finance Workspaces. */
interface FinanceWorkspaceBase {
  /** Harness Workspace identity used to create or open sessions. */
  workspaceId: FinanceWorkspaceId
  /** Sidebar display title. */
  title: string
  /** Whether the workspace may create a new session. */
  startable: boolean
}

/** Fixed standard-consultation Workspace owned by Finance. */
export type FinanceStandardWorkspaceEntry = FinanceWorkspaceBase & { kind: 'standard' }

/** One user-selected consultation Workspace owned by Finance. */
export type FinanceConsultationWorkspaceEntry = FinanceWorkspaceBase & { kind: 'consultation' }

/** One standard or user-selected Workspace available to general Finance consultation. */
export type FinanceGeneralWorkspaceEntry = FinanceStandardWorkspaceEntry | FinanceConsultationWorkspaceEntry

/** One customer Workspace owned by Finance. */
export type FinanceClientWorkspaceEntry = FinanceWorkspaceBase & {
  kind: 'client'
  clientId: FinanceClientId
}

/** One generated Workspace owned by the Finance module. */
export type FinanceWorkspaceEntry =
  | FinanceStandardWorkspaceEntry
  | FinanceConsultationWorkspaceEntry
  | FinanceClientWorkspaceEntry

/** Browser-safe Finance workspace registry projection. */
export interface FinanceWorkspaceListView {
  /** Fixed standard-consultation workspace. */
  standard: FinanceStandardWorkspaceEntry
  /** User-selected consultation workspaces. */
  consultations: FinanceConsultationWorkspaceEntry[]
  /** Customer workspaces in customer-catalog order. */
  clients: FinanceClientWorkspaceEntry[]
  /** Finance workspaces currently shown in the sidebar and conversation picker. */
  listedWorkspaceIds: FinanceWorkspaceId[]
}

/** Full loopback-only client detail plus catalog revision. */
export interface FinanceClientReadView {
  /** Whole-file revision expected by the next mutation. */
  revision: number
  /** Complete local client record. */
  client: FinanceClientRecord
}

/** Create request guarded by the catalog revision. */
export interface CreateFinanceClientRequest {
  /** Revision observed by the editing window. */
  expectedRevision: number
  /** New client fields. */
  client: FinanceClientDraft
  /** Host directory selected for this client. */
  workspacePath: string
}

/** Add one user-selected consultation Workspace. */
export interface AddFinanceConsultationWorkspaceRequest {
  /** Host directory selected for Finance consultation work. */
  path: string
}

/** Rename one Finance-owned Workspace without changing its directory or client record. */
export interface RenameFinanceWorkspaceRequest {
  /** Workspace selected in the Finance sidebar. */
  workspaceId: FinanceWorkspaceId
  /** New sidebar title. */
  title: string
}

/** Remove one Finance-owned Workspace from product lists without deleting durable data. */
export interface RemoveFinanceWorkspaceRequest {
  /** Workspace selected in the Finance sidebar. */
  workspaceId: FinanceWorkspaceId
}

/** Reconnect an existing client Workspace selected through the folder picker. */
export interface RestoreFinanceClientWorkspaceRequest {
  /** Existing client Workspace directory. */
  path: string
}

/** Whole-record update guarded by the catalog revision. */
export interface UpdateFinanceClientRequest {
  /** Client to replace. */
  clientId: FinanceClientId
  /** Revision observed by the editing window. */
  expectedRevision: number
  /** Replacement editable fields. */
  client: FinanceClientDraft
}

/** Archive request guarded by the catalog revision. */
export interface ArchiveFinanceClientRequest {
  /** Client to archive. */
  clientId: FinanceClientId
  /** Revision observed by the editing window. */
  expectedRevision: number
}

/** Result of a create, update, or archive mutation. */
export interface FinanceClientMutationResult {
  /** New whole-file revision. */
  revision: number
  /** Created or changed record. */
  client: FinanceClientRecord
}

/** Pre-first-turn Finance context selection. */
export type StageFinanceClientRequest =
  | { mode: 'general' }
  | { mode: 'client'; clientId: FinanceClientId }

/** Finance session context shown by the local Client UI. */
export type FinanceSessionContextView =
  | { state: 'not-finance'; locked: true }
  | { state: 'general'; locked: false }
  | { state: 'ready'; locked: false; clientId: FinanceClientId; clientName: string }
  | { state: 'bound'; locked: true; clientName: string }

/** Finance-owned destination class for a managed file. */
export type FinanceFileStage = 'source' | 'output' | 'archive'

/** Operation that committed a file into a Finance-owned directory. */
export type FinanceFileAction = 'import' | 'publish' | 'archive'

/** Durable audit record for one immutable file copy. */
export interface FinanceManagedFile {
  /** Stable record identity. */
  id: FinanceManagedFileId
  /** Client that owns the destination directory. */
  clientId: FinanceClientId
  /** Session that requested the copy. */
  sessionId: string
  /** Lifecycle operation that created the record. */
  action: FinanceFileAction
  /** Finance-owned destination class. */
  stage: FinanceFileStage
  /** Final absolute path inside the bound client workspace. */
  path: string
  /** Final basename shown to users and the model. */
  name: string
  /** Lowercase SHA-256 digest of the committed bytes. */
  sha256: string
  /** Committed byte length. */
  size: number
  /** Commit time as Unix epoch milliseconds. */
  createdAt: number
  /** Prior managed record when the source was committed by this lifecycle. */
  sourceFileId?: FinanceManagedFileId
}

/** Durable record authorizing one uploaded file for a general Finance consultation session. */
export interface FinanceConsultationFile {
  /** Stable record identity. */
  id: FinanceManagedFileId
  /** Consultation session that owns this upload. */
  sessionId: string
  /** Canonical absolute path inside the local upload directory. */
  path: string
  /** Browser filename shown to users and the model. */
  name: string
  /** Lowercase SHA-256 digest recorded at registration. */
  sha256: string
  /** Registered byte length. */
  size: number
  /** Registration time as Unix epoch milliseconds. */
  createdAt: number
}

/** Upload result returned to the local Client for either Finance context. */
export type FinanceImportedFile = FinanceManagedFile | FinanceConsultationFile

/** Upload handoff accepted only from the configured local upload directory. */
export interface ImportFinanceUploadRequest {
  /** Absolute path returned by the local upload service. */
  path: string
  /** User-facing filename supplied by the browser. */
  originalName: string
}

/** Commit one completed session-work file as a formal client deliverable. */
export interface PublishFinanceFileRequest {
  /** Absolute path inside this session's `03-会话作业` directory. */
  sourcePath: string
  /** Optional basename for the committed deliverable. */
  preferredName?: string
}

/** Copy one managed client file into the client archive. */
export interface ArchiveFinanceFileRequest {
  /** Absolute source path in `02-原始资料`, this session's work directory, or `04-成果输出`. */
  sourcePath: string
  /** Optional basename for the archived copy. */
  preferredName?: string
}

/** Session-log payload proving one Finance file lifecycle commit. */
export interface FinanceFileCommittedEvent {
  /** Event payload schema version. */
  schemaVersion: 1
  /** Immutable committed-file record. */
  file: FinanceManagedFile
}

/** Session-log payload authorizing one general-consultation upload. */
export interface FinanceConsultationFileImportedEvent {
  /** Event payload schema version. */
  schemaVersion: 1
  /** Immutable session-scoped upload record. */
  file: FinanceConsultationFile
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Immutable client selection written before the first model request. */
    'finance/client-bound': FinanceClientBinding
    /**
     * Local upload copied into the bound client's original-materials directory.
     * @param data - Immutable import record.
     */
    'finance/file-imported': FinanceFileCommittedEvent
    /**
     * Local upload registered for one general Finance consultation session.
     * @param data - Immutable session-scoped upload record.
     */
    'finance/consultation-file-imported': FinanceConsultationFileImportedEvent
    /**
     * Session work copied into the bound client's formal-output directory.
     * @param data - Immutable publication record.
     */
    'finance/file-published': FinanceFileCommittedEvent
    /**
     * Managed client material copied into the bound client's archive directory.
     * @param data - Immutable archive record.
     */
    'finance/file-archived': FinanceFileCommittedEvent
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host projection of the immutable Finance client binding. */
    financeClient: FinanceClientProjectionState
  }
  interface SessionProjectionMap {
    /** Browser-safe Finance client label. */
    financeClient: FinanceClientProjection
  }
}
