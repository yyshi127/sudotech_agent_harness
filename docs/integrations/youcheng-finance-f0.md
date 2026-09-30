# Youcheng finance F0: scope, read-only checks, and test preparation

English | [中文](youcheng-finance-f0.zh.md)

## Status and authority

Technical F0 findings dated 2026-09-07. The user designated ledger `35601` (数豆测试帐套勿删). This investigation authenticated with that record's saved finance credentials and performed queries only; it did not create, modify, delete, or write off business records, change client bindings or credentials, or modify application code. F0.1 has technical findings; F0.2 still requires user confirmation of required scope, write examples, and destructive-test authority. This is neither full F0 acceptance nor authorization to start F1.

## Local baseline

The branch is `codex/finance-f1-2`, with HEAD `xiaojing-history-20260930-6`. Existing uncommitted changes mean HEAD cannot reproduce the full working state. This investigation did not commit, reset, clean, or copy credential-bearing configuration into the repository. A recoverable checkpoint of uncommitted work remains necessary before code development.

The local client is displayed as 数豆科技, a name shared by other records; exactly one record binds `35601`. The server uniquely matched the ID and returned 数豆测试帐套勿删. Never select the first matching display name or another ledger. Renaming the local test client for clarity is recommended for the user; no rename was performed.

Requests used `https://cwdata.yiqiyun.com`. The local environment field says `test`, but the documentation lists this origin as V2 production. This is a designated test ledger on a production service, not a verified isolated sandbox. Every read and write must explicitly constrain its ledger. Never delete the test ledger itself.

## Sources and evidence levels

