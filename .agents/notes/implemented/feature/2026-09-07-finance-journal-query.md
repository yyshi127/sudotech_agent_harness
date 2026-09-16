# Agent Note: Finance journal query evidence

Status: implemented

English | [中文](2026-09-07-finance-journal-query.zh.md)

## Problem

The journal endpoint needs ledger name, period and both dates despite optional date annotations. Omitting both dates returns business error 400; omitting one returns validation error 201. Empty test results contain opening and total markers rather than an empty array.

## Decision

The Finance tool resolves month boundaries before requesting the vendor, reuses the saved connection and shared session lifecycle checks, and verifies optional cash-account IDs against the bound ledger. The projection separates ID-less, undated balance markers from dated transactions and preserves monetary precision, missing values and currency distinctions. Result coverage stays unverified because the array contains neither a trusted count nor a final-page flag.

## Alternatives considered

Populated ledger 35601 probes establish that the vendor ignores `accountIdList` but applies `subjectId` using the cash-account ID, not the general-ledger subject ID. The adapter sends that field and rejects business rows lacking the selected identity. Returned `subjectName` and `subjectCode` supply labels when account labels are blank.

The optional export workbook starts at page one and continues through the first page without business transactions. It keeps every projected transaction field and separates opening/total markers on another sheet. Query selection, original/base currencies and missing amount labels survive publication. Business data is first and ordinary scope notes are last; endpoint names and technical digests are not spreadsheet content. Exact text cells prevent formula interpretation and monetary rounding. The existing tracked publication operation owns the file and durable receipt. Because the endpoint supplies no trusted count or final-page flag, reaching the first empty business page does not establish vendor-certified completeness or an atomic snapshot.

**Treat every array item as a transaction.** This reports two fictitious transactions for an empty ledger and duplicates totals.

**Send only the documented period.** Live requests fail without dates. Guessing a default period or swallowing error 400 as an empty array conceals failures.

## Consequences

Selected-bank scenarios verify both an empty result and a vendor response containing another account's transaction through the assembled application. A mismatched response produces a validation failure in the durable tool result and browser card, exposes no cash transaction, and publishes no file.

Focused tests cover calendar dates, summary classification, precision, bounds, account verification, errors and changed client credentials. The assembled Web test loads the shipped Finance preset and verifies normal, summary-only, failed and exported results in both the durable transcript and browser card. Separately authorized external scripts create two test cash transactions in ledger 35601: income 120 and expense 20. Six read-only adapter checks verify those amounts, balance 100, cash/bank separation and pages of size one. These samples do not establish arbitrary-ledger completeness; the product query itself performs no business writes.
