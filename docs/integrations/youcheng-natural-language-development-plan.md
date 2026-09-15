# Youcheng finance development overview

English | [中文](youcheng-natural-language-development-plan.zh.md)

## Decision and current scope

Current planning covers Youcheng finance only, without developing, refactoring, or scheduling reimbursement or requiring a dual-module isolation project. Preserve existing reimbursement data; finance calls finance APIs and shared authentication only, without entering reimbursement flows. Identity, data, credentials, and operation scoping between clients/ledgers remain finance requirements.

This turn authorizes a plan revision, not feature implementation or external writes. Any future reimbursement work and its organization require a separate user decision; finance acceptance does not start it automatically.

## Document responsibilities and existing evidence

The [itemized execution plan](youcheng-finance-execution-plan.md) is the sole executable inventory of feature IDs, dependencies, specific Goals, and completion conditions. The [F0 findings](youcheng-finance-f0.md) retain official catalog and read-only evidence, the [capability matrix](youcheng-capability-implementation-matrix.md) provides API scope references, and finance sections of the [implementation design](youcheng-implementation-design.md) supply implementation constraints. Reimbursement and dual-module architecture entries in companion documents are deferred references, not current development or acceptance work.

Existing code includes client binding, finance connection, voucher queries, and file capabilities; the [Finance Host](../../packages/xiaojing/xiaojing-finance-domain/README.md) owns actual behavior. Inspect implementation and tests before each Goal and close gaps rather than rewriting. Successful examples, callable endpoints, and complete business capabilities are distinct.

F0.1 technical investigation is complete; F0.2 still requires user decisions on core features, conditional reports, and finance attachments. The designated test ledger is 35601 (数豆测试帐套勿删) on a production service, not an independent sandbox; never delete it. A test label does not authorize unknown writes or data effects.

## Phases and sequence

| Phase | Delivery focus | Execution rule |
|---|---|---|
| F0 | Scope confirmation, recoverable development baseline, test plan | Reuse F0.1 rather than repeating the full investigation; authorize data writes separately |
| F1 | Connection, references, voucher/balance/journal/open-item queries, comparison/export | Accept complete, accurate business results; T01 separately prepares populated data |
| F2 | Voucher preparation, confirmation, creation, recovery | Preparation does not write; creation includes durable records and actual readback |
| F3A | Create journals, receivables, payables, subjects, auxiliary items | Deliver each action separately; missing references never trigger automatic creation |
| F3B | Delete vouchers/journals/open items; write off receivables/payables | Exact objects, fresh state, impact confirmation, verification; not actual payment |
| F4 | Finance user scenarios and delivery acceptance | Every approved item and exception is explicit; completion requires user acceptance |

A phase is not one giant Goal. The execution plan splits 10 categories into 28 core features, each mapped to a specific Goal with dependencies and acceptance. Six books/reports and finance attachments undergo separate qualification; missing APIs neither silently remove requirements nor justify claiming official statements reconstructed from balances.

## Minimal implementation principles

The model interprets intent; the backend controls clients/ledgers, finance APIs, permissions, parameters, calculation, and execution order. Reuse existing Cordis composition and useful file, credential, calculation, confirmation, and receipt facilities rather than building new login, a workflow DSL, universal API tools, module switching, or empty plugins.

Feature Goals include backend, natural-language tools, necessary UI, tests, and documentation as complete outcomes. Sufficient existing UI does not need another operations center. Qualified queries precede controlled creation and high-risk maintenance; extra APIs or browser adapters require evidence and scope authority first.

Before any business write, fix the ledger, validate inputs, obtain matching confirmation, and persist before sending. Reconcile unknown results rather than blindly retrying or switching creation APIs. Cancellation stops later actions without undoing existing records. Without vendor evidence, promise neither cross-device exactly-once behavior, concurrency locking, nor reversal.

## Acceptance and next action

Feature acceptance records real external data, pagination/totals, amounts/states, focused tests, real-product keyless snapshots, and failure/cancellation/retry/restart behavior. F4 reuses that evidence and checks combined scenarios, client/ledger scoping, clean-install configuration, and upgrade data preservation. HTTP success, empty examples, or report generation are not business acceptance.

Next confirm the itemized inventory in F0.2, establish F0.3 development/test baselines, then start F1.1 finance connection and ledger identity. Revising the plan does not create a Goal; later execution follows the approved sequence, pausing for scope expansion or new external-operation authority.