The official [finance catalog](https://yiqbopenapi.superboss.cc/#/share/awXPk8nW) was successfully reread: 45 leaf entries, comprising 22 finance paths, 22 reimbursement paths, and one authentication endpoint. Reimbursement paths are excluded from finance implementation. Catalog presence, documented fields, read-only responses, nonempty business validation, and full acceptance are distinct evidence levels; none automatically establishes another.

The probe period was `2026-09`, not a confirmed writable period or proof that every historical period is empty. Only safe field structures and aggregate evidence are recorded, not tokens, AppSecrets, complete responses, or external personal information.

## Actual read-only results

| Query | Result | Limits and acceptance requirements |
|---|---|---|
| Authentication and ledger list | Code 100; unique name match for 35601 | Proves this identity/query check only, not write permissions |
| Subjects | pageSize=100 returned 100; 1000 returned 191 | The first 100 are not complete; limits and completeness still need validation |
| Auxiliary categories | Code 100; six entries | Per-category auxiliary items were not probed |
| Journal accounts | Code 100; three entries | Maintenance and write permissions untested |
| Receipt/payment categories | Code 100; 16 entries | Preserve actual category/direction mappings instead of guessing |
| Subject balances | Code 100, success=true, count=0, but list contains a period-total row | A total is not a business subject; nonzero amount semantics remain untested |
| Voucher list | Code 100, success=true, empty list for the selected month | Real voucher details and all historical data remain untested |
| Journal list | Initial parameters including accountName and periodNumber returned 100 and a two-element array; omitting both returned 201 | Two variables changed, so neither can yet be declared mandatory; isolate parameters next and clarify array elements |
| Receivables and payables | Both directions returned 100, count=0, with one zero-amount row each | Do not count these as business records; an id alone does not establish a business row |

Balance row fields include `periodInitialBorrow/Loan/Balance`, `periodThisBorrow/Loan/Balance`, `periodYearBorrow/Loan/Balance`, `periodFinalBorrow/Loan/Balance`, and subject fields. Approved nonzero examples must validate direction, net values, cumulative values, and totals; names alone do not establish accounting semantics.

## Candidate finance scope and endpoint evidence

This table awaits user scope approval; it is not a shipped capability list. Document links belong to the finance catalog. No documented write was executed here.

| Capability | Official document IDs | Status and treatment |
|---|---|---|
| Ledger, subject, auxiliary category/item queries | nzdWQBXj / bXKD5az7 / e24o3lzL / VXELjN8v | Safe read examples except auxiliary items; target F1 |
| Voucher list and detail | aXYwLJ2r / K8MVy7Xl | Empty list passed; details need populated testing |
| Subject balance report | [a260dVXl](https://yiqbopenapi.superboss.cc/#/share/awXPk8nW/a260dVXl) | Response fields obtained; priority report query |
| Create subjects and auxiliary items | kXOgpbXD / YX0wJR8x | Documented maintenance candidates; never auto-create to bypass missing fields |
| Create vouchers | K2ZGNd8v / [xXaMy0Xo](https://yiqbopenapi.superboss.cc/#/share/awXPk8nW/xXaMy0Xo) | Qualify each separately; never switch endpoints after an unknown write |
| Delete vouchers | B2lGrmzD | Separate confirmation, state check, and result verification |
| Query, create, and delete journals | L2yPGEzm / xXaZ4Yzo / V2JRL72y | Query parameter dependencies remain; accept writes separately |
| Query accounts and receipt/payment categories | q2REAOzg / nzDO4yXp | Safe read examples obtained |
| Query, create, delete, and write off receivables/payables | ez7dJ32a / B2llxm2D / aXYejJXr / Q2VMdJze | Queries contain zero rows; write-off is not actual payment |
| Finance single sign-on | 58paodX3 | Documented but not a current required-scope candidate; no login link generated |
| General ledger, detail ledger, and auxiliary books | No explicit independent endpoint found; balance parameters contain related flags | Separate qualification/vendor questions, not promised complete support |
| Balance sheet, income statement, cash flow statement | Not found in the current public catalog | Retain requirements pending endpoints; do not rebuild official statements |
| Voucher editing/audit/posting/close, account and subject editing/deletion | No explicit corresponding finance endpoints found | Never substitute reimbursement endpoints; exclude from confirmed implementability |
| Comparison, aggregation, local Excel export | Xiaojing local composition | Requires complete comparable data; distinct from vendor-native reports/exports |

## Phased Goals and acceptance

The [itemized execution plan](youcheng-finance-execution-plan.md) owns feature definitions, dependencies, Goals, and completion conditions. This record retains F0 findings and unexecuted example proposals, not subsequent feature delivery status. Current development covers finance without reimbursement or a dual-module isolation project; client/ledger scoping and finance API ownership still require verification.

## Simulated data proposal: not written

Proposed summary prefix: `XJ-F0-35601`. Dates tentatively use 2026-09 pending writable-period confirmation. These are API/calculation fixtures, not complete accounting examples or real tax judgments. Voucher, journal, and receivable/payable examples are accepted separately; never generate vouchers through multiple paths for the same event.

| Example | Proposed input | Expected verification |
|---|---|---|
| V01 Cash/bank transfer | Debit cash 1000, credit bank 1000 | Two entries totaling 1000 per side; corresponding subject movements increase by 1000 relative to baseline |
| V02 Synthetic income | Debit bank 2000, credit operating revenue 2000 | Two entries totaling 2000 per side; explicitly synthetic and without tax judgment |
| J01 Synthetic journal | One receipt of 120 and one payment of 20 on a verified account | Net movement 100; verify account/categories; do not generate vouchers |
| AR01 / AP01 | One fictional receivable of 300 and payable of 200 | Separate records with correct directions/balances; no write-off this round |
| Negative and recovery cases | Unbalanced entries, missing dimensions, cancellation, duplicates, timeout | Reject invalid input locally; inject failures with test doubles rather than retrying live writes |

Subjects `1001`, `1002`, `1122`, `2202`, and `5001` exist and are enabled in the read sample. `4001` means production cost here, so never import code meanings from another accounting system; `5602` management expenses has children and cannot be assumed to be a leaf. Recheck sources, directions, period, and configuration before approved writes.

## Outstanding confirmations and next action

Vendor questions are limited to missing statement/book endpoints, nonzero balance semantics and variants, voucher uniqueness/unknown-result lookup, and finance attachment transfer/retention. Balance response fields were obtained, so an empty response schema no longer needs to be requested from support.

Locally investigable work includes journal single-variable comparisons, auxiliary items, subject completeness, and nonzero balances. Nonzero examples require user-approved writes; successful reads do not establish write permissions. Deletion, write-off, and their side effects need separate explicit authority; a test ledger is not unlimited authorization.

This delivers technical preparation and a proposal awaiting confirmation. Ask the user to approve the candidate scope, sample data, and test period before starting the corresponding Goal. Without approval remain read-only; do not start finance implementation or reimbursement development.
