# Agent Note: Xiaojing Finance deterministic calculations and first workflow skills

Status: implemented

English | [中文](2026-08-29-xiaojing-finance-calculations-and-skills.zh.md)

## Problem

Finance mode could retrieve official sources and normalize documents, but numerical tax answers still depended on model arithmetic and workflow quality depended on an unstructured prompt. That allowed omitted facts, stale rates, hidden rounding, and invented filing conclusions. The product also needed reusable professional workflows without adding external posting, filing, approval, or payment behavior.

The first calculation release must remain narrow enough to audit. It cannot infer eligibility, treat a search result as a rule, mutate customer records, add a second ledger, or alter Standard mode. The workflow guidance must be removable with the Finance preset and must coordinate existing capabilities instead of duplicating document, evidence, or file logic.

## Decision

`@deepseek-ai/dsh-xiaojing-finance-calculations` provides a complete Cordis capability with a Host service, Finance-only `finance_calculation` consumer, and package-owned invariant companion. It does not change `agent-loop`. The service performs pure decimal calculations; the tool preserves the request and full result through ordinary session tool events, so the package owns no separate persistent data.

The immutable `cn-mainland-2026-v1` rule pack supports dates from 2026-01-01 through 2027-12-31. It includes bounded examples for one-rate general-taxpayer VAT, small-scale VAT, VAT-derived surcharges, enterprise-income-tax prepayment, and cumulative resident salary withholding. Inputs use decimal strings and explicit boolean eligibility choices. Outputs contain normalized inputs, substituted formulas, exact outputs, fixed half-up rounding, assumptions, limitations, official links, and a mandatory trial-only statement. Missing facts return `needs-input`; unsupported dates return `unsupported`; neither result contains a guessed amount.

A bound Finance customer supplies taxpayer type and registered region through the immutable session binding. A conflicting request is rejected. A consultation supplies taxpayer type explicitly. Registered region is disclosed as context but never converted automatically into an urban-maintenance-tax rate.

The product-owned Finance skill root now contains five workflow skills: Chinese official-source tax research, invoice review, voucher drafting, financial-data analysis, and reimbursement review. The existing document-reading skill remains a supporting skill rather than a sixth business workflow. Each workflow coordinates `finance_document`, `finance_evidence`, `finance_calculation`, and `finance_files` as appropriate. They produce reviewable facts, calculations, drafts, risks, and evidence gaps but never report an external business action as completed.

The Xiaojing product manifest owns the package and skill inventory. The product verifier compares the Finance preset with Standard mode, permits exactly the declared Finance consumers, validates every skill path and metadata header, and requires the calculation Host to remain Xiaojing-profile-only. Removing the Host row and preset consumer removes calculations; removing the skill files removes the workflows. Official Harness profiles and Standard mode remain unchanged.

## Alternatives considered

- **Let the model calculate from retrieved rules.** Rejected because the arithmetic, rounding, omitted inputs, and selected rule would not be deterministic or independently reproducible.
- **Build a general tax engine.** Rejected because the first release does not have enough verified rule coverage, eligibility data, or filing integration to support arbitrary tax results safely.
- **Persist a separate calculation ledger.** Rejected because tool calls and results already retain every model-visible input and output; another store would create reconciliation and migration work without adding evidence.
- **Infer incentives and locality from customer fields.** Rejected because customer classification and a registered address do not establish every period-specific eligibility condition or tax-rate tier.
- **Implement the five workflows as code.** Rejected because they organize judgment and tool order rather than own a new deterministic service. Skills remain the smaller removable unit.

## Verification

Calculator tests cover bound and unbound taxpayer types, general and small-scale VAT, threshold handling, surcharges, enterprise-income-tax treatments, salary withholding brackets, missing inputs, client conflicts, and unsupported dates. Tool tests pin the readable audit report and missing-input output. A keyless assembled snapshot mounts the shipped Xiaojing Web and Finance preset, uses a bound customer, executes `finance_calculation`, and records the tool schema and complete trial result.

The preset composition test proves Finance keeps the Standard toolset while adding the four Finance tools, discovers all five workflow skills plus document reading, and loads their actual content. The product-layer verifier checks package discovery, profile isolation, the compatibility adapter, exact consumer differences, and the complete skill inventory. Package typecheck and build validate both source and published faces.

## Consequences

Finance can now perform a small set of reproducible trial calculations and apply consistent professional workflows without claiming a filing, posting, approval, or payment result. The result is auditable and removable, but deliberately incomplete. Mixed VAT rates, special VAT methods, many incentives, annual settlement, non-salary IIT, local exemptions, filing forms, Youcheng, SDOO, and compliance decisions remain outside this release and require later capability packages or verified evidence.
