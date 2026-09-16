# Agent Note: Classify Youcheng open-item totals separately

Status: implemented

English | [中文](2026-09-07-finance-open-item-query.zh.md)

## Problem

The official receivable/payable list returns a negative-ID total and a previous-page total even when count is zero. Treating every ID as a business record invents debts; dropping every zero amount can hide real zero-valued records.

## Decision

The Finance [open-item projection](../../../../packages/xiaojing/xiaojing-finance-domain/src/open-items.ts) recognizes undated negative-ID totals with empty subject and auxiliary identity separately. Dated positive-ID records require the bound ledger, amount, balance and currency. The saved ledger and explicit direction control the request. Vendor counts remain declared rather than independently verified completeness. Shared Host checks reject stale credentials or client configuration.

The [analysis collector](../../../../packages/xiaojing/xiaojing-finance-domain/src/open-item-analysis.ts) reconciles each page against one declared count and rejects duplicates before exact original-currency aggregation. All pages and optional baseline share authentication, deadline and saved-ledger authority. Only count-reconciled sets enter differences; absence of a group means a zero group sum, not a zero missing record. The report names Youcheng as the business-row source and Xiaojing as the grouping/calculation owner, distinguishes record-set comparison from historical closing balances and disclaims atomic snapshot consistency. Development acceptance status belongs in the development record, not every runtime result; embedded stage claims become stale independently of the queried data.

The XLSX serializer consumes the completed report without recalculating it. Explicit text cells preserve exact amounts and identifiers and avoid formula interpretation. A separate source-record sheet avoids packing many IDs into a single cell. The workbook opens on the analysis result and places ordinary query metadata and limitations last; endpoint names and technical digests are not spreadsheet content. Numeric money cells are deliberately not used because long decimal values can lose precision in Excel. The analysis tool's optional export invokes a new Host-authorized query and uses the existing file publication service; no report cache or model-authored data is accepted. The Host tracks serialization and publication through teardown, checks cancellation before publication and lets an initiated commit finish. A preserved work copy is not a successful publication receipt.

## Alternatives considered

Raw-record export is distinct from aggregated analysis: it starts at page one, preserves all eight amount components, nullable settlement flags, source IDs and both currency fields, and publishes only after unique business rows reconcile to the vendor count. Total and previous-page markers occupy a separate sheet. The export performs no additional aggregation or inferred payment classification and does not claim an atomic vendor snapshot.

**ID presence or zero-amount filtering.** Neither distinguishes a generated total from a real business record. The projection uses the observed marker fields and rejects unfamiliar records rather than silently dropping them.

**Infer settlement or counterparties.** Subtracting amounts or interpreting auxiliary names invents facts the API does not establish. Returned settlement components remain separate and nullable; no actual bank movement is claimed.

**Sum whatever one page returns.** This can omit records or double-count totals. Complete count reconciliation precedes analytics; balance and journal sources with unqualified completeness are not silently treated as compatible inputs.

## Consequences

The adapter preserves only the locally constructed `OpenItemGroupingError` diagnostic, whose constructor takes no external text. Other vendor or transport errors retain the existing redacted classification; matching message text does not grant access to the local diagnostic path.

Subject and auxiliary grouping reject blank identifiers before producing a report or publishing its workbook. A name can be present without a stable ID and is not an alternative grouping key. Currency-only aggregation does not require these unrelated identifiers. Focused tests cover blank and whitespace identifiers; the assembled export scenario verifies failure without file publication.

Both read-only directions are available without introducing write authority. Focused projection/provider and Host checks pass. Live empty and populated samples exercise marker classification, pagination and exact comparisons; sample acceptance does not establish atomic completeness or historical closing balances. The [development status](../../../../docs/integrations/youcheng-finance-development-status.md) owns current evidence and pending verification. The separate [journal decision](2026-09-07-finance-journal-query.md) remains applicable to its different marker format and is not superseded.
