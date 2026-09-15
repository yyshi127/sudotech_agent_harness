# 扩展

[English](extensions.md) | 中文

extensions 子系统允许 agent（智能体）定义带版本的 Cordis 包、运行其 host 与浏览器两半，并在编写代码前查询获准公开的运行时元数据。包生命周期与沙箱行为由 [`packages/extensions`](../../packages/extensions/README.zh.md) 包组说明。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcordisinspect--cordisinspectregistryservice"></a>

### `ctx.cordisInspect` — `CordisInspectRegistryService`

Registry and cross-page router behind the two model-facing inspect tools.

```ts cordis-catalog
/**
 * Register one Host provider.
 * @param registration - manifest and local query handler.
 * @returns idempotent disposer.
 */
register(registration: HostCordisInspectProviderRegistration): () => void

/**
 * Replace the mirrored Client provider directory.
 * @param providers - complete Client manifest snapshot.
 */
syncClientManifest(providers: readonly CordisInspectProviderManifest[]): void

/**
 * Return the complete known Host and Client provider directory.
 * @returns Host providers followed by the Client providers.
 */
list(): CordisInspectProviderView[]

/**
 * Execute one provider query on its owning platform.
 * @param platform - Host or Client runtime.
 * @param providerId - provider selected from {@link list}.
 * @param methodName - declared method name.
 * @param input - optional lossless JSON input.
 * @param agent - requesting Agent and scope.
 * @param signal - tool-call cancellation.
 * @returns provider JSON data.
 */
async query( platform: CordisInspectPlatform, providerId: string, methodName: string, input: JsonValue | undefined, agent: Agent, signal: AbortSignal, ): Promise<JsonValue>

/**
 * Accept the first valid Client response for a pending query.
 * @param agent - Agent whose Session owns the query.
 * @param requestId - Pending Client query identity.
 * @param resolution - Client provider result or failure.
 * @returns whether this response settled the still-pending query.
 */
resolveClientQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck
```

Types: [Agent](core.zh.md)

Source: [`packages/extensions/cordis-host-runner/src/inspect-registry.ts`](../../packages/extensions/cordis-host-runner/src/inspect-registry.ts)

<a id="ctxdynamiccordisrunner--dynamiccordisrunnerservice"></a>

### `ctx.dynamicCordisRunner` — `DynamicCordisRunnerService`

Dynamic Plugin registry and Host-half lifecycle.

```ts cordis-catalog
/**
 * Define a new Plugin's first Package or append a Package to an existing Plugin.
 * @param request - Session ownership, Plugin selection, metadata, and source code.
 * @returns Host-minted Plugin and Package identities with declared-half metadata.
 */
define(request: DynamicCordisDefineRequest): DynamicCordisDefineReceipt

/**
 * Remove a Plugin, its active run, and all immutable Packages.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
async undefine(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Remove a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
@Remote('undefineFromPanel') async undefineFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Start or update one Package for a model tool call. An unauthorized Client
 * Package waits for approval; Plugin-wide authorization covers later versions.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param signal - Tool-call cancellation signal while the activation request is being created.
 * @returns The successful activation identity or an actionable refusal.
 */
async run( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, signal?: AbortSignal, ): Promise<DynamicCordisRunResponse>

/**
 * Start Host code for an approved request or a direct panel gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param requestId - Model-driven request identity, or null for a direct user gesture.
 * @param approveFutureVersions - Whether this approval covers later Packages of the same Plugin.
 * @returns The exact Host activation or a failure message.
 */
@Remote('runHostHalf') async runHostHalf( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, requestId: ApprovalRequestId | null, approveFutureVersions: boolean, ): Promise<DynamicCordisHostHalfResult>

/**
 * Fetch Client code for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to read.
 * @param pluginRunId - Exact active run authorized to receive source.
 * @returns Client source and its Plugin, Package, and run identities.
 */
@Remote('getClientCode') getClientCode( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, ): DynamicCordisClientSource

/**
 * Resolve one model-driven Client activation request.
 * @param requestId - Request identity to settle once.
 * @param resolution - Browser refusal or exact Client activation result.
 * @returns Whether the still-pending request accepted this resolution.
 */
@Remote('resolveRequestRun') async resolveRequestRun( requestId: ApprovalRequestId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisResolveAck>

/**
 * Settle a direct panel run after this page loaded or failed its Client half.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity being settled.
 * @param resolution - Exact Client activation result from the acting page.
 * @returns The committed activation or its failure.
 */
@Remote('settleUserRun') async settleUserRun( agent: Agent, pluginId: CordisDynamicPluginId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisRunResponse>

/**
 * Stop the active run while retaining every Package version.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
async stop(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Stop a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
@Remote('stopFromPanel') async stopFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Replace the Host mirror of the Client inspect provider directory.
 * @param providers - complete Client provider manifest.
 * @returns null after accepting the manifest.
 */
@Remote('syncInspectManifest') syncInspectManifest(providers: readonly CordisInspectProviderManifest[]): null

/**
 * Claim one pending Client inspect query with its live result.
 * @param agent - Session that owns the query.
 * @param requestId - exact pending query identity.
 * @param resolution - provider result or structured refusal.
 * @returns whether this answer won the query.
 */
@Remote('resolveInspectQuery') resolveInspectQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck

/**
 * Frame-wide inventory, grouped as one row per stable Plugin.
 * @returns Source-free metadata for every process-local Plugin.
 */
@Remote('inventory') inventory(): DynamicCordisInventoryRow[]

/**
 * Read one Session's Host-rich state for inspection and result rendering.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns Plugin versions, active runs, Host fibers, and render failures.
 */
snapshot(agent: Agent): DynamicCordisSnapshotRow[]

/**
 * Read source-free context for an explicit `@pluginId` user gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity referenced by the user.
 * @returns The preferred modification base, or undefined when unavailable.
 */
reference(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisReference | undefined

/**
 * List source-free Plugin summaries owned by one Session.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns one summary per Plugin in creation order.
 */
listPlugins(agent: Agent): DynamicCordisPluginInspection[]

/**
 * Inspect one Plugin without returning Package source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - stable Plugin identity.
 * @returns version pointers, latest run, and all Package summaries.
 */
inspectPlugin(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisPluginInspection

/**
 * Read one exact immutable Package and its Host and Client source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that owns the Package.
 * @param packageId - Exact immutable Package identity to inspect.
 * @returns Package metadata, source, and the Plugin's lifecycle pointers.
 */
inspectPackage( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, ): DynamicCordisPackageInspection

/**
 * Record a post-load render failure for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that rendered.
 * @param pluginRunId - Exact active run that produced the failure.
 * @param failure - Slot, message, and entry-retirement result.
 * @returns Null after recording or ignoring a stale report.
 */
@Remote('reportRenderFailure') async reportRenderFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: DynamicCordisRenderFailure, ): Promise<null>

/**
 * Report a Client guard rejection that happened after the Package completed activation.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity whose Client code was rejected.
 * @param pluginRunId - Exact active run that produced the rejection.
 * @param failure - Original guard message and stack.
 * @returns Null after reporting or ignoring a stale/startup failure.
 */
@Remote('reportClientGuardFailure') async reportClientGuardFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: CordisErrorDetails, ): Promise<null>

/**
 * Invoke an active Host method while rejecting stale Client runs.
 * @param pluginId - Stable Plugin identity that owns the method.
 * @param pluginRunId - Exact active run authorizing the call.
 * @param method - Registered Host handler name.
 * @param args - JSON argument delivered to the handler.
 * @returns The JSON result or a typed invocation failure.
 */
@Remote('invoke') async invoke( pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, method: string, args: JsonValue, ): Promise<DynamicCordisInvokeResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/extensions/cordis-host-runner/src/index.ts`](../../packages/extensions/cordis-host-runner/src/index.ts)

