# Youcheng finance: feature inventory and executable Goals

English | [中文](youcheng-finance-execution-plan.zh.md)

## Scope and use

This is a finance execution proposal awaiting confirmation, not a shipped-feature list or write authorization. It owns feature IDs, dependencies, Goals, and acceptance; the [F0 findings](youcheng-finance-f0.md) own API sources and observed evidence, and the [overall plan](youcheng-natural-language-development-plan.md) owns product scope. This document replaces F0's coarse execution candidates; F0.1 read-only findings remain evidence, not new development credit.

This phase develops finance only. It neither develops, refactors, nor schedules reimbursement, and does not build module switching, a bidirectional isolation system, or reimbursement acceptance. Finance uses qualified finance APIs and shared authentication only; remove reimbursement tool composition from the finance entry where necessary without clearing existing reimbursement data. Correctly scoping data, credentials, and operations to each client/ledger remains a finance requirement.

Deliver business outcomes, not endpoint or tool-button counts. Candidates comprise 10 categories and 28 core features, six conditional book/report requirements, and one finance-attachment qualification item. Filters, error branches, and safety checks are not extra features; report gaps are not implicit exclusions. Single sign-on, editing/audit/posting/closing without clear finance APIs, and actual bank payments are outside the core inventory.

Every feature initially requires a gap assessment; reuse existing connection, voucher-query, and file capabilities. Before starting, inspect code and tests and distinguish reusable behavior, defects, missing behavior, and external dependencies rather than rewriting existing features for progress credit. This plan does not create or activate Codex Goals.

## Core feature inventory

The table describes target behavior, not completed integration. API means the finance evidence in F0; local means Xiaojing processing authorized, complete data. Directions sharing creation or write-off endpoints receive separate acceptance. Before each Goal's first implementation, qualify exact documentation paths, request/response examples, and verification using F0 document IDs rather than guessing APIs.

| ID | Core category | Final feature | Basis | Delivery Goal |
|---|---|---|---|---|
| CF01 | Ledger and reference data | Query and verify ledger ID/name | API | F1.1 |
| CF02 | Ledger and reference data | Query subjects, hierarchy, and enabled status | API | F1.2 |
| CF03 | Ledger and reference data | Query auxiliary categories | API | F1.2 |
| CF04 | Ledger and reference data | Query auxiliary items by category | API | F1.2 |
| CF05 | Voucher queries | List vouchers with qualified filters | API | F1.3 |
| CF06 | Voucher queries | Inspect a specified voucher's entries and returned business fields | API | F1.3 |
| CF07 | Subject balance report | Query period/subject balances and movements, separating totals | API | F1.4 |
| CF08 | Reference-data creation | Create a subject after confirmation | API | F3.4 |
| CF09 | Reference-data creation | Create an auxiliary item after confirmation | API | F3.5 |
| CF10 | Voucher creation | Prepare, validate, and preview a voucher from explicit inputs and readable materials | Local | F2.1 |
| CF11 | Voucher creation | Create, read back, and reconcile unknown outcomes after confirmation | API + local | F2.2 |
| CF12 | Voucher deletion | Delete a specified voucher after confirmation and verify | API | F3.6 |
| CF13 | Journal management | Query transactions, accounts, and directions | API | F1.5 |
| CF14 | Journal management | Create receipt/payment transactions after confirmation | API | F3.1 |
| CF15 | Journal management | Delete a specified transaction after confirmation | API | F3.7 |
| CF16 | Cashier reference data | Query cashier accounts | API | F1.2 |
| CF17 | Cashier reference data | Query receipt/payment categories | API | F1.2 |
| CF18 | Receivables/payables | Query receivables and balances | API | F1.6 |
| CF19 | Receivables/payables | Query payables and balances | API | F1.6 |
| CF20 | Receivables/payables | Create a receivable after confirmation | API | F3.2 |
| CF21 | Receivables/payables | Create a payable after confirmation | API | F3.3 |
| CF22 | Receivables/payables | Delete a specified receivable after confirmation | API | F3.8 |
| CF23 | Receivables/payables | Delete a specified payable after confirmation | API | F3.9 |
| CF24 | Receivables/payables | Write off a specified receivable after confirmation | API | F3.10 |
| CF25 | Receivables/payables | Write off a specified payable after confirmation | API | F3.11 |
| CF26 | Comparison and output | Compare periods within one ledger, currency, and accounting basis | Local | F1.7 |
| CF27 | Comparison and output | Aggregate complete query results over supported dimensions | Local | F1.7 |
| CF28 | Comparison and output | Export verified results to local Excel | Local | F1.8 |

