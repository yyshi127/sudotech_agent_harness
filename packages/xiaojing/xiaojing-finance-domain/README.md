# @deepseek-ai/dsh-xiaojing-finance-domain

English | [中文](README.zh.md)

Xiaojing Finance Host capability for local taxpayer-entity records and immutable per-session client context. The Cordis plugin owns storage, revision-safe mutations, pre-turn selection, durable session binding, the browser Remote, and model-visible Finance context. It does not modify the Agent Loop and is loaded only by the Xiaojing product composition.

## Client records

One record represents one independent taxpayer entity. Required fields are the legal name, taxpayer type, registered region, and accounting standard. Optional fields include a short name, unified social credit code, industry, finance-policy notes, account mappings, and non-secret Youcheng or SDOO tenant, company, and account-set identifiers. Passwords and tokens are not accepted.

The catalog is stored at `$DSH_HOME/finance/clients-v1.json` with schema version `1`. Each mutation supplies the whole-file `expectedRevision`; a stale editor is rejected instead of overwriting another window. Writes use a file lock and atomic replacement. A corrupt document fails plugin startup and remains unchanged. Records can be archived but not physically deleted; archived records remain available to historical sessions and cannot start new sessions.

## Dedicated Finance workspaces

Finance owns a user-visible workspace root separate from ordinary Harness workspaces. The desktop product sets it to `Documents/小兢会计工作区/Finance工作区`; the deployment may provide another absolute `workspaceRoot`. The root contains one fixed Workspace displayed as `Consultation` and one `clients/<client-id>` Workspace per catalog record. Stable ids, rather than editable display names, keep customer paths unchanged when a record is renamed.

Creating a client provisions `00-客户档案`, `01-财务政策`, `02-原始资料`, `03-会话作业`, `04-成果输出`, and `05-归档` before committing the catalog record, then registers that client root with the Harness Workspace registry. A failed mutation removes the new registration and directory. Startup removes an incomplete registration left by an interrupted create but preserves its directory and files for recovery. Archiving keeps the Workspace and its history while disabling new sessions.

Workspace display titles and Finance-list membership are stored separately at `$DSH_HOME/finance/workspace-presentation-v1.json` with schema version `1`, a revision, process-safe locking, and atomic replacement. Renaming changes the Harness registration title and this presentation record without changing the directory. Removing a consultation or client Workspace hides it from Finance lists but keeps its registration, directory, customer record, and sessions; selecting the same directory through the add action restores it. At least one consultation Workspace must remain listed.

Client sessions use the selected client root as their immutable `cwd`, with one isolated child under `03-会话作业` per session. Each child atomically stores `会话信息.json` with the session id, client id, client-record version, and display name; full conversation history remains authoritative in the Harness session store, while this directory owns only working files and its identity manifest. An accounting period is not fixed on the client directory or session; tax, ledger, and bookkeeping Skills may create period-specific children for the current task. Consultations must use the fixed consultation root. The Host rejects a consultation in a client root and rejects one client's selection from another client's root.

## Controlled file lifecycle

The unified upload entry remains unchanged for users. In a client-bound Finance session, a completed local upload is copied into `02-原始资料`; the upload staging file is preserved, and supported images also remain native visual attachments. In a general Finance consultation, the Host keeps the file in the protected local upload directory and flushes a session-scoped `finance/consultation-file-imported` event containing its canonical path, display name, size, and SHA-256. Non-Finance sessions retain the ordinary upload behavior.

Each client session performs temporary work only in its own `03-会话作业/<session-id>` directory. The Finance preset adds the `finance_files` tool: natural-language requests for a final version, export, delivery, or formal saved result invoke `publish`, which copies an existing session-work file into `04-成果输出`. Draft, preview, trial, and ambiguous requests stay in session work. Only an explicit archive intent invokes `archive`, which copies a file from this client's original materials, current session work, or formal outputs into a Beijing-date child of `05-归档`. Neither action moves or deletes its source.

Every committed client copy is appended to `.xiaojing-finance-files-v1.json` under the client root with schema version `1`, a revision, the owning client and session, action, absolute destination, byte size, SHA-256 digest, and optional source-record id. The matching `finance/file-imported`, `finance/file-published`, or `finance/file-archived` event is flushed to the session before the operation returns. A consultation registration instead flushes `finance/consultation-file-imported` and creates no client index entry. These events make model-visible source authorization reconstructable from the log. Destination files and the client index use atomic writes; an invalid source, cross-client path, or corrupt index fails without changing the source or replacing the damaged index.

## Session context

A blank Finance session starts as general financial consultation. The browser may stage a client in Host memory before the first turn. Staged data is not logged and may be changed repeatedly. The first model request appends and flushes one `finance/client-bound` event before exposing the context to the model. The event contains only an immutable client snapshot and the client-record version.

Later edits to the client record affect only future sessions. Historical sessions reconstruct the original binding from their log. The `financeClient` session projection exposes only the display name and binding state; tax identifiers, policy notes, account mappings, and external-system identifiers remain on the Host. `requireBoundClient()` is the common guard for client-specific operations and rejects general consultations. Read-only Finance services may use `currentClientBinding()` to obtain the same immutable snapshot or continue without client context.

The Finance preset consumer is exported separately as `@deepseek-ai/dsh-xiaojing-finance-domain/context`. Removing that preset row removes model context while leaving the Host record service independently removable from the Web composition.

## Remote and privacy

The `financeClients` Remote provides client-record operations, Workspace list/add/rename/remove/restore operations, `stage`, and `sessionContext`. Full-detail reads, all mutations, and staged selection are restricted to loopback connections. List rows, Workspace identities, and session context use sanitized response types. The Client never receives Workspace filesystem paths, passwords, tokens, or another session's full immutable snapshot.

## Model Experience

### Finance client context

#### What the model sees

General Finance sessions receive an explicit statement that no client is bound and that client facts must not be inferred. Client-bound sessions receive only the immutable snapshot logged in `finance/client-bound` and an instruction to determine dates from the current task. Standard and other presets receive no Finance client contribution.

#### Token effect

General sessions add one fixed short instruction. Bound sessions add data-dependent client fields; no unselected client record enters the request.

#### KV Cache effect

The general context is stable across general Finance sessions. A bound context varies by client snapshot, so model prompt caching is shared only when those model-visible values are identical.

## Known Limitations and Deferred Work

- V1 supports manual record maintenance only; it has no spreadsheet import, contact, contract, sales, billing, or CRM workflow.
- Finance policy files are not attached to records; V1 stores policy notes as structured text.
- External-system references are identifiers only. This package does not connect to Youcheng or SDOO.
- A client cannot be added to an existing general session after its first turn; the user must create a new Finance session.
- Controlled upload, publish, and archive operations enforce the directory rules above, but Full Access shell and filesystem tools can still write directly within their granted operating-system permissions.