<a id="ctxxiaojingdesktopcompanion--xiaojingdesktopcompanion"></a>

### `ctx.xiaojingDesktopCompanion` — `XiaojingDesktopCompanion`

Aggregate task lifecycle events and expose a loopback-only snapshot stream.

```ts cordis-catalog
/**
 * Return the current content-free aggregate state.
 * @returns The current redacted snapshot.
 */
snapshot(): CompanionSnapshot
```

Source: [`packages/xiaojing/xiaojing-desktop-companion/src/index.ts`](../../packages/xiaojing/xiaojing-desktop-companion/src/index.ts)

<a id="ctxxiaojingfinancecalculations--xiaojingfinancecalculations"></a>

### `ctx.xiaojingFinanceCalculations` — `XiaojingFinanceCalculations`

Host service consumed only by the Finance preset's calculation tool.

```ts cordis-catalog
/**
 * Calculate one Finance trial result using explicit inputs and immutable client assumptions.
 * @param agent - Calling Finance agent.
 * @param request - Explicit calculation request.
 * @returns Auditable deterministic result.
 */
calculate(agent: Agent, request: FinanceCalculationRequest): FinanceCalculationResult
```

Types: [Agent](core.zh.md)

Source: [`packages/xiaojing/xiaojing-finance-calculations/src/index.ts`](../../packages/xiaojing/xiaojing-finance-calculations/src/index.ts)

<a id="ctxxiaojingfinancedocuments--xiaojingfinancedocuments"></a>

### `ctx.xiaojingFinanceDocuments` — `XiaojingFinanceDocuments`

Host service exposed only through the Finance preset's document tool.