## Conditional requirements, not claimed support

| ID / Goal | Requirement | Implementation prerequisites and acceptance |
|---|---|---|
| D01 | General ledger | Obtain a finance API or verified parameter variant; compare a populated period with Youcheng's ledger |
| D02 | Detail ledger | Obtain complete entries and opening/movement/closing values; verify pagination and ordering |
| D03 | Auxiliary books | Obtain real dimensions and record relationships; verify combinations/totals without name-based inference |
| D04 | Balance sheet | Obtain official querying and accounting-standard/period semantics; compare each item with Youcheng |
| D05 | Income statement | Obtain official querying and current/cumulative semantics; compare each item with Youcheng |
| D06 | Cash flow statement | Obtain official querying and item attribution; compare each item with Youcheng |
| A01 | Finance voucher originals | Qualify finance attachment fields, upload authority, association/readback, and retention; reimbursement attachment rules are not evidence |

Each item first gets a qualification Goal producing sources, required fields, examples, and a clear conclusion. Sufficient evidence and user inclusion in delivery scope then permit a separate implementation Goal; qualification cannot count as delivery. Investigations may interleave with unrelated capabilities, and missing evidence does not block independent finance work. A required item still blocks F4 unless the user explicitly accepts its deferral or exclusion.

CF10 can read images/files supported by existing capabilities and propose a reviewable voucher; that does not save originals to Youcheng. Establish A01's requirement status before F2.1. Never silently omit or claim unverified original association. If implemented, prove upload, association, opening, and retention after temporary-link expiry separately; OSS upload is not Youcheng attachment completion.

## Execution order and redefined Goals

Retain F0–F4 phase meanings and the work-unit IDs below. For the user-approved autonomous continuation of F1, one active Codex Goal covers the remaining F1 work and acceptance; F1.6–F1.8 remain internal checkpoints, not replacement Goals. Record progress and evidence in the [development status](youcheng-finance-development-status.md), continue eligible work without ending the Goal at each checkpoint, and complete it only after its full acceptance criteria pass. Dependencies and external-write authority remain unchanged. Reuse acceptance evidence only after checking it, not by inheriting completion status.

### F0: scope and recoverable baseline

| Goal | Objective and dependencies | Completion condition |
|---|---|---|
| F0.2 Feature-scope confirmation | Fix included CF01–CF28 items and the status of D01–D06/A01 | User confirms required, unverified, and deferred items; every item has a Goal and verification; development and external-write authority are recorded separately |
| F0.3 Development/test baseline | After F0.2, preserve a recoverable checkpoint of existing edits and prepare data/checklists | Preserve edits without copying secrets into the repo; record actual origin, 35601, available testing, and recovery; fixtures remain proposals, not business writes |

F0.1 already has read-only findings; do not repeat the full investigation. Qualify journal parameters, subject completeness, and other unresolved details within their owning Goal rather than retraversing all APIs.

### F1: connection, queries, and output

