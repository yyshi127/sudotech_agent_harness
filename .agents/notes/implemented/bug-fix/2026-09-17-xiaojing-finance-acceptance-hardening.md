# Agent Note: Xiaojing Finance acceptance hardening

Status: implemented

English | [中文](2026-09-17-xiaojing-finance-acceptance-hardening.zh.md)

## Problem

Finance acceptance exposed correctness and delivery defects across model routing, write previews, balance comparisons, reference traversal, tax inputs, attachments, workbooks, connection errors and conversation terminal states. Several defects could produce a plausible but incorrect business answer, resume an unrelated historical write, or leave the desktop visibly running after the turn had ended.

## Decision

Finance model context now treats the current explicit request as authoritative. A read request cannot resume a historical write, and an invalidated preview can only report that it must be prepared again. The context distinguishes preparation, upload, submission, supplier acceptance and independent readback; ordinary answers omit implementation diagnostics unless the user explicitly asks for diagnosis. Customer display names and external ledger names are independent, and verified policy evidence remains verified even when client applicability is still unknown.

Subject-tree queries start from the requested root and traverse every returned descendant by parent identity. Balance comparisons require one operation-adjacent baseline and compare debit and credit columns independently. Missing prepaid enterprise income tax is a required input rather than an implicit zero. Mainland policy routing includes Suzhou. Open-item comparisons describe a missing complete group as a zero group aggregate, not as zero-filled records.

Voucher preparation rejects unsupported attachment formats before creating an executable preview. Foreign-currency confirmation shows currency, original amount, exchange rate and base amount. Uploaded voucher objects retain a safe extension-bearing filename. A caller-selected archive folder replaces the default dated destination for that operation instead of creating a duplicate.

Finance workbooks use readable column widths, frozen headers and Chinese labels. Balance outputs use `本年累计`, comparison outputs identify both periods and keep source rows, group totals and reconciliation results distinct. Exact monetary text remains text so large or high-precision values are not rounded by JavaScript or spreadsheet binary numbers.

The client publishes running-state changes immediately on live `turn/start` and `turn/end` events. Failed compaction remains visible even when no checkpoint was produced and offers a safe retry instruction. Finance connection failures use localized user-facing messages while detailed causes remain in logs.

## Alternatives considered

**Depend on model judgment for historical intent.** Rejected because a prior write remains salient in context and can be resumed despite a new read-only request.

**Convert exact monetary strings to spreadsheet numbers.** Rejected because this would improve superficial formatting while risking silent precision loss. Widths, headers and labels provide readability without weakening accounting accuracy.

**Treat every acceptance gap as a code defect.** Rejected. The intermittent cancelled-query case and recovery of an old deletion after configuration changes remain investigations until reproducible evidence identifies the responsible component.

## Verification

Focused unit tests cover model-context rules, full subject descendants, tax-input validation, attachment preflight, foreign-currency confirmation, balance and open-item semantics, archive destinations, workbook presentation, live turn termination and compaction failure rendering. Keyless assembled Finance snapshots verify the published prompt and voucher workflow. Web replay tests verify localized connection errors and the supported voucher attachment flow. The complete source build succeeds.

## Consequences

The Finance surface now favors explicit current intent, accounting-safe values and business-facing output. Unsupported document formats fail before confirmation instead of producing a misleading preview. Two evidence gaps remain tracked separately and are not counted as completed fixes: intermittent F08 cancellation and recovery of an old deletion after configuration changes.