```ts cordis-catalog
/**
 * List and normalize original-material imports in the calling Finance session.
 * @param agent - Calling Finance agent.
 * @param signal - Caller cancellation signal; shared warming remains useful after cancellation.
 * @returns Imported document states in event order.
 */
async listDocuments(agent: Agent, signal?: AbortSignal): Promise<FinanceDocumentListItem[]>

/**
 * Read one bounded page of normalized content from the calling Finance session.
 * @param agent - Calling Finance agent.
 * @param documentId - Session import identity returned by {@link listDocuments}.
 * @param cursor - Zero-based normalized-unit cursor.
 * @param signal - Caller cancellation signal.
 * @returns Paginated normalized content.
 */
async readDocument( agent: Agent, documentId: FinanceManagedFileId, cursor: number = 0, signal?: AbortSignal, ): Promise<FinanceDocumentReadResult>

/**
 * Read one bounded document-image page from the calling Finance session.
 * @param agent - Calling Finance agent.
 * @param documentId - Session import identity returned by {@link listDocuments}.
 * @param cursor - Zero-based document-image cursor.
 * @param signal - Caller cancellation signal.
 * @returns Durable native-vision attachments and their slide locations.
 */
async readDocumentVisuals( agent: Agent, documentId: FinanceManagedFileId, cursor: number = 0, signal?: AbortSignal, ): Promise<FinanceDocumentVisualReadResult>

/**
 * List deterministic document states for the calling ordinary session.
 * @param agent - Calling non-Finance agent.
 * @param signal - Caller cancellation signal.
 * @returns Current-session uploads in durable user-message order.
 */
async listGeneralDocuments(agent: Agent, signal?: AbortSignal): Promise<XiaojingDocumentListItem[]>

/**
 * Read normalized text from one upload introduced by the calling ordinary session.
 * @param agent - Calling non-Finance agent.
 * @param documentId - Opaque identity returned by {@link listGeneralDocuments}.
 * @param cursor - Zero-based normalized-unit cursor.
 * @param signal - Caller cancellation signal.
 * @returns Paginated normalized content.
 */
async readGeneralDocument( agent: Agent, documentId: XiaojingDocumentId, cursor: number = 0, signal?: AbortSignal, ): Promise<XiaojingDocumentReadResult>

/**
 * Read document images from one upload introduced by the calling ordinary session.
 * @param agent - Calling non-Finance agent.
 * @param documentId - Opaque identity returned by {@link listGeneralDocuments}.
 * @param cursor - Zero-based document-image cursor.
 * @param signal - Caller cancellation signal.
 * @returns Durable native-vision attachments and their slide locations.
 */
async readGeneralDocumentVisuals( agent: Agent, documentId: XiaojingDocumentId, cursor: number = 0, signal?: AbortSignal, ): Promise<XiaojingDocumentVisualReadResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/xiaojing/xiaojing-finance-documents/src/index.ts`](../../packages/xiaojing/xiaojing-finance-documents/src/index.ts)

<a id="ctxxiaojingfinancedomain--xiaojingfinancedomain"></a>

### `ctx.xiaojingFinanceDomain` — `XiaojingFinanceDomain`

Host service owning local client CRUD, pre-turn staging, and durable session binding.

