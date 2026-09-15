# Youcheng capability scope and API qualification matrix

English | [中文](youcheng-capability-implementation-matrix.zh.md)

Current scope is finance only, without reimbursement or a dual-module isolation project. The [itemized execution plan](youcheng-finance-execution-plan.md) defines current Goals; reimbursement and dual-module entries below are deferred references, not development or acceptance prerequisites. Preserve reimbursement data, exclude reimbursement APIs from finance execution, and still enforce client/ledger access scope.

## Sources and use

This matrix is a scope reference for the [development plan](youcheng-natural-language-development-plan.md), not a shipped tool catalog. Official material has separate [reimbursement](https://yiqbopenapi.superboss.cc/#/share/7YX0lXxR) and [finance](https://yiqbopenapi.superboss.cc/#/share/awXPk8nW) catalogs. The 2026-09-05 check found 67 and 45 leaf entries respectively, with overlap; these are not 112 independent APIs. The [local mirror](youcheng-openapi-replica.json) contains reimbursement material. The [F0 findings](youcheng-finance-f0.md) record the 2026-09-07 finance catalog reread and test-ledger results, identifying the 22 finance paths and report gaps; they are not a complete source mirror or acceptance of every endpoint. Reimbursement qualification remains deferred.

Record documented support, implemented code, live-example success, and acceptance within a specified scope separately. None substitutes for another. Keep actions disabled when permissions, templates, transitions, or result verification are unresolved. Current implementation covers connection, voucher queries, limited reimbursement drafts, and related support; see the [Finance Host](../../packages/xiaojing/xiaojing-finance-domain/README.md).

## Business coverage and delivery order

| Module ownership | Business area | Actions to qualify | Development and acceptance |
|---|---|---|---|
| Finance | Connection/ledgers | Authentication, ledger selection, identity and permissions | F0/F1; independent of reimbursement |
| Finance | Subjects/dimensions/balances | Required reads, calculations, and supported maintenance | F1/F3; evaluate all scope in F0 |
| Finance | Vouchers | List/detail/proposal/create and required maintenance | F1/F2/F3; posting or approval needs separate evidence |
| Finance | Journals/cashier accounts | Accounts, categories, cashiers, transaction queries and writes | F1/F3; high-risk maintenance separately confirmed |
| Finance | Receivables/payables | Queries, creation, write-off/deletion where supported | F1/F3; required items complete before F4 |
| Finance | Full acceptance | Functional scope, client/ledger protection, recovery, documentation | F4 requires user acceptance; reimbursement is outside this phase |
| Reimbursement | Enterprise, staff, departments, templates | Separate authentication, configuration, and reference queries | R0/R1; no finance credentials or configuration dependency |
| Reimbursement | Bills and applications | Queries, drafts, edits, qualified submission, loan/payment applications | R1/R2; an application is not bank payment |
| Reimbursement | Originals and invoice pool | Ordinary attachments, invoice entry, fee association, retention | R1/R2; independent records and authorization |
| Reimbursement | Projects, auxiliary forms, cost centers | Required reads and separately qualified maintenance | R0/R2; do not reuse same-named finance objects |
| Reimbursement | Budgets, funds, payees, roles | Reads and supported maintenance in the reimbursement catalog | R0/R2; role and account changes separately controlled |
| Reimbursement | Batches and folder tasks | Scans, grouping, duplicate checks, recoverable bill actions | R3/R4; no finance task execution |
| Shared infrastructure only | Client master data, secret storage, file transport, logging | Reusable facilities with module-scoped records and permissions | No shared business credentials, data access, tasks, or confirmations |
| Cross-module | Bill/voucher association or result synchronization | Not enabled in this proposal | Separate future authorization and exchange design required |

This table groups business areas and does not claim endpoint-by-endpoint qualification. Reimbursement paths in the finance catalog still require case, version, and parameter checks; matching names are insufficient for deduplication. Requirements without an identified official API remain pending vendor confirmation rather than receiving invented tools.

## API semantics requiring correction

| Document or action | Known semantics and development requirement |
|---|---|
| Reimbursement journal query `BXgRxZ8G` | Omitting `status` in `/reimburse/journal/queryListPage.rjson` changes queried records' state; read-only actions fix a verified value |
| Reimbursement voucher query `nzdZkM8j` | `/reimburse/certificate/queryListPage.rjson` also conditionally writes; it is not the current finance voucher-list endpoint |
| Bill creation `Zd2qAr2w` | `pushOrderStatus` distinguishes drafts, approval-flow matching, immediate completion, and editing semantics; backend actions select it, not arbitrary model input |
| Payment/voucher/journal callbacks | Documents give outbound request paths to Youcheng; do not automatically design inbound Webhooks. Qualify direction, permissions, and business effects |
| Related bills `pX9mPjXr` | Returns related records, not the queried bill's own attachment details; empty relations do not prove missing attachments |
| Bill state `kXODV7zD` | Queries specific bills rather than a state dictionary; qualify codes per endpoint |
| Invoice entry `wXnr7YX9` | Use returned `invoiceIdList` in the bill's `invoice` component; ordinary attachment URLs are not invoice IDs |
| Finance creation `K2ZGNd8v`/`xXaMy0Xo` | Qualify `flowId`, `appId`, returned voucher information, and duplicate behavior; do not switch endpoints after an unknown result |
| Finance/reimbursement authentication | Current adapters handle a token string and an object containing `accessToken` separately; identical auth paths do not imply identical parsing |
| Finance test origins | Both configured environments currently default to the same production origin; a test label proves no isolation, and documented HTTP examples cannot transport credentials |

## First-batch qualification records

For each required endpoint, record official document ID and update time, module/version, method and exact path, HTTPS origin and identity scope, necessary parameters, pagination and limits, response fields, errors and effects, external IDs, duplicate/timeout recovery, readback, evidence, and enabled status. Cite existing sources rather than copying entire documents.

F0 inventories the complete finance scope first and identifies required items, exceptions needing user agreement, and unsupported APIs. Implement finance-only dependencies by business flow. Reimbursement discovery, templates, invoice entry, and bill writes are not finance prerequisites; start them only after F4 acceptance. A working voucher example does not complete finance.

Vendor idempotency, attachment retention, bill editing, and identity remain unverified until confirmed. A local test raises evidence only for its action, not the entire catalog.
