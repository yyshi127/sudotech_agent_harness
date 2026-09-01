---
name: finance-reimbursement
description: Use for preliminary reimbursement review, evidence organization, policy checks, amount reconciliation, and preparation of a review conclusion. Keep document facts, company-policy requirements, tax rules, and approval decisions separate.
whenToUse: A user asks to review, organize, calculate, or prepare a reimbursement package or reimbursement opinion.
user-invocable: true
---

# Reviewing reimbursements

This workflow prepares a review opinion. It does not approve, reject, pay, submit, or alter a reimbursement in an external system.

## Establish the applicable context

For a real client task require a bound client. Confirm the claimant, purpose, trip or activity, period, cost center or project when relevant, currency, advance and repayment facts, and the company's reimbursement policy. If company policy is absent, do not replace it with a guessed industry norm.

Use `finance_document` to read the reimbursement form, invoices, receipts, itinerary, payment evidence, contract, approval, and other attachments. Preserve source locators and list missing documents.

## Review the package

Check:

1. identity, dates, purpose, amount, currency, and party consistency;
2. arithmetic, duplicates, advances, personal portions, and reimbursement totals;
3. invoice completeness and risk clues using the invoice-review workflow;
4. company-policy requirements and approval chain;
5. current tax treatment only after `finance_evidence` establishes the applicable rule;
6. supported deterministic tax arithmetic through `finance_calculation` when needed.

## Return a decision-ready opinion

Classify each item as `通过初审`, `补充材料`, `金额调整建议`, `政策待核验`, or `不建议通过`, with source locator, reason, impact amount, and next action. Finish with reconciled totals and an explicit statement that the result is a preliminary review and not an approval or payment result.

If later tools connect to a reimbursement system, require user approval for the final external submission and verify the returned final state. Never simulate success.