```ts cordis-catalog
/**
 * List local client summaries.
 * @returns Current catalog revision and rows.
 */
@Remote('list') list(): Promise<FinanceClientListView>

/**
 * Read computer-wide attachment settings.
 * @returns Configuration without AccessKey values.
 */
@Remote('readAttachmentStorage') readAttachmentStorage(): Promise<AttachmentStorageView>

/**
 * Read the independently saved reimbursement connection.
 * @param clientId - Selected account-book.
 * @returns Non-secret reimbursement settings.
 */
@Remote('readReimbursementConnection') async readReimbursementConnection(clientId: FinanceClientId): Promise<ReimbursementConnectionView>

/**
 * Replace reimbursement credentials without changing Finance authorization.
 * @param request - Revision-checked reimbursement credentials.
 * @returns Saved non-secret settings.
 */
@Remote('saveReimbursementConnection') async saveReimbursementConnection(request: SaveReimbursementConnectionRequest): Promise<ReimbursementConnectionView>

/**
 * Verify reimbursement authorization through a read-only department query.
 * @param clientId - Account-book whose saved credential is tested.
 * @returns Read-only authorization outcome.
 */
@Remote('testReimbursementConnection') async testReimbursementConnection(clientId: FinanceClientId): Promise<string>

/**
 * Discover reimbursement fields or save an explicitly confirmed, invoice-backed draft.
 * @param agent - Bound Finance session; callers cannot override account-book identity.
 * @param input - Untrusted tool JSON, parsed before authentication.
 * @param signal - Caller cancellation.
 * @returns Credential-free metadata or a durable draft receipt; incomplete writes remain explicit.
 */
async reimbursement(agent: Agent, input: unknown, signal: AbortSignal): Promise<object>

/**
 * Replace computer-wide attachment configuration.
 * @param request - Revision-checked settings with optional new key pair.
 * @returns Sanitized saved settings.
 */
@Remote('saveAttachmentStorage') saveAttachmentStorage(request: SaveAttachmentStorageRequest): Promise<AttachmentStorageView>

/**
 * Test a synthetic object without uploading customer documents.
 * @param revision - Saved configuration selected for testing.
 * @returns Real upload, download, and cleanup outcomes.
 */
@Remote('testAttachmentStorage') async testAttachmentStorage(revision: number): Promise<AttachmentStorageTestResult>

/**
 * Upload one unchanged original invoice imported into the calling account-book session.
 * @param agent - Bound Finance agent whose workspace and import log authorize the file.
 * @param sourcePath - Exact imported path or an unambiguous imported filename.
 * @param signal - Caller cancellation.
 * @returns Host-only receipt; consumers must omit downloadUrl from model-visible output.
 */
async uploadFinanceAttachment(agent: Agent, sourcePath: string, signal: AbortSignal): Promise<FinanceAttachmentUpload>

/**
 * List standard and customer Workspaces owned by Finance.
 * @returns Browser-safe Workspace identities in customer-catalog order.
 */
@Remote('workspaces') async workspaces(): Promise<FinanceWorkspaceListView>

/**
 * Register one user-selected Finance consultation Workspace.
 * @param request - Directory selected through the local folder picker.
 * @returns Browser-safe Finance Workspace entry.
 */
@Remote('addConsultationWorkspace') async addConsultationWorkspace( request: AddFinanceConsultationWorkspaceRequest, ): Promise<FinanceGeneralWorkspaceEntry>

/**
 * Rename one Finance-owned Workspace without changing its directory or client record.
 * @param request - Workspace identity and new sidebar title.
 * @returns Updated browser-safe Workspace entry.
 */
@Remote('renameWorkspace') async renameWorkspace(request: RenameFinanceWorkspaceRequest): Promise<FinanceWorkspaceEntry>

/**
 * Remove one Finance-owned Workspace from product lists without deleting durable data.
 * @param request - Workspace selected in the Finance sidebar.
 * @returns The detached browser-safe Workspace entry.
 */
@Remote('removeWorkspace') async removeWorkspace(request: RemoveFinanceWorkspaceRequest): Promise<FinanceWorkspaceEntry>

/**
 * Restore a removed client Workspace when its existing directory is selected again.
 * @param request - Directory selected through the local folder picker.
 * @returns Restored client Workspace, or null when the directory is not an existing client.
 */
@Remote('restoreClientWorkspace') async restoreClientWorkspace( request: RestoreFinanceClientWorkspaceRequest, ): Promise<FinanceClientWorkspaceEntry | null>

/**
 * Read full local client detail.
 * @param clientId - Client identity.
 * @returns Full loopback-only record.
 */
@Remote('read') async read(clientId: FinanceClientId): Promise<FinanceClientReadView>

/**
 * Read available ledgers using unsaved credentials without changing the customer, secret, or badge.
 * @param request - Editor revision, application identity, and optional write-only replacement secret.
 * @returns Ledger choices or a safe connection failure; rejects stale revisions and archived clients.
 */
@Remote('listYouchengAccounts') async listYouchengAccounts(request: ListFinanceYouchengAccountsRequest): Promise<FinanceYouchengAccountsResult>

/**
 * Verify the saved Youcheng credentials and exact ledger without any accounting mutation.
 * @param clientId - Local customer owning the saved connection.
 * @returns Sanitized current check; a concurrent edit invalidates the old result.
 */
@Remote('checkConnection') async checkConnection(clientId: FinanceClientId): Promise<FinanceConnectionStatus>

/**
 * Query vouchers using the owning Finance session's saved ledger and Host credential.
 * @param agent - Bound Finance agent; consultation and other workspaces are rejected.
 * @param query - Month and page, with no customer, ledger, URL, or credential overrides.
 * @param signal - Caller cancellation.
 * @returns One bounded read-only page; concurrent record edits discard its result.
 */
async queryVouchers(agent: Agent, query: VoucherQuery, signal: AbortSignal): Promise<VoucherPage>

/**
 * Read a specified voucher using the bound session's saved connection.
 * @param agent - Client-bound Finance agent in its own workspace.
 * @param voucherId - ID from the list or user, not a voucher display number.
 * @param signal - Caller cancellation.
 * @returns Verified detail; changed configuration or credentials discard the result.
 */
async queryVoucherDetail(agent: Agent, voucherId: string, signal: AbortSignal): Promise<VoucherDetail>

/**
 * Query balances using only the bound Finance session's saved connection.
 * @param agent - Client-bound Finance agent in its own workspace.
 * @param query - Inclusive accounting periods without ledger overrides.
 * @param signal - Caller cancellation.
 * @returns Bounded report; changed configuration or credentials discard the result.
 */
async queryBalances(agent: Agent, query: BalanceQuery, signal: AbortSignal): Promise<BalanceResult>

/**
 * Compare explicit single-level base-currency balances under one saved-client revision.
 * @param agent - Bound Finance session.
 * @param query - Months and one subject level.
 * @param signal - Caller cancellation.
 * @returns Exact differences with original rows and unverified coverage retained.
 */
async analyzeBalances(agent: Agent, query: BalanceAnalysisQuery, signal: AbortSignal): Promise<BalanceAnalysisResult>

/**
 * Publish a freshly read balance analysis with source rows and exact-text amounts.
 * @param agent - Bound Finance session.
 * @param query - Months and one subject level, not caller-authored rows.
 * @param signal - Caller cancellation.
 * @returns The analyzed report and committed local workbook.
 */
async exportBalanceAnalysis(agent: Agent, query: BalanceAnalysisQuery, signal: AbortSignal): Promise<{ report: BalanceAnalysisResult file: FinanceManagedFile }>

/**
 * Query journals using the session-bound client's saved connection.
 * @param agent - Bound Finance agent in its own workspace.
 * @param query - Single-month date range, page and optional cash-account selection.
 * @param signal - Caller cancellation.
 * @returns Bounded read; concurrent client or credential changes discard the result.
 */
async queryJournals(agent: Agent, query: JournalQuery, signal: AbortSignal): Promise<JournalResult>

/**
 * Reconcile one cash account's journals and compare same-currency periods.
 * @param agent - Bound Finance agent in its own workspace.
 * @param query - Explicit account and date ranges without connection overrides.
 * @param signal - Caller cancellation.
 * @returns Reconciled totals; concurrent client or credential changes discard the entire report.
 */
async analyzeJournals(agent: Agent, query: JournalAnalysisQuery, signal: AbortSignal): Promise<JournalAnalysisResult>

/**
 * Query and publish a reconciled journal comparison with exact source rows.
 * @param agent - Owning bound Finance session.
 * @param query - Account and date ranges, not a previous-result snapshot.
 * @param signal - Cancellation checked before writing and before publication starts.
 * @returns Exact report and committed local workbook; no publication follows failed reconciliation.
 */
async exportJournalAnalysis(agent: Agent, query: JournalAnalysisQuery, signal: AbortSignal): Promise<{ report: JournalAnalysisResult file: FinanceManagedFile }>

/**
 * Query receivables or payables using the session-bound saved connection.
 * @param agent - Bound Finance agent in its own workspace.
 * @param query - Direction, accounting periods and page without connection overrides.
 * @param signal - Caller cancellation.
 * @returns Bounded page; changed client configuration or credentials discard the result.
 */
async queryOpenItems(agent: Agent, query: OpenItemQuery, signal: AbortSignal): Promise<OpenItemResult>

/**
 * Aggregate or compare complete vendor-count-reconciled open-item pages.
 * @param agent - Bound Finance agent in its own workspace.
 * @param query - Direction, periods and grouping; no model-supplied records.
 * @param signal - Caller cancellation.
 * @returns Exact same-currency groups; concurrent configuration changes discard the entire report.
 */
async analyzeOpenItems(agent: Agent, query: OpenItemAnalysisQuery, signal: AbortSignal): Promise<OpenItemAnalysisResult>

/**
 * Query and publish a local XLSX of this invocation's open-item analysis.
 * @param agent - Owning bound Finance session.
 * @param query - Query criteria, not a previous-result snapshot or caller-authored rows.
 * @param signal - Cancellation checked before writing and before publication begins.
 * @returns Published file and the exact report serialized; publication commits preserve the work copy.
 */
async exportOpenItems(agent: Agent, query: OpenItemAnalysisQuery, signal: AbortSignal): Promise<{ report: OpenItemAnalysisResult file: FinanceManagedFile }>

/**
 * Query and publish one explicitly bounded voucher page without ledger-wide completeness claims.
 * @param agent - Owning bound Finance session.
 * @param query - Page and filters, not caller-authored accounting data.
 * @param signal - Cancellation checked before writing and before publication starts.
 * @returns Exact queried page and committed local file; the work copy is preserved.
 */
async exportVouchers(agent: Agent, query: VoucherQuery, signal: AbortSignal): Promise<{ report: VoucherPage file: FinanceManagedFile }>

/**
 * Query and publish balance source columns with their unverified coverage notice intact.
 * @param agent - Owning bound Finance session.
 * @param query - Inclusive accounting periods.
 * @param signal - Cancellation checked before writing and before publication starts.
 * @returns Exact queried report and committed local workbook; no inferred totals or currency.
 */
async exportBalances(agent: Agent, query: BalanceQuery, signal: AbortSignal): Promise<{ report: BalanceResult file: FinanceManagedFile }>

/**
 * Query and publish one journal page, retaining its missing completeness evidence.
 * @param agent - Owning bound Finance session.
 * @param query - Dates, account selector and bounded page.
 * @param signal - Cancellation checked before writing and publication.
 * @returns Exact source report and committed workbook, with summaries separated.
 */
async exportJournals(agent: Agent, query: JournalQuery, signal: AbortSignal): Promise<{ report: JournalResult file: FinanceManagedFile }>

/**
 * Query and publish one raw receivable/payable page without additional aggregation.
 * @param agent - Owning bound Finance session.
 * @param query - Direction, periods and bounded page.
 * @param signal - Cancellation checked before writing and publication.
 * @returns Exact source report and committed workbook; settlement is not a bank payment claim.
 */
async exportOpenItemPage(agent: Agent, query: OpenItemQuery, signal: AbortSignal): Promise<{ report: OpenItemResult file: FinanceManagedFile }>

/**
 * Prepare/revise local subject or auxiliary values, or inspect the original submission without sending.
 * @param agent - Owning client-bound Finance session.
 * @param input - Explicit proposal or original local ID/version.
 * @param signal - Caller cancellation.
 * @param maxBytes - Complete preview and durable record limit.
 * @returns Exact preview or persisted outcome with an independent content comparison.
 */
async prepareMasterData(agent: Agent, input: unknown, signal: AbortSignal, maxBytes: number): Promise<object>

/**
 * Confirm and reserve an exact subject/auxiliary proposal before one public API write.
 * @param agent - Owning Finance agent for mandatory approval.
 * @param input - Existing preparation ID and exact version only.
 * @param signal - Caller cancellation; no cancellation after dispatch grants retry authority.
 * @param maxBytes - Complete preview, persistent record and response limit.
 * @returns Durable transport result followed by a separate, possibly unavailable readback.
 */
async createMasterData(agent: Agent, input: unknown, signal: AbortSignal, maxBytes: number): Promise<object>

/**
 * Read account observations on one explicit existing-open-item page, not a complete account directory.
 * @param agent - Client-bound Finance session in its own workspace.
 * @param input - Direction, period range and page selected for this read.
 * @param signal - Caller cancellation.
 * @returns Returned account identities, attributes and source coverage; missing accounts remain unresolved.
 */
async queryObservedOpenItemAccounts(agent: Agent, input: unknown, signal: AbortSignal): Promise<OpenItemAccountReferences>

/**
 * Prepare/revise a local open item or inspect its original durable submission without resending.
 * @param agent - Owning client-bound Finance session.
 * @param input - Complete sourced proposal or original local operation ID.
 * @param signal - Caller cancellation.
 * @param maxBytes - Complete local record and result limit.
 * @returns Local preview or durable outcome and independent readback; neither proves receipt or payment.
 */
async prepareOpenItem(agent: Agent, input: unknown, signal: AbortSignal, maxBytes: number): Promise<object>

/**
 * Confirm one exact open-item version, reserve durably, send once and independently compare its returned ID.
 * @param agent - Owning Finance session and mandatory-approval context.
 * @param input - Persisted local ID and version only.
 * @param signal - Cancellation; received transport outcomes remain durable after cancellation.
 * @param maxBytes - Complete record, request and result cap.
 * @returns Durable outcome plus content/association/balance checks, not settlement or payment execution.
 */
async createOpenItem(agent: Agent, input: unknown, signal: AbortSignal, maxBytes: number): Promise<object>

/**
 * Prepare or revise a local journal, or inspect the original accepted/unknown submission without resending.
 * @param agent - Client-bound Finance session in its own workspace.
 * @param input - Preparation command or original local operation ID.
 * @param signal - Caller cancellation.
 * @param maxBytes - Deployment record/result byte cap.
 * @returns Exact local preview or durable transport state with independent readback.
 */
async prepareJournal(agent: Agent, input: unknown, signal: AbortSignal, maxBytes: number): Promise<object>

/**
 * Confirm an exact journal version, durably reserve it, send once and inspect the original result.
 * @param agent - Owning Finance agent, supplying mandatory approval context.
 * @param input - Existing local ID and version only.
 * @param signal - Caller cancellation; a received ID persists even if cancellation follows dispatch.
 * @param maxBytes - Deployment record/request/result byte limit.
 * @returns Sanitized durable transport and readback states, never a retry instruction.
 */
async createJournal(agent: Agent, input: unknown, signal: AbortSignal, maxBytes: number): Promise<object>

/**
 * Prepare/revise an unsent voucher, or inspect its durable submission record in the owning Finance session.
 * @param agent - Bound Finance agent; identity and credentials cannot be supplied in the request.
 * @param input - Preparation-only command, including proposed entries or a prior local ID/version.
 * @param signal - Cancellation before publication.
 * @param limits - Deployment-controlled maximum entries and complete input/result size.
 * @returns Local preview or submission observation with pending checks;
 * accepted IDs receive read-only basic accounting comparison, never resubmission.
 */
async prepareVoucher(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxEntries: number; maxBytes: number }): Promise<object>

/**
 * Confirm and send an exact saved version once; acceptance remains distinct from verified completion.
 * @param agent - Owning Finance session; supplies the account and mandatory approval context.
 * @param input - Local proposal ID and version only, with no destination or approval overrides.
 * @param signal - Cancellation; observations after dispatch are persisted even when cancelled.
 * @param limits - Maximum entries and complete record/response bytes.
 * @returns Durable transport outcome and optional basic readback, never an automatic resend.
 */
async createVoucher(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxEntries: number; maxBytes: number }): Promise<object>

/**
 * Prepare or inspect a deletion using a fresh voucher detail within the currently bound client.
 * @param agent - Client-bound Finance session owning the request.
 * @param input - Preparation/revision references or an existing deletion record ID; no credentials or consent overrides.
 * @param signal - Caller cancellation.
 * @param limits - Complete record/input limits and maximum pages per absence-verification pass.
 * @returns Saved exact preview or read-only recovery result; never sends a deletion.
 */
async prepareVoucherDeletion(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxEntries: number; maxBytes: number; maxPages: number }): Promise<object>

/**
 * Force confirmation of an exact deletion version and persist the shared target claim before dispatch.
 * @param agent - Initiating client-bound session.
 * @param input - Local deletion ID and version only.
 * @param signal - Caller cancellation; transport observations remain durable after dispatch.
 * @param limits - Full record/result bounds and maximum pages per readback pass.
 * @returns Transport observation and independent readback; never automatically resends an uncertain operation.
 */
async deleteVoucher(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxEntries: number; maxBytes: number; maxPages: number }): Promise<object>

/**
 * Prepare or recover one journal deletion within an explicit cash account and month.
 * @param agent - Session bound to the current Finance client.
 * @param input - Exact target/month/account for preparation or a local operation ID for read-only recovery.
 * @param signal - Caller cancellation.
 * @param limits - Complete record/output and independent inventory bounds.
 * @returns Versioned target preview or scoped readback; never sends a business write or claims global absence.
 */
async prepareJournalDeletion(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxBytes: number; maxPages: number; maxRows: number; pageSize: number }): Promise<object>

/**
 * Enforce exact journal/version approval and reserve a shared target before a single dispatch.
 * @param agent - Initiating bound Finance session.
 * @param input - Local prepared operation ID and exact version, without consent or destination overrides.
 * @param signal - Caller cancellation; a received transport outcome remains durable.
 * @param limits - Record, result and two-pass inventory bounds.
 * @returns Persisted transport outcome and separate scoped target/content/balance observations, never an automatic retry.
 */
async deleteJournal(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxBytes: number; maxPages: number; maxRows: number; pageSize: number }): Promise<object>

/**
 * Prepare or inspect AR/AP deletion evidence without exposing the internal sender.
 * @param agent - Finance session bound to its current client and workspace.
 * @param input - Exact target/direction/periods, or an owned local operation ID for recovery.
 * @param signal - Caller cancellation, combined with Host disposal.
 * @param limits - Complete persisted/output byte cap and counted inventory bounds.
 * @returns Versioned restrictions and scoped observations; known blockers prevent execution and unknown effects
 * require explicit confirmation.
 */
async prepareOpenItemDeletion(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxBytes: number; maxPages: number; maxRows: number; pageSize: number }): Promise<object>

/**
 * Prepare full-settlement evidence or inspect an original operation without granting write authority.
 * @param agent - Finance session bound to its own client workspace.
 * @param input - Complete local intent for preparation/revision, or saved local ID for inspection.
 * @param signal - Caller cancellation combined with Host disposal.
 * @param limits - Complete record/output cap and source/reference row bounds.
 * @returns Original preview and transport state, with independent balance and receipt-linked journal observations; no execution.
 */
async prepareOpenItemWriteOff(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxBytes: number; maxRows: number }): Promise<object>

/**
 * Confirm and reserve an exact receivable/payable deletion before one business request.
 * @param agent - Finance session bound to the owning saved client and workspace.
 * @param input - Prepared local ID and exact version, without consent or target overrides.
 * @param signal - Caller cancellation combined with Host disposal.
 * @param limits - Complete record/result and counted two-pass inventory bounds.
 * @returns Durable transport outcome and separate scoped recovery; unknown results are never retried.
 */
async deleteOpenItem(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxBytes: number; maxPages: number; maxRows: number; pageSize: number }): Promise<object>

/**
 * Confirm and reserve an exact full-settlement version before one business request.
 * @param agent - Finance session bound to the owning saved client and workspace.
 * @param input - Prepared local ID and exact version, without consent or account overrides.
 * @param signal - Caller cancellation combined with Host disposal.
 * @param limits - Complete record/output and reference row bounds.
 * @returns Durable transport outcome and independent recovery; unavailable period status is disclosed, not certified.
 */
async writeOffOpenItem(agent: Agent, input: unknown, signal: AbortSignal, limits: { maxBytes: number; maxRows: number }): Promise<object>

/**
 * Query reference data using only the owning session's current saved ledger.
 * @param agent - Client-bound Finance agent in its own workspace.
 * @param query - Reference kind and exact filters, without connection overrides.
 * @param signal - Caller cancellation.
 * @returns Bounded reference rows; stale configuration or credentials discard the result.
 */
async queryReferences(agent: Agent, query: ReferenceQuery, signal: AbortSignal): Promise<ReferenceResult>

/**
 * Create one client.
 * @param request - Expected revision and fields.
 * @returns Mutation result.
 */
@Remote('create') async create(request: CreateFinanceClientRequest): Promise<FinanceClientMutationResult>

/**
 * Replace one active client.
 * @param request - Client, revision, and fields.
 * @returns Mutation result.
 */
@Remote('update') async update(request: UpdateFinanceClientRequest): Promise<FinanceClientMutationResult>

/**
 * Archive one active client.
 * @param request - Client and expected revision.
 * @returns Mutation result.
 */
@Remote('archive') async archive(request: ArchiveFinanceClientRequest): Promise<FinanceClientMutationResult>

/**
 * Stage a general or client-specific context before the first turn.
 * @param agent - Target live agent.
 * @param request - Selection.
 * @returns Current UI state.
 */
@Remote('stage') async stage(agent: Agent, request: StageFinanceClientRequest): Promise<FinanceSessionContextView>

/**
 * Read the sanitized Finance context state for one session.
 * @param agent - Target live agent.
 * @returns UI state.
 */
@Remote('sessionContext') async sessionContext(agent: Agent): Promise<FinanceSessionContextView>

/**
 * Resolve and durably bind the model-visible Finance context for one request.
 * @param agent - Finance agent addressing a model.
 * @returns Logged context text.
 */
async promptContext(agent: Agent): Promise<string>

/**
 * Register one completed local upload in the current Finance context.
 * @param agent - Finance agent whose consultation session or client selection owns the upload.
 * @param request - Upload-service path and browser filename.
 * @returns Session-scoped consultation record or committed client original-material record.
 */
@Remote('importUpload') async importUpload(agent: Agent, request: ImportFinanceUploadRequest): Promise<FinanceImportedFile>

/**
 * Return the Host-configured directory that owns general-consultation uploads.
 * @returns Absolute local upload directory.
 */
localUploadRoot(): string

/**
 * Publish one file from the current session work directory.
 * @param agent - Bound Finance agent.
 * @param request - Session-work path and optional output name.
 * @returns Committed formal-output record.
 */
async publishFile(agent: Agent, request: PublishFinanceFileRequest): Promise<FinanceManagedFile>

/**
 * Archive one managed client file without removing its source.
 * @param agent - Bound Finance agent.
 * @param request - Managed source and optional archive name.
 * @returns Committed archive record.
 */
async archiveFile(agent: Agent, request: ArchiveFinanceFileRequest): Promise<FinanceManagedFile>

/**
 * Require an immutable bound client for a client-specific Finance service.
 * @param agent - Finance agent.
 * @returns Durable binding.
 */
requireBoundClient(agent: Agent): FinanceClientBinding

/**
 * Read the immutable client binding when the Finance session has one.
 * @param agent - Finance agent.
 * @returns Detached binding, or undefined for consultation sessions.
 */
currentClientBinding(agent: Agent): FinanceClientBinding | undefined

/**
 * Require a bound client and ensure its workspace directories exist.
 * @param agent - Finance agent.
 * @returns Immutable binding and client workspace paths.
 */
async requireBoundClientWorkspace(agent: Agent): Promise<{ binding: FinanceClientBinding workspace: FinanceClientWorkspace }>

/**
 * Whether a live agent is composed from Finance.
 * @param agent - Agent to inspect.
 * @returns Finance membership.
 */
isFinanceAgent(agent: Agent): boolean
```

