# Agent Note: Temporary Youcheng voucher query

Status: implemented

English | [中文](2026-09-04-temporary-youcheng-voucher-query.zh.md)

## Problem

A verified ledger connection does not give chat a callable business operation. File-search tools cannot read live vouchers and must not retrieve Host credentials.

## Decision

The [Finance domain](../../../../packages/xiaojing/xiaojing-finance-domain/README.md) adds one Finance-preset consumer and a bounded read-only voucher operation. The session identifies the customer; the Host resolves its current saved ledger ID and credentials. The V2 Finance list requires a name, so every query first resolves the exact ID and rejects duplicate authorized names. Concurrent catalog edits discard the response. The model supplies only month and pagination, and receives sanitized entry data through ordinary logged tool results.

## Alternatives considered

The optional export starts from page one, rejects changed totals, short pages and duplicate vouchers, and publishes only after the unique voucher count matches the vendor total. It retains the distinction between vouchers and entry rows and the requested filters. The workbook opens on business entries and places ordinary scope and limitation notes last; it does not expose endpoint names or technical digests as spreadsheet content. Money remains text to preserve precision, and external names cannot become formulas. It does not infer a currency, fabricate totals or claim an atomic vendor snapshot. No model-authored rows or target paths are accepted.

**Ad-hoc shell requests** expose credentials and leave ledger selection to the model.

**The reimbursement voucher endpoint** serves a different workflow and can change export state when its status filter is omitted.

**A complete connector framework** exceeds this temporary verification scope.

## Consequences

This removable tool demonstrates chat-to-ledger reads without implementing posting, approval, payment, multi-ledger management, or automatic workflows. Pages disclose totals and continuation; missing or malformed amounts are not fabricated. Unfiltered reads do not promise recent-first sorting. The vendor name-based selector requires unique authorized names.

## Verification

Focused tests cover ledger resolution, credential exclusion, cancellation, month validation, pagination, result bounds, consultation rejection, and concurrent edits. The assembled Web scenario drives a model tool call through the real Finance preset and snapshots its logged result and browser card; only the model and vendor network are mocked. Real account smoke testing remains separate from reproducible fixtures.
