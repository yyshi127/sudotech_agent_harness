# Agent Note: Journal answer evidence limits

Status: implemented

English | [中文](2026-09-07-journal-answer-evidence.zh.md)

## Problem

A live Finance answer converted an empty, incomplete journal page into absence of daily activity, supplied RMB for blank currency codes, and treated matching adjacent balances as independent verification. The query and published workbook retained the original missing values; the defect was in the interpretation.

## Decision

The journal tool description and logged result notice explicitly constrain empty-page, currency and balance language. The financial projection, query scope and workbook values remain unchanged. The owning [README](../../../../packages/xiaojing/xiaojing-finance-domain/README.md) defines the observable limits.

## Alternatives considered

**A generic disclaimer alone** does not address contradictory absolute claims in the main answer, as the live failure demonstrates.

**A generated-text keyword blocker** cannot reliably distinguish a prohibited claim from its quotation or negation and would interfere with natural-language answers. It is not added.

## Consequences

The same interpretation rule applies to open items: previous-page totals are not initial balances, and an export that queries again is not a prior snapshot. The open-item consumer instructs the model to preserve these labels, reuse the requested direction and period for subsequent exports, let the Host collect and reconcile all pages, and use the returned file path. Its assembled scenario checks that these instructions reach the model; it does not assert that a mocked answer proves compliance.

Open-item query and analysis instructions also preserve balance timing and aggregate source identity through the final conclusion. Local currency groups do not supply missing currency to vendor summary rows. A live retest corrected the previous-page label but still called the returned balance a month-end balance; that result remains a failed whole-answer acceptance, not evidence that the instructions guarantee compliance.

Focused projection tests preserve missing amounts and currencies with nonzero balance markers. The assembled Finance scenario verifies the instructions reach the model, the logged result and the export card; its model is mocked and cannot prove real-model compliance. Live-chat acceptance is separate. No change grants business-write authority or establishes journal completeness.
