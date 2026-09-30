# Youcheng Finance F4 acceptance

English | [中文](youcheng-finance-f4-acceptance.zh.md)

## Scope and completion

F4 currently delivers F4.1 in the [execution plan](youcheng-finance-execution-plan.md): qualify the approved non-report Finance capabilities together, retain explicit limitations, and obtain user acceptance. The six native ledgers/reports D01–D06 are deferred because the supplier provides no AppKey server API; they are not completion conditions for this delivery and must not be advertised as implemented. Internal work batches are not separate completed Goals.

## Autonomous checkpoints

| Order | Work | Completion criterion | Current state |
|---|---|---|---|
| G1 | Reconcile approved capability scope | Check CF01–CF28 evidence and limitations without treating deferred capabilities or synthetic tests as product acceptance | Current scope corrected |
| G2 | Combined F1–F3 regression | Current-code replay covers queries, analysis, creation, deletion, write-off, confirmation and persistence | 46 cases pass across15 Web files |
| G3 | Safety, recovery and real acceptance | Cover cross-client access, switching, cancellation, empty results, incomplete ranges, one-send behavior and restart recovery | Current combined and durable regressions pass; no new vendor write was required |
| G4 | Current-version delivery verification | F1–F3 combined regression, necessary release checks, isolated installation of the current package, evidence and limits; distinguish a same-version replacement from a formal upgrade | Current package, fresh install and same-version replacement pass; formal cross-version upgrade requires a version increment |
| G5 | Final user acceptance | The approved non-report capabilities are verifiable; deliver acceptance materials and obtain explicit user confirmation before completing the overall Goal | Depends on final evidence checks |

One persistent Goal covers all checkpoints without waiting for confirmation or replacing the Goal after each small step. Continue safe independent work; report missing new authority, login or external conditions without inventing completion evidence. Request user involvement only when necessary. Stop work when the user pauses; do not add scheduled wakeups, background model calls or polling-based continuation. Existing test-write restrictions and required safety confirmations remain unchanged. F3 issues001/002 stay deferred; issue004's parameter/source identity blocker is resolved by its minimal-request live adapter result.

The [F3 closeout](youcheng-finance-f3-closeout.md) is the starting evidence, not proof of complete Finance delivery. Reimbursement, actual bank payments and unqualified maintenance operations are excluded. Issues001 and002 remain deferred. Issue004's minimal voucher-deletion request has live adapter acceptance on dedicated voucher244499; browser-manual-origin remains unsampled and broader linked effects remain unqualified. Historical accepted or unknown write intents must not be resent.

D01–D06 are the general ledger, detail ledger, auxiliary ledger, balance sheet, income statement and cash-flow statement. The [public catalog](../../critique/f4-lab/official-finance-catalog-20260914.json) has no corresponding server endpoints; the [read-only AppKey probe](../../critique/f4-lab/f4-native-openapi-route-probe-messages-20260915.json) confirms that native website paths reject public-platform mapping or are not exposed. Neither the Chrome extension nor phone-based SSO is a product route for this delivery, and local grouping or calculation does not impersonate a native report. The [server API proposal](../../.agents/notes/proposed/feature/2026-09-15-native-finance-report-apis.md) defines the condition for resuming this work.

## Execution batches

The rejected Chrome-based report prototype was removed from the product source and preserved outside the repository with a hash manifest. Its historical fixtures and source captures remain research evidence only; they do not count as implemented capabilities or current regression coverage.

| Batch | Objective | Required evidence | State |
|---|---|---|---|
| W1 | Reconcile approved scope and evidence | CF01–CF28 mapped to inherited evidence and fresh checks; D01–D06 tracked separately as deferred | Scope corrected |
| W2 | Replay assembled Finance journeys | Actual application, browser, approval UI and persistence with mocked vendor transport; no reimbursement tests or paid model calls | Passed for the selected journeys |
| W3 | Verify isolation, restart and delivery readiness | Owner/configuration separation, accepted/unknown state retention, no repeated sends; clean installation and upgrade evidence distinguished from same-version reload | Combined regressions, clean installation and same-version replacement pass |
| W4 | Qualify remaining external observations and user delivery | Reuse valid evidence; bounded read-only checks or necessary synthetic writes only in authorized ledger 35616; explicit user acceptance | Evidence closeout in progress; no new external write required |

An independent batch continues when another depends on unavailable vendor information. Failed tests retain their original assertions and evidence until the cause is understood; refreshing expected outputs merely to obtain a pass is not acceptance.