Types: [Agent](core.zh.md)

Source: [`packages/xiaojing/xiaojing-finance-domain/src/index.ts`](../../packages/xiaojing/xiaojing-finance-domain/src/index.ts)

<a id="ctxxiaojingfinanceevidence--xiaojingfinanceevidence"></a>

### `ctx.xiaojingFinanceEvidence` — `XiaojingFinanceEvidence`

Host service used only by the Finance preset's evidence tool.

```ts cordis-catalog
/**
 * Research official evidence for one Finance agent.
 * @param agent - Calling Finance agent.
 * @param request - Research request.
 * @param signal - Cancellation signal.
 * @returns Auditable evidence result.
 */
research(agent: Agent, request: FinanceEvidenceRequest, signal?: AbortSignal): Promise<FinanceEvidenceResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/xiaojing/xiaojing-finance-evidence/src/index.ts`](../../packages/xiaojing/xiaojing-finance-evidence/src/index.ts)

<a id="ctxxiaojingweixinchannel--xiaojingweixinchannel"></a>

### `ctx.xiaojingWeixinChannel` — `XiaojingWeixinChannel`

Stateful Host adapter; exported for assembled integration tests.

```ts cordis-catalog
/** Load private state, acquire the single-consumer lease, and auto-reconnect. */
async start(): Promise<void>

/** Register the loopback RPC surface and session/approval correlations. */
install(): void

/** Stop network work, fail pending approvals closed, and release process ownership. */
async dispose(): Promise<void>

/**
 * Sanitized state suitable for the local settings page.
 * @returns connection state without the bot token or message context values.
 */
snapshot(): WeixinChannelStatus
```

