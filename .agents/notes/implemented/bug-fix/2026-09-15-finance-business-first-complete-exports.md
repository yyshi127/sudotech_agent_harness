# Agent Note: Business-first Finance deliverables

Status: implemented

English | [中文](2026-09-15-finance-business-first-complete-exports.zh.md)

## Problem

Finance Excel exports opened on a technical query-summary sheet instead of the requested business records. Voucher, journal and open-item exports also reused ordinary query pagination, so a request to export records could publish only the selected page while appearing successful. Tool cards and details could expose raw arguments, JSON results, internal identifiers and diagnostic controls even when a Finance tool supplied a business presentation.

## Decision

Every Finance workbook now contains only business rows, totals or analysis results. It omits query metadata, endpoint names, internal identifiers, response digests, coverage tokens and test wording. Money and business identifiers remain exact text with formula protection.

Every Youcheng Finance query and operation tool supplies a concise business call/result presentation. The Finance file lifecycle result shows only the completed action, filename and location rather than its hash, byte count or storage receipt. The generic Client renderer now honors those views in both rows and details, and semantic cards omit fallback-only input/output labels and trajectory inspection. Model-visible results retain business and continuation fields but omit internal audit metadata; complete durable operation evidence remains unchanged for recovery and safety checks.

Finance failure cards remove generic `Error:` prefixes and machine status codes. Actionable business guidance remains, while endpoint paths, raw structures and parameter names fall back to a safe connection, permission and network message.

Bound Finance sessions receive one output rule: final answers and generated files lead with the business result and actual data. Technical names and internal evidence appear only when the user explicitly requests diagnostics. A limitation remains visible in plain language only when it changes how the user should interpret the amount or scope, affects operation safety, or requires action.

Voucher exports ignore caller pagination, use the Finance voucher tool's configured page size, start at page one and publish one workbook only after unique voucher count matches the stable vendor total. The model-visible success receipt omits hashes, byte counts, pagination and internal evidence. Receivable and payable exports apply the same count rule to unique business records. These exports reject changed totals, short pages, duplicates, configured size limits and cancellation before publication. These checks establish count reconciliation, not an atomic vendor snapshot.

The journal endpoint provides neither a trusted total count nor a final-page flag. Journal export therefore starts at page one and reads through the first page without business transactions, while rejecting duplicate records and configured limits. The output states that this is the strongest available collection rule and does not call it vendor-count-certified completeness.

## Alternatives considered

**Keep exporting the selected page and explain it in metadata.** Rejected because “export vouchers” ordinarily means the matching business records, and a warning does not repair a materially incomplete file.

**Keep a technical sheet for auditability.** Rejected because internal evidence remains in the session and operation records; duplicating it in the business workbook makes the requested file harder to use.

**Treat the first empty journal page as proof of completeness.** Rejected because the vendor response provides no count or snapshot guarantee. The implementation discloses this limitation instead of inventing stronger evidence.

## Consequences

Voucher, journal, receivable and payable exports can make more vendor requests and may fail closed when data changes during collection or configured limits are reached. A failed collection publishes no partial workbook. Balance and analysis workbooks contain only business data, but their existing source-specific coverage limits remain unchanged and are communicated outside the spreadsheet when material. Query tools retain explicit pagination for interactive reading; only formal export operations collect the full requested selection under the rules above.

## Verification

Focused collectors test page-one restart, multi-page collection, count reconciliation, duplicate and changed-total rejection, limits and cancellation. Workbook tests verify business-only sheet contents, exact-text values and formula protection. Client tests prove semantic presentations replace raw arguments/results in rows and details. Keyless assembled Web scenarios exercise Finance queries, operations and full-selection exports through the shipped preset and replay their durable internal results and business-facing browser cards.
