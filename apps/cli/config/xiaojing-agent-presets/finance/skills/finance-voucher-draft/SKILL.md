---
name: finance-voucher-draft
description: Use for drafting accounting voucher entries from verified business facts and source documents. Build an auditable draft with assumptions, account rationale, amounts, evidence gaps, and review status; never claim that a voucher was posted.
whenToUse: A user asks how to book a transaction, prepare a voucher draft, suggest debit and credit entries, or organize supporting evidence.
user-invocable: true
---

# Drafting accounting vouchers

Create a reviewable draft, not a posted voucher.

## Gather the minimum facts

For client-specific work, require a bound client and use its immutable accounting-standard and policy context. Read uploaded source files with `finance_document`. Establish the transaction date, parties, business substance, tax treatment, currency, amounts, payment state, cost or asset attribution, and available supporting documents.

Do not infer missing business substance from an invoice title alone. If the accounting standard, client policy, tax treatment, or account mapping changes the entry, identify the missing fact or branch the draft.

## Calculate and draft

Use `finance_calculation` when a supported VAT, surcharge, enterprise-income-tax, or salary-IIT calculation is needed. Use `finance_evidence` for current rule-dependent conclusions.

Return:

- voucher date and proposed summary;
- debit and credit lines with account, auxiliary dimension, amount, and rationale;
- source-document locator for each material amount;
- calculation trace or rule reference when used;
- assumptions, missing evidence, and review items;
- status `草稿，未过账`.

Debits and credits must balance before presenting a complete draft. If they do not balance, stop and show the unresolved difference. Never claim posting, approval, payment, filing, or external-system success without a corresponding verified tool result.

Keep working files in the current session work directory. Use `finance_files` only when the user explicitly requests a final published deliverable or archive copy.
