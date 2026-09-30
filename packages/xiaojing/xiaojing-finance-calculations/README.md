---
description: "Versioned deterministic trial calculations for Xiaojing Finance mode"
kind: "package-reference"
---

# @deepseek-ai/dsh-xiaojing-finance-calculations

English | [中文](README.zh.md)

## Summary

Versioned deterministic trial calculations for Xiaojing Finance mode. The Host service owns pure decimal calculation and client-context adaptation; a separate Finance-preset consumer registers `finance_calculation`. Standard and other presets receive no tool, and neither entry changes the Agent Loop.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Supported rule pack

Rule set `cn-mainland-2026-v1` accepts evaluation dates from 2026-01-01 through 2027-12-31 and covers four bounded calculations:

- general-taxpayer and small-scale VAT trial calculation;
- urban maintenance and construction tax, education surcharge, and local education surcharge derived from paid VAT and consumption tax;
- general and qualifying small-low-profit enterprise income-tax prepayment trial calculation;
- resident salary cumulative-withholding individual income tax.

The embedded references point to current official statutory or policy pages. The service rejects dates outside the rule-pack period instead of extending expiring reliefs by assumption. It also rejects unsupported taxpayer types and asks for every material eligibility fact rather than selecting a favorable treatment silently.

Amounts cross the tool boundary as decimal strings and are calculated with `decimal.js`. Each tax or fee result rounds to two decimal places with `ROUND_HALF_UP`. Results contain the normalized inputs, their request/client/rule source, every formula step, outputs, rule version, official references, assumptions, limitations, and a trial-only disclaimer.

## Client context and failure behavior

A client-bound Finance session supplies the taxpayer type from its immutable session snapshot. A conflicting request is rejected. An unbound Finance consultation must provide the taxpayer type when VAT depends on it. The package reads no mutable customer record and stores no calculation ledger; ordinary `tool/call` and `tool/result` events make each model-visible trial reconstructable from the session log.

Missing or conflicting fields return `needs-input` without a partial numeric result. Invalid dates and decimal amounts are rejected. Unsupported rule dates return `unsupported` and direct the agent to verify the target-date rules through `finance_evidence`.

## Model Experience

### Deterministic Finance calculation

#### What the model sees

Finance receives `finance_calculation`. The tool description identifies the fields required by each calculation. Its result renders a Chinese report containing calculation status, source-labeled inputs, formulas, rounded results, official references, assumptions, limitations, and the explicit statement that the result is not a filing, payment, audit, or posting result.

#### Token effect

Only the requested structured calculation enters the calling session. No tables or rule corpus are injected into every prompt.

#### KV Cache effect

The standing Finance prompt and tool schema are stable. Request-specific values and traces appear only in the tool call and result after that prefix.

## Known Limitations and Deferred Work

- The first rule pack intentionally excludes mixed VAT rates, simplified taxation, special industries, most preferential treatments, final settlement, non-salary IIT, consumption tax itself, and local rules beyond the supplied surcharge rates.
- The package performs trial calculations only. It does not prepare or submit a return, post a voucher, make a payment, or mutate an external system.
- Remove the `xiaojing-finance-calculations` Host row and the Finance preset's `finance-calculations` consumer row to remove the capability without affecting client records, documents, Standard mode, or official Harness profiles.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
