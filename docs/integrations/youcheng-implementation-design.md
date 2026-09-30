# Youcheng finance and reimbursement implementation design

English | [中文](youcheng-implementation-design.zh.md)

Current scope is finance only, without reimbursement or a dual-module isolation project. The [itemized execution plan](youcheng-finance-execution-plan.md) defines current Goals; reimbursement and dual-module entries below are deferred references, not development or acceptance prerequisites. Preserve reimbursement data, exclude reimbursement APIs from finance execution, and still enforce client/ledger access scope.

## Objective and limits

This is the proposed design for the [development plan](youcheng-natural-language-development-plan.md), not delivered behavior. Current work revises finance planning only; reimbursement and dual-module design are outside execution scope. Preserve existing files, credentials, and records, reusing only infrastructure appropriate to necessary finance work.

## Responsibilities and implementation locations

| Responsibility | Reuse location | Necessary change |
|---|---|---|
| Client identity, settings, and session binding | [Finance Host](../../packages/xiaojing/xiaojing-finance-domain/src/index.ts) | Verify finance client/ledger identity without refactoring reimbursement connections |
| Finance APIs | [Finance adapter](../../packages/xiaojing/xiaojing-finance-domain/src/youcheng.ts) | Add required reads and voucher actions; keep independent auth parsing |
| Reimbursement APIs | [Reimbursement adapter](../../packages/xiaojing/xiaojing-finance-domain/src/reimbursement.ts) | Unchanged this phase; retained as reimbursement design reference |
| Reimbursement drafts and recovery | [Draft executor](../../packages/xiaojing/xiaojing-finance-domain/src/reimbursement-drafts.ts) | Retain current behavior until R1; finance must not execute through this business service |
| Source uploads | [Attachment storage](../../packages/xiaojing/xiaojing-finance-domain/src/attachment-storage.ts) | Reuse for finance after A01 qualification; reimbursement examples do not prove finance attachments |
| Model entry | [Finance tools](../../packages/xiaojing/xiaojing-finance-domain/src/files-tool.ts) and [session rules](../../packages/xiaojing/xiaojing-finance-domain/src/context.ts) | Use finance tools/rules without building module switching |

First separate business files within the existing package without changing the agent loop or prebuilding empty connector, rule-engine, or workflow packages. Split packages when responsibilities need independent evolution, with actual consumers implemented together. These finance capabilities must not alter Standard behavior.

## Current finance scope and ledger protection

This phase does not implement module switching, reimbursement connection decoupling, a bidirectional isolation framework, or reimbursement acceptance. Finance execution composes only necessary finance tools/adapters and never invokes reimbursement business execution; existing reimbursement data is neither deleted nor migrated into finance. Reimbursement designs below are references, not prerequisites.

Finance sessions, queries, materials, credentials, confirmations, and tasks bind an exact client/ledger. Recheck after client or configuration changes rather than selecting by duplicate names or a local test label. The backend rejects access outside the selected ledger, and ordinary logs/model output exclude secrets. These finance requirements need no new general multi-module framework.

## Finance flow and data: first implementation

Finance uses its own executor: resolve ledger and permitted reference data → prepare a voucher or other confirmed finance operation → deterministic validation → preview/confirmation → persist finance task → call finance API → read back → report verified and unresolved outcomes. Source and confirmation source identity may reuse utility code, not reimbursement business execution.

| Finance data | Minimum fields |
|---|---|
| Ledger references | Finance module, client, ledger ID, source origin/configuration revision, subjects and dimensions |
| Prepared finance record | Action, date/period, currency, lines or transaction fields, exact amounts, authorized source references |
| Finance task | Module/client/task ID, content hash, confirmation, external request ID, progress |
| Finance result | External record ID, field/state checks, safe error, unknown outcome, recovery evidence |

F1–F3 cover the confirmed finance scope, including required journal, account, receivable/payable, deletion, or write-off actions. Do not mark F4 complete by silently moving difficult required items into reimbursement work. Full module acceptance is defined in the development plan.

## One operation's flow

Materials and intent → client and reference checks → prepared content → confirmation → uploads and external write → readback → evidence-based result. Draft creation, draft editing, submission, and voucher creation are separate actions even if they use one underlying API.

A skill interprets intent, organizes materials, and asks questions. The backend selects client, credentials, origins, allowed actions, calculations, required fields, and execution order. The model cannot select arbitrary URLs, AppSecrets, external enterprises, or `pushOrderStatus`. Recorded events or tool results must reconstruct all model-visible progress and missing fields.

Do not re-ask established facts. Group missing purpose, department, or project questions; missing permission and unsupported components are implementation issues, not reasons to request a different invoice format. Preparation shows available fields and real gaps; changed business content requires new confirmation.

## Reimbursement data: deferred until R-stage

| Data | Initially required fields | Reason for separation |
|---|---|---|
| Source file | Client, source record ID, filename, hash, format, size, and controlled path | One invoice may have multiple images; one PDF may contain several invoices |
| Invoice facts | Invoice identity, amount, date, entities, source references, and review-required fields | Extraction is not a Youcheng invoice-pool record; do not invent missing invoice numbers |
| Fee line | Amount/currency, fee type, date, business fields, source and invoice references | Associate only that line's materials; no-invoice expenses are a distinct case |
| Prepared operation | Task ID, action, target client/ledger/enterprise, template fields, materials, configuration versions, and confirmation summary | Bind confirmation to exact content, not just an agreement word |
| Receipt | Task version, step, external request and bill IDs, completed uploads, verification, safe errors, and timestamps | Enable restart readback without relying on model memory |