## Capability evidence map

| Capabilities | Verification route | Qualification limits |
|---|---|---|
| CF01 | Connection UI, saved configuration and restarted isolated Host | A successful old connection does not authorize a changed ledger |
| CF02–CF04, CF16–CF17 | Reference queries and exact identity checks | Public account completeness and auxiliary enable state remain limited |
| CF05–CF07 | Voucher list/detail and balance journeys | Missing values remain unavailable; complete hierarchy and query scope must be explicit |
| CF13, CF18–CF19 | Journal and both open-item directions | Empty results, transport failure and summary rows are distinct |
| CF26–CF28 | Comparison, aggregation and exported workbooks | Supported dimensions only; no cross-currency totals or substitution for statutory reports |
| CF10–CF11, A01 | Voucher preparation, approval, single send, originals and recovery; [F2 audit](../../critique/f2-final-audit.json) | Historical PDF/PNG expiry checks are inherited evidence, not a new test or perpetual-retention guarantee |
| CF08–CF09, CF14, CF20–CF21 | F3A evidence plus assembled creation journeys | Supported configurations only; CF09 enable state remains unverified |
| CF12, CF15, CF22–CF25 | F3B evidence plus deletion/write-off journeys and durable records | CF12's minimal accountName/cerId request has live adapter acceptance on dedicated244499; browser-manual-origin and broader linked effects are not separately qualified; write-off remains base-currency full settlement only and is not an actual payment |
| D01–D03 | General, detail and auxiliary ledgers | Deferred and unavailable; no supplier AppKey server APIs, with no local grouping or browser substitute |
| D04–D06 | Balance sheet, income statement and cash-flow statement | Deferred and unavailable; no supplier AppKey server APIs, with no local calculation or browser substitute |

## Deferred native reports

This section retains only the evidence for the scope decision. D01–D06 remain 0/6 implemented and 0/6 accepted.

The [public catalog](../../critique/f4-lab/official-finance-catalog-20260914.json) lists 22 Finance APIs without dedicated entries for the six reports. The [HTTP-only probe](../../critique/f4-lab/f4-native-openapi-route-probe-messages-20260915.json) shows public-platform mapping failures for all six website-native paths, while `/finance` candidates are closed or absent. These paths are not AppKey APIs.

Work resumes only after Youcheng supplies supported server APIs: first qualify six AppKey operations and ledger binding, then integrate query ranges, pagination and native columns, and finally accept success, empty results, missing amounts, foreign-ledger rejection, timeout and interruption recovery. No browser-filter, extension-control or phone-based SSO experiments are part of that route.

## Test environment and evidence rules

Automated Web acceptance uses isolated temporary harness homes and synthetic vendor responses. It must not change the user's saved ledger, credentials or model sessions. Store re-instantiation proves same-format retention, not old-version upgrade compatibility. A restarted assembled Host proves more than a store unit test, but does not establish packaged desktop installation.

Real vendor writes, if needed, are serial and limited to newly identified synthetic objects in ledger 35616. Required product confirmations remain active. Do not create business records to discover unknown account IDs, modify existing records to infer enable state, or replay consumed F3 samples. Keep raw evidence separate from credentials and signed URLs.

## Remaining completion conditions

The fresh current-code run records 46 passing assembled tests across 15 Finance files, 221 durable-record/store tests and 137 Host tests. The isolated 0.1.9-to-0.2.3 data compatibility check passes. These are different verification layers, not 404 real business transactions. F1's six workbooks and ten receipts, eleven external F2 files, twenty F3 evidence files and eight F3 code-checkpoint files retain their saved evidence. This closeout changed product configuration checks and documentation but performed no Youcheng business write.

Fresh combined regression, cross-context isolation, installed-delivery qualification, evidence reconciliation and user acceptance must all be accounted for. The six native ledgers/reports are explicitly deferred and unavailable: they do not pass, but they do not block the remaining F4 closeout. Passing these scoped tests cannot establish production release readiness.

The [delivery-readiness receipt](../../critique/f4-lab/delivery-readiness-20260914.json) records the earlier build checkpoint. The current September15 package is built separately while the August30 installer remains at its original standard path. Package-internal Host boot, a real current-user fresh install/uninstall and an August30-to-current same-version replacement all pass; installed key files match the current package, settings and credentials remain byte-identical, and the running development application is unaffected. Because both installers declare version0.2.3, the replacement is not a formal cross-version upgrade. A distributed release must increment the desktop version and repeat that upgrade test.
