# Youcheng Finance F3B Task Handoff

English | [中文](youcheng-finance-f3b-handoff.zh.md)

Updated 2026-09-15. This is the current continuation point for the same local project. Read the [development status](youcheng-finance-development-status.md), [latest six-path acceptance receipt](../../critique/f3b-lab/receipts/f3b-main-app-acceptance-20260914.json), [minimal voucher-deletion receipt](../../critique/f3b-lab/receipts/cf12-minimal-voucher-delete-20260915.json) and [maintenance proposal](../../.agents/notes/proposed/feature/2026-09-10-finance-destructive-maintenance.md) before historical chat or the older root handoff. The vendor-confirmed minimal CF12 request removes the old appId/flowId source identity dependency and has live adapter acceptance; browser-manual-origin is an unsampled qualification variant.

## Handoff conclusion

F3 is closed for its supported scope as documented in the [F3 closeout](youcheng-finance-f3-closeout.md). Run `f3b-20260914T044135Z-119ff626` verifies AR72620 and AP72621 creation/deletion with original/base balances, two independent readbacks and new-session inspection. Both synthetic records are deleted; all consumed intents stay protected. Issue004's parameter/source identity blocker is resolved by the accepted minimal-request run on voucher244499. Issues001/002, the unsampled browser-manual-origin variant and repository release limits remain explicit; F4 is in progress.

The latest [balance-verification update](youcheng-finance-development-status.md) separates original/base evidence and closes the same-currency missing-base gap without filling raw fields. Saved AR/AP snapshots both pass; current read-only recovery matches AR but retains AP's changed-inventory mismatch. Do not resend either deletion to make recovery green.3092 was subsequently rebuilt and restarted under execution session62427; the earlier63696 owner below is historical. The read-only test session0235e717-f8a6-442c-b97d-e4b46a9608c1 has finished.

On2026-09-15 the vendor supplied the successful voucher-deletion body: `accountName` plus `cerInfoList: [{ cerId }]`. Product preparation now takes only voucherId, derives the ledger name and exact target from fresh Host evidence, and does not require a local creation record. Focused tests and assembled keyless refresh/replay pass. A live adapter run created dedicated voucher244499, sent the minimal deletion body once, observed acceptance and two complete absent inventories, and returned exactly to the41-voucher baseline. Desktop issue004 is retained as resolved with browser-manual-origin unsampled; example voucher243978 was not changed. The earlier [follow-up regression receipt](../../critique/f3b-lab/receipts/f3-deferred-followup-20260914.json) remains historical F3 combination evidence, not F4 or release acceptance.

The [F3 remainder receipt](../../critique/f3b-lab/receipts/f3-remainder-20260914.json) adds current-code subject auxiliary-category and currency selection. Real main-app subjects100292/customer01 and100291/USD have accepted single-send results, matched configuration readbacks and independent preservation audits. Adapter-only subjects100294/100293 remain separate evidence. First-account IDs and auxiliary enable-state remain unresolved. The later CF12 live receipt resolves its minimal-request parameter/source identity blocker without qualifying browser-manual-origin. Preserve all consumed lab intents. The rebuilt3092 process is the owned execution session63696 at that historical checkpoint; verify actual listener ownership before any later restart. No test model is intentionally left running after acceptance.

The later F3 remainder investigation is recorded at the top of the [development status](youcheng-finance-development-status.md). It resolves the standalone journal fixture's cross-date predecessor selection and adds bounded write-off preflight stages; it does not rewrite old outcomes. New synthetic journals141170/141171/141172 remain in35616 and their intents must not be replayed. The desktop issue003 is resolved only for that reproduced laboratory defect; issues001/002 stay deferred.

All six currently supported F3B paths have current-code real-model main-application acceptance, two independent readbacks and new-session inspection. AR/AP deletion executors are implemented and deployed; the earlier build blocker is resolved. Voucher and journal detailed confirmations now include the local operation ID. Mandatory exact-version consent, single dispatch, persistent claims, deletion/write-off mutual exclusion and unknown-result no-resend behavior remain enforced.

The broader proposal is not wholly complete. CF12's minimal request is implemented and live-accepted for one API-origin synthetic voucher; browser-manual-origin and broader linked effects are not separately qualified. Linked, audited, settled or otherwise ineligible targets remain blocked. Do not report unrestricted deletion, all-origin acceptance, repository-wide checks passing or a production-ready release.

## Project and Git

