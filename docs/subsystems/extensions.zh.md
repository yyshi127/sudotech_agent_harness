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
@Remote('read') read(clientId: FinanceClientId): Promise<FinanceClientReadView>

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
