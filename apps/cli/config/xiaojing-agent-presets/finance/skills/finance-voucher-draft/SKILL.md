---
name: finance-voucher-draft
description: Prepare accounting voucher entries from business facts and source documents; when explicitly requested, create a Youcheng financial voucher through versioned preview, mandatory confirmation and verified readback. Creation is not posting or reimbursement.
whenToUse: A user asks how to book a transaction, prepare or create a financial voucher, revise a preview, or check the outcome and originals of a previous creation.
user-invocable: true
---

# Drafting accounting vouchers

Separate accounting advice, a local preview and an externally created voucher. A request to draft or explain does not authorize creation; creation never means audit, posting or payment.

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

## Prepare and create in Youcheng

For a bound Youcheng client, use `finance_references` to resolve real enabled leaf subjects and auxiliary codes. Interpret the user's business meaning before looking up candidates; the user's phrase is not an exact subject-code query. Do not invent a code or create reference data to bypass a missing match. Ask only for unresolved facts that change the entry or a required field; an unspecified voucher number may remain missing in a draft but must be previewed before creation.

Use `finance_prepare_voucher` to save the complete proposed entries and the current session's imported source paths. Use its returned ID/version for revisions, then show the new preview; an old confirmation does not cover changed content. Never silently omit an original or drop foreign-currency data to make validation pass. Preserve original amounts and user-confirmed rates; the Host checks each original amount times rate with decimal half-up rounding to two base-currency decimals. This checks arithmetic, not whether the selected rate is appropriate. Do not copy floating-point rounding errors from a browser display or silently change proposed amounts.

Only when the user requests external creation, call `finance_create_voucher` with that exact ID/version. Its mandatory approval presents the complete proposal and upload destination. Do not replace it with a chat assertion of consent, direct API calls or a separate reimbursement workflow. Selected originals are uploaded by this operation; do not ask to upload them again merely because their private signed links are hidden from the model.

## Read the result without creating duplicates

An accepted ID proves reception, not every validation. Read accounting and auxiliary states and `readback.originals`: `matched` identifies verified copied bytes; retention `pending` needs a later read after the source-link expiry; `verified` proves that later copy check; `unavailable` is not proof of no attachment. Upload receipts are not copy-verification evidence. A metadata warning must not be turned into a raw vendor filename or signed URL.

Use `finance_prepare_voucher` with `inspect` and the same ID to recover after cancellation, failed readback or restart. Never prepare another copy of the same voucher to work around an unknown result. Without an accepted ID, preserve uncertainty and report what needs reconciliation. `complete` means this voucher's accounting, auxiliary, currency and selected-original technical checks passed; it does not certify invoice authenticity, accounting advice, posting or the entire product's readiness. Currency readback checks the actual direct amount/rate fields, not the presence of a vendor array; unavailable currency evidence is not completion.