| Item | Value |
|---|---|
| Development directory | `E:\Projects\小兢会计0.2.3后续开发` |
| Isolated runtime directory | `E:\Projects\小兢会计0.2.3后续开发-运行数据` |
| GitHub repository | `https://github.com/yyshi127/sudotech_agent_harness` |
| Origin | `git@github.com:yyshi127/sudotech_agent_harness.git` |
| Official upstream | `https://github.com/deepseek-ai/deepseek-harness.git` |
| Branch / tracking branch | `codex/finance-f1-2` / `origin/codex/finance-f1-2` |
| HEAD | `xiaojing-history-20260930-6` |
| HEAD subject | `feat(xiaojing): ship finance stage one and release 0.2.3` |
| Original task | `01a0662b-881f-79a3-88fa-d578c9dd93a9` |
| Goal | Inspect the actual task Goal; do not infer status or inheritance from prose |

Large tracked and untracked changes, including F1/F2/F3A/F3B code and generated files, remain uncommitted. No push is performed by this acceptance run. Cloning HEAD alone loses this work. Rerun `git status --short`, branch, HEAD and remotes before edits; package metadata pointing to upstream is not the collaboration remote. Do not reset, clean, replace directories or indiscriminately commit the worktree. Generated `.js`, `.d.ts` and maps under source directories have not all been proven safe to delete.

## Runtime

Port 3092 is running the rebuilt Xiaojing profile as of this checkpoint. The user's existing Chrome tabs for 3092 and `https://cwpc.yiqiyun.com/#/` are claimed and reused; do not launch another browser to substitute for the existing login. Browser observation is supplementary, not proof of vendor writes. Actual acceptance uses the real model through local application RPC and actual approval channels, not manual UI approval clicks.

```powershell
Set-Location -LiteralPath 'E:\Projects\小兢会计0.2.3后续开发'
$xiaojingRuntime = 'E:\Projects\小兢会计0.2.3后续开发-运行数据'
$env:DSH_CLIENT_BUILD_PROFILE = 'xiaojing'
$env:DSH_HOME = Join-Path $xiaojingRuntime 'harness'
$env:XIAOJING_FINANCE_WORKSPACE_ROOT = Join-Path $xiaojingRuntime 'workspace\Finance工作区'
pnpm.cmd run build:xiaojing
# Start only after the build succeeds and the previous owned server is stopped.
pnpm.cmd dsh web --port 3092 --no-open
```

Do not default to `C:\Users\Administrator\.dsh`. Before restarting, inspect running sessions and stop only this task's known test session if necessary; preserve runtime configuration, credentials, attachments, sessions and durable operations. The workspaces RPC is a POST to `/api/financeClients/workspaces` with a client-request envelope; a GET returning 404 is not evidence of a missing client configuration.

## Qualified paths and evidence

All rows use ledger 35616 and current real-main-application evidence. The [receipt](../../critique/f3b-lab/receipts/f3b-main-app-acceptance-20260914.json) records run IDs, exact operation IDs, hashes, approval counts and limitations.

| Capability | Verified target and result | Qualification limit |
|---|---|---|
| CF12 voucher deletion | 244401 deleted under prior acceptance; dedicated244499 then passed the current minimal accountName/cerId body, two complete absence reads and exact baseline preservation | Browser-manual-origin and broader linked effects are not separately qualified; vendor file erasure or permanent retention after deletion is not observable |
| CF15 journal deletion | ADD journal 141168 deleted; CF24 WRITE_OFF journal 141166 preserved and ineligible for deletion | Known links, attachments, audit state and unsupported origins remain blocked |
| CF22 receivable deletion | AR72617 deleted; saved snapshots and current balances match | Original direction/period only; missing base balances derive only with explicit same-currency evidence |
| CF23 payable deletion | AP72618 deleted with separate direction verification | Same scoped limits, not inference from CF22 |
| CF24 receivable write-off | AR72615 fully settled; linked journal 141166 independently matched | Full base-currency settlement only; period-lock state unavailable |
| CF25 payable write-off | AP72619 fully settled; linked journal 141169 independently matched | Separate payable acceptance; no actual bank payment |

Private evidence is under `E:\Projects\小兢会计0.2.3后续开发-运行数据\test-tools\f3b-35616\runs`. The public receipt links the four run IDs. Never remove or overwrite intent, outcome, approval, recovery or audit files to permit another send.

The original CF12 operation `fd769aab-a489-4b30-ac2b-aa9f3161539b` was refused before reservation because detailed consent omitted its ID. A guarded child run reuses only the verified fixture, prepares operation `938c7d3c-08c1-46de-92dc-ea267c1f2c7f` and obtains both new confirmations. It does not resend the original intent or create another voucher.

