# Youcheng Finance F3 closeout

English | [中文](youcheng-finance-f3-closeout.zh.md)

## Disposition

The2026-09-14 closeout is complete for the supported F3A creation and F3B maintenance paths, with the user's deferred vendor gaps retained. Ten supported paths have acceptance evidence; CF09 creation and identity pass but public enable-state remains unverified. Both new CF22/CF23 balance-verification acceptances pass. This document does not certify unrestricted Finance completion, F4 acceptance or production release. The [closeout receipt](../../critique/f3b-lab/receipts/f3-supported-scope-closeout-20260914.json) identifies new versus inherited evidence and file hashes.

2026-09-15 amendment: the vendor confirmed that voucher deletion needs only `accountName` and `cerInfoList: [{ cerId }]`. CF12 implementation and assembled keyless tests now use that request without local-creation source identity. A live adapter experiment created dedicated API-origin synthetic voucher244499, sent the minimal deletion once, observed two complete absent inventories and returned exactly to the41-voucher baseline. This resolves issue004's parameter and source identity blocker. Browser-manual-origin remains an unsampled qualification variant, not an unresolved interface requirement. Issues001 and002 remain deferred.

## Capability checklist

| ID | Capability | Evidence and limit |
|---|---|---|
| CF14 | Create income/expense journals | [F3A audit](../../critique/f3a-lab/receipts/f3a-completion-audit-20260910.json); technical records, not bank movements or automatic vouchers |
| CF20 | Create receivables | [Main-app acceptance](../../critique/f3a-lab/receipts/open-item-live-host/receivable/audit.json); currently requires verifiable same-ledger account references |
| CF21 | Create payables | [Independent main-app acceptance](../../critique/f3a-lab/receipts/open-item-live-host/payable/audit.json); not inferred from receivables |
| CF08 | Create subjects | [Root/branch evidence](../../critique/f3a-lab/receipts/f3a-completion-audit-20260910.json) and [explicit accounting configuration](../../critique/f3b-lab/receipts/f3-remainder-20260914.json); historical leaf promotion, quantity accounting and new currencies are not supported |
| CF09 | Create auxiliary items | [Creation and identity accepted](../../critique/f3a-lab/receipts/master-data-live-host/auxiliary-item/audit.json); public enable-state is unavailable and `complete=false` remains correct |
| CF12 | Delete vouchers | Prior [main-app acceptance](../../critique/f3b-lab/receipts/f3b-main-app-acceptance-20260914.json); the [minimal-request live receipt](../../critique/f3b-lab/receipts/cf12-minimal-voucher-delete-20260915.json) records dedicated voucher244499 accepted, deleted once, absent in two complete inventories and an exact baseline return; browser-manual-origin is not separately sampled |
| CF15 | Delete journals | [Main-app acceptance](../../critique/f3b-lab/receipts/f3b-main-app-acceptance-20260914.json); supported ADD records only; known linked and WRITE_OFF records remain blocked |
| CF22 | Delete receivables | New test72620 passes creation, exact deletion, original/base balance comparisons, two independent readbacks and new-session inspection |
| CF23 | Delete payables | New test72621 independently passes creation, exact deletion, original/base balance comparisons, two readbacks and new-session inspection |
| CF24 | Write off receivables | [Main-app acceptance](../../critique/f3b-lab/receipts/f3b-main-app-acceptance-20260914.json); full base-currency settlement with independently matched journal |
| CF25 | Write off payables | [Independent main-app acceptance](../../critique/f3b-lab/receipts/f3b-main-app-acceptance-20260914.json); no actual bank payment, partial/foreign-currency/reverse write-off |

Historical receipts are not rewritten. Later receipts supersede only the named capability and verified path: the old F3A counterparty-mapping failure is superseded by the CF20/CF21 live-Host audits; subject auxiliary/currency qualification is extended by the F3 remainder receipt. CF09 status is still not verified by public API.

## Current acceptance and recovery

The new run is `f3b-20260914T044135Z-119ff626`, restricted to35616. Existing guarded laboratory scripts create one0.01 record per direction, bind exact local versions, use the application's mandatory confirmation channel and permit one delete of each returned target. These are real-model shipping-application operations, not human UI clicks. Existing records and consumed intents must not be replayed.

AR72620 changes the captured RMB balance from0.27 to0.26; AP72621 changes it from0.30 to0.29. Both retain unchanged surviving rows, the opposite direction, journals and41 existing vouchers. Each has exactly one creation and one deletion, two independent post-deletion inventories and a successful new-session inspection. The synthetic business records were deleted; their original evidence and consumed intents remain available, not replayable.

CF23 encountered two connection timeouts during read-only pre-deletion snapshots after creation was accepted, at authentication and ledger verification respectively. Recovery reused the saved creation result; no deletion intent existed at either interruption, and no second creation was sent. The subsequent read, delete and independent verification passed. A network error is not evidence that the account or data is absent.

The balance fix already passed314 focused tests, ten assembled Web scenarios and the Xiaojing build; [the fix receipt](../../critique/f3b-lab/receipts/open-item-deletion-balance-fix-20260914.json) distinguishes these layers. The final closeout reuses that evidence because product source did not change. Eight laboratory command/approval/no-resend guard tests pass again. Missing FX base balances remain unavailable; explicit identical currency codes allow labeled base-balance derivation, not alteration of vendor fields.

## Deferred and unsupported scope

| Item | Current treatment | Reopening requirement |
|---|---|---|
|001 First AR/AP account discovery | No reliable complete public list; verified existing references can be used; no fixed cross-ledger IDs or synthetic business for discovery | Verifiable same-ledger account identity without requiring historical business |
|002 Auxiliary enable-state | Creation/name/code can match; state remains unverified | A readable authoritative status source integrated and tested in the product |

Issues001 and002 remain in `C:\Users\Administrator\Desktop\小兢会计-暂未解决问题清单.md`. Issue004 is retained there as a resolved record with the live receipt and the unsampled browser-manual-origin qualification limit. Issue003 closes only the reproduced standalone journal predecessor-selection defect. Historical unsent or unknown records remain untouched. Missing vendor period locks and remote concurrency control, partial/foreign-currency/reverse write-off, quantity accounting and historical leaf promotion are not silently certified by this closeout.

## Engineering handoff

Continue in the existing working tree described by the [handoff](youcheng-finance-f3b-handoff.md). It contains substantial uncommitted work; the GitHub HEAD alone does not contain these changes. No commit or push is included in this closeout. Evidence hashes identify inspected files and are not a source backup.

Repository-wide lint still reports generated declarations in source directories; doc-sync retains catalog, generated-declaration and API-replica failures. These are tracked engineering/release issues, not silently waived or repaired by deleting unknown files. They remain separate from the bounded business acceptance.

The next stage in the [execution plan](youcheng-finance-execution-plan.md) is F4 overall user-scenario and delivery acceptance, after confirmation of scope and deferred items. Reuse qualified evidence and test combined workflows, recovery, ledger switching, installation and data retention. Reimbursement remains outside scope; no F4 execution is included here.