| Goal | Objective and dependencies | Completion condition |
|---|---|---|
| F1.1 Finance connection and ledger identity | CF01; requires F0.2/F0.3 | Reconnect after restart without resaving settings; verify ID/name; display ledger and green status only after success; distinguish network, allowlist, authentication, and permission errors; client/configuration changes cannot reuse incorrect state |
| F1.2 Usable reference data | CF02–CF04/CF16–CF17; requires F1.1 | Verify subjects, auxiliary categories/items, accounts/categories separately; establish pagination/limits; preserve hierarchy and disabled status; never guess duplicate names or auto-create missing entries |
| T01 Populated test data | Test support, not a business feature; requires F1.1/F1.2 and seeding authority for the designated test ledger | Prepare required examples and master data within authorized scope through Youcheng UI or external one-off scripts; record before/after baselines and real IDs, independently verify expected values, and use only verified data for acceptance |
| F1.3 Voucher query loop | CF05/CF06; requires F1.2 and T01 vouchers for live acceptance | Natural language reaches lists/details; correct filters and complete pagination; entries, amounts, and periods match Youcheng; empty and failed results differ |
| F1.4 Subject balance loop | CF07; requires F1.2 and T01 balances | Verify nonzero opening/movement/cumulative/closing fields and directions; do not double-count totals; incomplete data reports limits rather than no anomalies |
| F1.5 Journal query loop | CF13; requires F1.2 and T01 journals | First isolate parameter dependencies and array-element meanings; then verify accounts, directions, amounts, pagination, business rows, and totals |
| F1.6 Receivable/payable query loop | CF18/CF19; requires F1.2 and T01 open items | Compare each direction with Youcheng; zero placeholders/totals are not business records; relationships and balances match |
| F1.7 Comparison/aggregation | CF26/CF27; requires acceptance of consumed queries | Initially cover supported dimensions of verified balances and journal/open-item data; state ledger, period, currency, basis, completeness; reproduce calculations; no direct cross-currency addition |
| F1.8 Excel output | CF28; requires acceptance of exported queries/aggregations | Initially cover the accepted results above; columns, precision, counts, filters, totals match; show source/scope, handle formula injection, and exclude secrets |

T01 uses the user's continuing authority for necessary development data in ledger 35601 recorded in the [development status](youcheng-finance-development-status.md), without per-record confirmation. Prepare minimal examples for acceptance gaps rather than bulk seeding. Before its first write, a chosen script must enforce ledger 35601, fixed examples and a verified usable period, recording intended values, stable example IDs and local receipts. Reuse matching entries, never retry unknown sent writes, stop after a failure, and never auto-delete. Use existing Youcheng UI or external one-off scripts; do not build data generation into Xiaojing. This test ledger is on a production service; a test label is not a safety guarantee.

Test data covers nonzero values, receipt/payment directions, receivables/payables, business rows/totals, and reproducible period differences; cross-period examples require two confirmed usable periods. Small page sizes can test pagination without bulk bookkeeping. Qualify when voucher state affects balances rather than automatically auditing, posting, or closing to produce report figures. Calculate expectations independently from fixed examples, not using the API under test as its own answer.

Query development may start with mocks and empty examples, but missing populated live evidence means awaiting integration, not Goal completion. T01 does not depend on unfinished general creation features, avoiding circular query/write acceptance dependencies. Missing seed authority remains an explicit dependency rather than permission to write production data.

### F2: voucher creation loop

| Goal | Objective and dependencies | Completion condition |
|---|---|---|
| F2.1 Preparation/confirmation preview | CF10; requires F1.2/F1.3 and an explicit A01 decision | Trace inputs/materials; validate real subjects, dimensions, date/period, currency, amounts, and balanced entries; ask only for genuine missing facts; edits invalidate confirmation; no Youcheng write in this Goal |
| F2.2 Creation, verification, recovery | CF11; requires F2.1/F1.3, using F1.4 for balances | Persist after preview/confirmation and before sending; read back the exact voucher/entries; handle duplicates, cancellation, configuration changes, restart, and lost responses explicitly; do not switch creation APIs after unknown results |

Implement minimal confirmation and receipts within F2.2's concrete operation, reusing proven utilities for later writes rather than prebuilding a workflow engine. Record uncertain vendor deduplication/readback guarantees; if absence of a write cannot be proven, preserve the unknown result for human reconciliation rather than promising cross-device exactly-once behavior. Creation is not approval, posting, or closing.

### F3A: other creation features

| Goal | Objective and dependencies | Completion condition |
|---|---|---|
| F3.1 Create journals | CF14; requires F1.5 and F2.2 write protection | Preview/read back receipt and payment accounts, categories, dates, directions, and amounts separately; no automatic voucher creation |
| F3.2 Create receivables | CF20; requires F1.6 and write protection | Establish counterparties, receivable direction, amounts, and required relationships; verify created records and balances |
| F3.3 Create payables | CF21; requires F1.6 and write protection | Independently validate payable direction/fields; verify records/balances without inheriting receivable test conclusions |
| F3.4 Create subjects | CF08; requires F1.2 and write protection | Check parent/code/name and actual required fields, confirm, create, and requery; handle duplicate names/codes and effects on existing data explicitly |
| F3.5 Create auxiliary items | CF09; requires F1.2 and write protection | Obtain category/required attributes from the ledger; cover duplicate checks, confirmation, creation, and readback; no automatic historic voucher changes |