Failed CF15 target 141167 remains an undeleted synthetic ADD journal; original operation `aceac195-c887-4ddb-b65f-80ed0a929100` was refused before dispatch. Failed CF25 target 72616 remains open at 0.01; operation `918b3fb3-8fe4-4600-8097-01f11b35fd5c` records not-sent/preflight-failed. Repeated read-only probes are stable but do not establish its root cause. These residuals are intentionally preserved, not duplicate-send candidates.

## Tests and repository gates

Current checks pass: 578 tests across 14 maintenance files, 137 Finance Host tests, four shipping Web replay files, eight offline lab-guard tests, complete `build:xiaojing` and focused lint. Voucher/journal snapshots include the ID repair, and voucher replay was rerun after the final source change. Counts are separate testing surfaces, not independent live-business cases.

Repository-wide lint still fails on existing generated declarations under source directories. The current complete doc-sync passes 23 gates and fails five: stale Cordis API catalog, corpus translation pairing (API replica and config-catalog), API-replica wrapping, generated declaration JSDoc and persistence catalog duplicate event declarations. All five edited bilingual pairs, Agent Note format, documentation links and budgets pass. Do not claim a clean repository or remove unknown files to make checks pass; keep repository-wide failures separate from business acceptance.

## Authorization and limits

The standing development authority covers only minimal, uniquely marked synthetic data in “施的演示账套” 35616. This is a test ledger on the vendor's production service, not an isolated vendor sandbox. It does not authorize real payment/receipt, other ledgers, unrelated records, credential changes or unknown-result replay. Product mandatory confirmation still applies.

Do not write to or delete ledger 35601 “数豆测试帐套勿删”. Preserve earlier acceptance assets AR72602/0.19, AP72603/0.23 and voucher244058 with its originals. Historical consumed targets also remain protected from replay: vouchers244240/244305/244306, journals141107/141110, deleted AR72604/AP72605 and settled AR72606/AP72607. Receipts65833/65834 link to journals141108/141109; receipt IDs are not journal IDs. Add this checkpoint's successful targets to the same no-replay discipline.

Test account IDs174626/174624/174622 are ledger35616 evidence, not cross-ledger defaults. Missing data is not zero, enabled, safe or a guessed ID. The desktop `C:\Users\Administrator\Desktop\小兢会计-暂未解决问题清单.md` tracks deferred full AR/AP account discovery and auxiliary enabled-state absence. Its journal predecessor issue is now resolved as a standalone cross-date fixture defect, with original incomplete receipts preserved. Deferred vendor gaps are not reasons to block unrelated work.

No public period-lock state or remote concurrency lock is available. Shared local claims constrain this application's known operations, not the vendor UI or another client. Partial/foreign-currency/reverse write-off, automatic undo, approval/reverse approval, posting/closing, real funds movement, subject deletion, F4 and reimbursement are not implemented by this checkpoint.

## Code and continuation

Product code is in `packages/xiaojing/xiaojing-finance-domain/src/index.ts`, `youcheng.ts` and the `voucher-deletion*`, `journal-deletion*`, `open-item-deletion*`, `open-item-write-off*` files. Corresponding tests are under that package's `tests/`; assembled tests are the four `apps/web/tests/finance-*-deletion.e2e.ts` / `finance-open-item-write-off.e2e.ts` files. Lab scripts and sanitized receipts are in `critique/f3b-lab`.

1. Read this file and the latest receipt, verify actual Git/runtime/Goal state, and preserve the worktree.
2. Do not recreate fixtures or rerun accepted sends. Recover only through original records and read-only inspection.
3. Continue F4. A browser-manual-origin CF12 sample is optional qualification work rather than an interface blocker; do not recreate or resend a target solely to improve that evidence. Repository hygiene remains separate; do not begin reimbursement.
4. For behavior changes, add focused and assembled regression evidence. Build before Web tests; running a Web test while build artifacts are being replaced can report a missing client-build record without a product regression.
5. Record actual limitations and results. Do not create a Goal unless requested, infer an inherited Goal, or call the entire maintenance proposal complete from these six bounded paths.

A new task can begin with: “继续小兢会计财务开发。完整阅读 docs/integrations/youcheng-finance-f3b-handoff.zh.md 和 20260914 主应用验收回执；先核对实际 Git、运行目录和 Goal。保留所有既有修改、失败记录及已验收资产，不重发任何旧意图。当前六条支持路径已验收，未覆盖来源和供应商限制仍按文档保留。按我随后指定的范围继续。”

Use the oversized previous task only for specific missing evidence, not a complete reread. Current code and immutable runtime evidence outrank chat claims.
