# Agent Note: Xiaojing Finance Stage 1 integrated acceptance

Status: implemented

English | [中文](2026-08-29-xiaojing-finance-stage1-integrated-acceptance.zh.md)

## Problem

The first Finance stage spans customer records, immutable session context, controlled customer files, document normalization, official-source evidence, deterministic calculations, and workflow skills. Passing each package test separately did not prove that the shipped Xiaojing composition preserved Standard mode, kept two customers isolated, retained source locations, used the bound taxpayer facts, or remained readable after an upgrade.

A release claim based only on successful builds or byte-preservation checks would be incomplete. It could miss a cross-package wiring error, a parser that no longer accepts existing Finance records, or customer files placed under another customer. Automated tests also must not create real DeepSeek charges or depend on changing search results.

## Decision

Stage 1 has one keyless assembled acceptance snapshot. It mounts the shipped Xiaojing composition, creates one Standard agent and two Finance agents, and gives the Finance agents distinct immutable customer bindings that include private policy, account-mapping, and external-system identifiers. Both customers import identical CSV bytes into separate customer roots. The snapshot proves the Stage 1 Finance-only tools, the current five Finance-only skills, absence of Finance tools from Standard mode, customer-specific prompt context, customer-specific document lists, rejection of cross-customer document ids, source-row traceability, separate storage paths, and deterministic VAT results selected from each bound taxpayer type. It also pins the current canonical capability inventory and its reimbursement exclusion. A Hong Kong tax request returns out-of-scope without a network request.

The desktop upgrade verifier now uses the production `FinanceClientStore` to read a synthetic prior-version data copy containing two schema-versioned customers. It verifies their private fields, checks that source, session-work, deliverable, and archive files remain under the correct customer roots, and confirms that compatibility reads do not change any protected file bytes. This semantic check supplements the existing whole-tree hash comparison; it does not claim that the original 0.1.9 release already contained Finance data.

Manual source review anchors the current mainland tax examples to official National People's Congress, State Taxation Administration, and Ministry of Finance pages. Automated acceptance remains keyless and deterministic; live official-site retrieval and model answers are manual release checks rather than snapshot inputs.

The Stage 1 acceptance gate is source-readiness evidence, not an installer result. It does not permit packaging while the wider product regressions, Web preview, desktop checks, or data-preservation checks fail. The acceptance run exposed that a profile-neutral root build could replace Xiaojing's shared Client artifacts. The product repository now defaults complete builds to the Xiaojing profile while retaining an explicit official profile, and unpackaged desktop startup refuses a missing or non-Xiaojing build record.

## Verification

The assembled expected-output test is `apps/cli/tests/finance-stage1-acceptance.expected.e2e.ts`. Focused Finance tests cover customer storage and binding, official evidence classification, document formats and visual extraction, deterministic calculations, workspace routing, and preset composition. The product regression set covers brand, usage accounting, uploads, native vision, Weixin, Edge, Windows control, Visualize, desktop companion, and desktop lifecycle. The desktop user-data verifier exercises the synthetic upgrade copy through production readers and proves read-only behavior.

## Alternatives considered

- **Rely on package tests.** Rejected because package tests do not prove the shipped profile assembles the intended capability set or that independent packages agree on customer scope.
- **Use one customer fixture.** Rejected because a single customer cannot expose cross-customer prompt, document, path, or external-identifier leakage.
- **Check only file hashes during upgrade.** Rejected because unchanged bytes may still be unreadable by the current parser. Semantic reads and unchanged post-read hashes are both required.
- **Use live search and a real model in automated acceptance.** Rejected because results would vary, require credentials, create cost, and make a source gate depend on external availability.

## Consequences

Stage 1 now has one compact failure signal for composition, privacy, traceability, deterministic calculation, jurisdiction limits, capability wording, and prior-data readability. The fixture is intentionally synthetic and does not prove every real customer document, official-site response, Windows installation, or later business workflow. Current Youcheng operations have separate focused and assembled acceptance; SDOO, filing, posting, payment, and compliance remain outside this Stage 1 snapshot. No installer is produced by this acceptance step.