Reference creation is not a default fix for voucher gaps. A genuine need for new subjects/items can advance the corresponding Goal after dependencies pass; otherwise use existing references rather than creating subjects for demonstration.

### F3B: high-risk maintenance, accepted separately

| Goal | Objective and dependencies | Completion condition |
|---|---|---|
| F3.6 Delete vouchers | CF12; requires F1.3/F2.2 | Exact ID, fresh state, impact preview, explicit second confirmation, deletion, independent verification; permission/network errors never prove deletion |
| F3.7 Delete journals | CF15; requires F1.5/F3.1 | Identify exact transaction/state; confirm, delete, requery, verify related balances; no linked voucher deletion |
| F3.8 Delete receivables | CF22; requires F1.6/F3.2 | Verify relationships/state, confirm deletion, and check record/balance effects without clearing unrelated items |
| F3.9 Delete payables | CF23; requires F1.6/F3.3 | Test independently from receivables; verify exact deletion/balance; do not resend unknown writes |
| F3.10 Write off receivables | CF24; requires F1.6/F3.2 | Qualify parameters, eligible states, and effects; preview amount/objects, confirm, verify state/remaining balance; do not claim actual receipt of money |
| F3.11 Write off payables | CF25; requires F1.6/F3.3 | Independently verify state/balance; reject excess/duplicate actions under qualified rules; do not claim bank payment |

Separately authorize test objects for each destructive action; seed approval is not deletion/write-off approval. Missing vendor state/concurrency guarantees require disclosed limits and fresh pre-write reads, not invented locking or reversal. Partial write-off, reversal, and offsetting are not automatically included merely because a write-off API exists.

### F4: full finance acceptance

On 2026-09-14 the user explicitly included all D01–D06 in this delivery. Source qualification, product integration and individual acceptance follow the [F4 record](youcheng-finance-f4-acceptance.md), not a deferred report project.

| Goal | Objective and dependencies | Completion condition |
|---|---|---|
| F4.1 User scenarios and delivery acceptance | All approved core and conditional items | Complete scenarios, client/ledger separation, errors/cancellation/duplicates/recovery, upgrade preservation, and clean-install configuration pass; every item has sources, focused tests, real-composition keyless snapshots, and required external evidence; user explicitly accepts |

F4 reuses feature evidence and checks combined regressions rather than reinventing acceptance. Missing required reports, unverified attachments, unknown writes, or absent user acceptance prevent a finance-complete claim. Expose accepted actions only and allow new writes to be disabled while retaining queries/recovery. F4 does not start reimbursement.

## Execution agreement for each Goal

A Goal includes adapters, backend validation, business tools, natural-language rules, necessary UI, tests, and documentation, not mutually waiting frontend/backend deliveries. The model interprets intent; the backend controls ledgers, allowed paths, parameters, calculation, and execution. Do not expose arbitrary URL/body tools. Reuse sufficient existing pages, and do not automatically replace missing APIs with browser automation.

At start record six items: feature IDs/objective, dependencies/evidence, allowed change scope, exclusions, test data/external authority, and completion criteria. At finish record actual files/commands, external verification, remaining limits, and the next Goal. Track pending development, developing, awaiting integration, awaiting user acceptance, accepted, or dependency-blocked; code presence, HTTP success, tests, and business acceptance are separate claims.

Execute one Goal at a time by default; independent read-only qualification may run in parallel while business writes remain serial. Continue in the approved sequence after completion; pause for scope changes, missing external authority, or new high-risk actions rather than requesting permission again for each already authorized implementation step. This turn revises the plan only and starts no listed Goal.

## Recommended starting point

Continue the active [F4 acceptance](youcheng-finance-f4-acceptance.md), using the [F3 supported-scope closeout](youcheng-finance-f3-closeout.md) and [development status](youcheng-finance-development-status.md). Do not restart F0/F1 or replay consumed F3 test operations. Keep deferred account discovery, auxiliary enable-state and manual/external source identity visible. Reconcile required D01–D06 reports and A01 attachment evidence before claiming overall Finance completion; existing single-capability tests do not replace combined delivery acceptance.