Source: [`packages/xiaojing/xiaojing-weixin-channel/src/index.ts`](../../packages/xiaojing/xiaojing-weixin-channel/src/index.ts)

<a id="cordis-events"></a>

### `cordis/*` events

<a id="cordisdynamic-package--emit"></a>

#### `cordis/dynamic-package` — emit

One exact Plugin/Package activation is now live in the Host.

```ts cordis-catalog
/**
 * One exact Plugin/Package activation is now live in the Host.
 * @param pkg - stable plugin, immutable package, run identity, and label.
 * @mode emit
 */
'cordis/dynamic-package'(pkg: DynamicCordisPackage): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisdynamic-retract--emit"></a>

#### `cordis/dynamic-retract` — emit

One exact activation was withdrawn.

```ts cordis-catalog
/**
 * One exact activation was withdrawn.
 * @param retracted - plugin, package, and run identity.
 * @mode emit
 */
'cordis/dynamic-retract'(retracted: DynamicCordisRetracted): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query--emit"></a>

#### `cordis/inspect-query` — emit

Request a live read-only query from the Client inspect registry.

```ts cordis-catalog
/**
 * Request a live read-only query from the Client inspect registry.
 * @param request - correlation, Session, provider, method, and JSON input.
 * @mode emit
 */
'cordis/inspect-query'(request: CordisInspectQueryRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query-resolved--emit"></a>

#### `cordis/inspect-query-resolved` — emit

Notify every Client that an inspect query has settled or been cancelled.

```ts cordis-catalog
/**
 * Notify every Client that an inspect query has settled or been cancelled.
 * @param resolved - exact query identity that is no longer answerable.
 * @mode emit
 */
