# Separate Youcheng module quick actions

English | [中文](youcheng-quick-actions-plan.zh.md)

Current scope: finance only. Reimbursement and R-stage entries below are deferred design references, not development tasks. Passing finance acceptance does not automatically start them; a later explicit user request is required. Finance and reimbursement business contexts, credentials, data access, tasks, and confirmations remain isolated.

## Purpose and sequence

Quick actions serve independent finance and reimbursement modules under the [development plan](youcheng-natural-language-development-plan.md). Develop finance entries first. No new reimbursement entries are developed before full finance acceptance; preserve existing reimbursement examples without expansion. Current work is planning only.

Buttons prefill editable prompts rather than calling APIs. Sending uses the active module's own tools, checks, preview, confirmation, task records, and readback. A button or changed prompt cannot switch module identity implicitly.

## Minimal design

Each entry records ID, label, prompt, owning module, and required action. The backend supplies support status and enforces module/client identity. No universal business dispatcher or dynamic button designer is needed.

| Module | Entry | Acceptance dependency |
|---|---|---|
| Finance | Find vouchers / balances | F1; accurate ledger, period, and completeness |
| Finance | Prepare and create a voucher | F2; separate local preparation and confirmed external write |
| Finance | Find journals / receivables and payables | F1/F3; required data and safe maintenance actions |
| Finance | View or resume finance tasks | F2/F3; independent finance task discovery and unknown-result reconciliation |
| Reimbursement, deferred | Find bills / create or edit drafts | R0/R1/R2; start only after F4 acceptance |
| Reimbursement, deferred | View reimbursement tasks / scan invoice folder | R1/R3; no finance records, permissions, or task execution |

Entries may be tested during their module's development; this does not replace full module acceptance. Unsupported posting, approval, payment, or other actions remain unavailable. Explain missing permission or capability rather than routing to another module.

## Isolation acceptance

Finance sessions load no reimbursement tool, rule, task list, or business data; reimbursement sessions load no finance equivalent. Switching modules creates a fresh module context without carrying pending confirmation or source authorization. Editing a prompt into another module's action stops for an explicit context change rather than dispatching across modules.

Reuse only display and input components. Query results, task progress, confirmations, and settings remain module-scoped. A common customer name never grants access to the other business.

Complete finance and obtain F4 acceptance before adding reimbursement entries. Do not launch development or business writes from this proposal.
