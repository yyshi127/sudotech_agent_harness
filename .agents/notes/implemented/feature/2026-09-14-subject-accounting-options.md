# Agent Note: Explicit subject accounting options

Status: implemented

English | [中文](2026-09-14-subject-accounting-options.zh.md)

## Problem

Subject creation sent empty auxiliary and currency lists even though the public endpoint accepts selected category and currency codes. Ordinary-subject acceptance did not cover these configurations, and a successful add response contains no new subject ID.

## Decision

An optional `accounting` proposal contains explicit `auxiliaryCategoryCodes` and `currencyCodes` arrays. Omission retains ordinary-subject behavior; duplicate codes, incomplete objects and extra wire fields reject. Fresh current-ledger categories supply auxiliary IDs, codes and labels. Currency choices require one non-conflicting name observed on current-ledger subjects; this is a bounded positive reference source, not a complete currency catalog or enabled-state assertion. The product does not register currencies or choose exchange rates.

Resolved configuration is saved with the exact approved version and compared by the existing Host checks before dispatch. The documented lists carry the requested code with `checked=true`, and subjectAuxiliary reflects the explicit category selection. Independent readback compares category identity/code/name and currency code/name, including counts; missing, duplicated or changed configuration cannot match. No base currency is inserted implicitly. Existing leaf promotion and changes to parent accounting remain refused.

## Alternatives considered

**Require a new currency catalog endpoint.** Not adopted for this bounded feature: existing subjects provide positive evidence for already-used codes and names, and the creation endpoint validates the request. Unobserved codes remain unavailable rather than being guessed.

**Reuse a parent or copy its settings implicitly.** Rejected because the new subject's requested accounting and existing parent impact need separate checks. A new child must not modify existing accounting or migrate historical balances.

## Consequences

Ordinary saved proposals remain readable and produce unchanged payloads. New proposals retain resolved labels and identities for confirmation and recovery. Public experiments in35616 verify customer-category and USD configuration separately while preserving existing subjects and41 vouchers. Product tests cover selection changes before dispatch, duplicate or missing values, persisted options, exact-version confirmation and independent readback. Missing auxiliary-item enabled status remains a separate unresolved API limitation, not evidence that a selected category failed to attach.
