# Agent Note: Single-account journal reconciliation

Status: implemented

English | [中文](2026-09-07-finance-journal-reconciliation.zh.md)

## Problem

Journal arrays have no documented total-count or final-page flag. Their undated summary rows omit currency even when dated business rows provide it. Treating that omission as missing business currency prevents useful account-scoped analysis; treating any short page as a complete ledger permits unsupported totals.

## Decision

Missing-value counters name amount cells explicitly (`incomeMissingValueCount` and `expenseMissingValueCount`). The workbook uses the same meaning. Calling them missing rows permits a model to report lost transactions even though every row is present; the counters do not establish lost records or a zero value.

Natural-language comparison and total requests use analysis even when combined with other Finance queries. The tool puts this routing rule first, and raw-page results repeat the required account lookup and analysis arguments. Otherwise a model can bypass the available collector by subtracting two first-page summaries. The guidance preserves raw-page reads and does not claim deterministic control over final prose.

An explicit `verificationOwner: xiaojing` field identifies local checks rather than vendor declarations. Both tool output and workbook retain this attribution because generated prose can otherwise mistake a coverage label for a vendor guarantee.

The [journal analysis](../../../../packages/xiaojing/xiaojing-finance-domain/src/journal-analysis.ts) accepts one verified cash-account ID and one or two month-bounded date ranges. It reads through an empty business page with explicit income/expense totals, rejects duplicate IDs and inconsistent totals, then compares those totals with exact sums of provided business values. Every business row must provide the same original currency. Two nonempty periods with different currencies cannot be compared. Neither a currency name nor a zero amount is inserted into source rows.

The result names its evidence `empty-page-and-totals-reconciled`, retains source IDs and missing-value counts, and excludes historical balance and cross-source accounting conclusions. A matching sum does not establish every missing opposite-side amount as zero. Empty periods with missing total fields fail; explicit zero totals can be reconciled against an empty returned set. Pagination and aggregate agreement do not establish a vendor count or atomic snapshot.

The existing journal consumer exposes analysis and optional Excel publication. Host lifecycle checks reject changes to the bound client or credentials. One deadline and deployment row/byte caps bound collection; each page uses the existing authenticated account-validated query. Workbooks preserve the exact report, source nulls and comparison direction as text cells, open on reconciliation data, and put ordinary export notes last without exposing endpoint names or technical digests. Failed reconciliation never publishes a file.

## Alternatives considered

**Block all journal analytics until summary currency is populated.** Business rows already provide the needed currency identity. The summary omission does not justify blocking single-account, explicitly qualified reconciliation.

**Sum the first page or trust an empty terminal page alone.** Neither checks omitted transactions against vendor amounts. The selected account, duplicate rejection and explicit total agreement provide additional checks without claiming a stronger vendor guarantee.

**Convert missing amounts to zero.** The API omits inactive-side fields, but null is preserved; provided-value sums must match explicitly returned totals. Missing total fields are not replaced with guessed zeroes.

## Consequences

Focused tests verify pagination, decimal arithmetic, null retention, currency mismatch, changing totals, identity, limits, cancellation and exact workbook cells. Shared Host tests verify workspace/credential protections. Assembled Web scenarios exercise successful publication and rejected reconciliation through the shipped Finance preset and durable transcript. Read-only ledger 35601 checks reproduce September income 120 and expense 20; separate authorized synthetic August records 253187/253189 provide income 60 and expense 10, giving differences 60 and 10. Test-data creation remains outside the product.

Full-ledger aggregation, arbitrary multi-month selection, vendor-count assurance, concurrent vendor mutation detection and general-ledger balance comparisons remain outside this operation. It does not complete overall F1 acceptance.