'cordis/inspect-query-resolved'(resolved: CordisInspectQueryResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run--emit"></a>

#### `cordis/request-run` — emit

A Client-bearing activation needs a browser page, and may require a user decision.

```ts cordis-catalog
/**
 * A Client-bearing activation needs a browser page, and may require a user decision.
 * @param request - correlation identity, owner, target version, mode, and approval requirement.
 * @mode emit
 */
'cordis/request-run'(request: DynamicCordisRunRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run-resolved--emit"></a>

#### `cordis/request-run-resolved` — emit

A pending Client activation request left the answerable state.

```ts cordis-catalog
/**
 * A pending Client activation request left the answerable state.
 * @param resolved - request identity and outcome.
 * @mode emit
 */
'cordis/request-run-resolved'(resolved: DynamicCordisRequestResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="xiaojing-weixin-events"></a>

### `xiaojing-weixin/*` events

<a id="xiaojing-weixinstatus--emit"></a>

#### `xiaojing-weixin/status` — emit

Publishes the sanitized iLink connection status after each transition.

```ts cordis-catalog
/**
 * Publishes the sanitized iLink connection status after each transition.
 * @param status - Browser-safe connection state without credentials or message content.
 * @mode emit
 */
'xiaojing-weixin/status'(status: WeixinChannelStatus): void
```

Source: [`packages/xiaojing/xiaojing-weixin-channel/src/index.ts`](../../packages/xiaojing/xiaojing-weixin-channel/src/index.ts)
<!-- END GENERATED cordis-surface -->
