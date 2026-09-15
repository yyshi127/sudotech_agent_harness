# Agent Note: Finance reference acceptance corrections

Status: implemented

English | [中文](2026-09-07-finance-reference-acceptance.zh.md)

## Problem

Read-only browser acceptance exposed an unsupported subject-direction explanation and indistinguishable same-name customer options.

## Decision

Reference results carry direction guidance only for their own query kind. Subject guidance forbids inferred debit/credit mappings while retaining raw values. The client selector reuses workspace connection metadata to show ledger names and IDs without reading credentials or changing session binding.

## Alternatives considered

**A shared direction notice** places cash-account mappings next to unverified subject values and encourages cross-type inference. Per-kind notices avoid that ambiguity.

**New ledger-selection storage** duplicates existing workspace metadata. Displaying that metadata preserves selection by client ID without a new persistence format.

## Consequences

Unit tests cover per-kind guidance, duplicate customer names, selected IDs, and unavailable verified names. The assembled browser snapshot includes raw subject direction and the prohibition in logged results. Model compliance still requires real-model acceptance; prompting is not deterministic enforcement.