Extend existing types and receipts before adding five independent stores. Use existing reproducible calculation methods with explicit precision, not model arithmetic or binary floating-point accumulation; count invoices and files separately. Define mappings only for supported components; selections come from the chosen client's live or still-valid reference data.

## Connection, permission, and settings

Each module stores its own HTTPS origin, credential reference, identity scope, and version. Isolate tokens by module, origin, and credential version and combine concurrent refreshes. Refresh expired tokens without automatically replaying unknown writes. Distinguish network, IP allowlist, credentials, permissions, environment, and incompatible responses without exposing secrets or tokens.

Local clients, finance ledgers, and reimbursement enterprises are distinct identities. Verify through APIs where possible; otherwise obtain explicit user confirmation of the mapping and display its limitations. Never guess the first or same-named record. Youcheng permissions still apply; a local product without login must not embed shared credentials in its installer.

The existing credential service owns secrets; logs, models, and ordinary frontend reads do not receive them. Attachment authorization covers specific originals and OSS uploads. Handle full bank accounts only in necessary controlled settings/execution paths, with redacted model data. Local feature switches control implemented and verified actions without creating a permission-management platform.

## Reimbursement attachments and invoices: R-stage only

Ordinary attachments: validate source ownership and unchanged bytes → upload to private OSS → backend generates short-lived HTTPS signed URLs → encode the URL array in `attachment.bindingVal` → save the draft. Preserve the verified order-level attachment route when metadata omits that field. When fee templates declare attachments, include only the corresponding line's original URLs.

Invoice pool: only when required, call invoice entry with authorized originals → save returned `invoiceIdList` → associate through the fee's `invoice` component → verify invoice/fee relations. Invoice entry is another write covered by preview authorization. Failure must not silently degrade to attachments-only while claiming invoice association.

Reuse verified uploads of the same original within a task. Re-sign expired links without recreating bills. Signed URLs stay out of chat and durable business logs; record object references and safe evidence instead. The model does not need URLs to report upload progress correctly.

Record evidence separately for upload completion, URL transmission, bill association, opening originals, and post-expiry access. If the API cannot read the bill's own attachments, a controlled UI check can evidence that test case but is not automated verification. Related-bill queries cannot replace own-bill attachment checks.

Determine whether Youcheng copies originals or stores URLs. If it stores URLs only, short-lived signatures cannot ensure long-term archive access. State this R1 acceptance gap, then select a supported vendor copy operation or an authorized persistent-access design. Do not make the Bucket public or claim that extending one URL's expiry solves retention.

## Task state, duplicates, and recovery

Reuse atomic writes, locking, and versioned persistence facilities, but give finance and reimbursement separate business receipts and module/client task indexes. Finance adds its own receipts during F2; reimbursement changes wait until R-stage. Recovery verifies module, client, identity, permissions, and configuration; it cannot search another module or enterprise. Preserve historical records and user files without requiring database migration.

| Execution outcome | Recovery |
|---|---|
| Pending confirmation/cancelled, with no external writes | Do not execute; prepare again after user changes, never guess around cancellation |
| Confirmed, business write not yet sent | Recheck relevant versions and continue permitted steps with confirmed content |
| Some steps completed | Preserve uploaded objects/invoice IDs/bill IDs and process only remaining steps |
| Write sent, outcome unknown | Reconcile using original request/bill IDs; absence is not automatically failure, and recreation is not automatic |
| Explicit failure | Explain the cause; retry only steps verified safe under their rules |
| Bill and required outcomes verified | Return the existing receipt; display unverified fields or attachments separately |

Use stable request IDs and content hashes for repeated calls to the same task; new tasks also check invoice identity and existing records within the client. File hashes detect repeated bytes, not business idempotency. Partial reimbursement requires amount and history checks rather than blanket rejection of repeated invoice numbers.

A local process lock cannot prevent another computer from creating a duplicate. Only verified vendor uniqueness/idempotency supports the corresponding external guarantee. Otherwise state local-only support and retain manual reconciliation for cross-device activity and delayed queries. Cancellation stops later actions without undoing existing bills or cloud files.

Before editing a draft, read its state and content, show differences, then use the qualified edit API. Without reliable external version checks, state the concurrency limit and recheck key fields rather than claiming optimistic locking. Explain non-editable states instead of creating replacement bills.

## Model and user results

Results include module, task ID, client, action, actual bill number, field checks, attachment checks, and next action. Generate success wording from these states; request acceptance, OSS upload, or URL transmission must not become a claim that Youcheng permanently retained attachments.

Expose typed business parameters and structured missing fields rather than the entire vendor catalog or arbitrary request bodies. Keep runtime-rule updates on session restoration so history does not retain obsolete instructions. Choose tool decomposition when implementing the business flow rather than creating one tool per API.

Lists and statistics include client, period, pagination, and completeness. If full data or required details are unavailable, describe the visible scope instead of reporting no anomalies. Professional compliance follows its separate product roadmap; required-field validation is not a compliance audit.

## Verification, release, and deferral conditions

Use focused tests for parameters, mappings, money, errors, and recovery; keyless real-product snapshots for tools and confirmation; authorized tenants for external state and attachments; and real models for language, questions, and cancellation. These layers complement each other; pure mocks do not establish external success.

Enable only accepted templates/actions per batch, retaining disable-new-write and readback controls. Redact test materials and keep originals and signed URLs out of the repository. Upgrades preserve clients, credentials, imports, and historical tasks. State-format changes require explicit reading/migration behavior rather than deleting old data for clean tests.

Extract shared execution only for an actual second consumer; evaluate a database only for real query-scale or concurrency needs; evaluate cloud services only for requested cross-device or offline-computer execution. Folder automation reuses available local scheduling or a minimal scan task rather than prebuilding an orchestration platform.
