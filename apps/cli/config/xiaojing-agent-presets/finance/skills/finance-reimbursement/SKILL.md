---
name: finance-reimbursement
description: Review reimbursement evidence or create an explicitly requested invoice-backed Youcheng draft. Keep document facts, company policy, tax rules, and approval decisions separate.
whenToUse: A user asks to review, organize, calculate, prepare, or save a reimbursement draft with invoices.
user-invocable: true
---

# Reviewing reimbursements and saving requested drafts

Review requests produce an opinion without external writes. An explicit request to create a draft uses `finance_reimbursement` after one-time confirmation. Neither workflow submits approval, pays, or modifies existing bills.

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

## Save an explicitly requested draft

Use `finance_reimbursement` to discover the actual order and fee templates, required fields, applicant, department, employee, and payee. Do not search source code or credentials. The separate `staff` employee field uses `employeeId`; it does not default to the applicant. Ask only for missing business facts or ambiguous choices. Do not change a selected template or department to bypass a required field.

Read each imported PDF or image original and verify amount, dates, and travel direction. Matching person and date do not prove a return trip or permission to combine invoices. Use only the files and purpose confirmed by the user. If the user cancels a question or write confirmation, stop and wait for new explicit instructions; do not invent answers or keep asking equivalent questions.

The create tool uploads the selected originals to private OSS and supplies a JSON-encoded signed URL array in the fixed `attachment` field. Template metadata may omit this field; that is not evidence that attachments are unsupported. Do not switch templates, convert images to PDF, or call the separate upload tool for that reason. An `invoice` component associates invoice-ledger records and is not the ordinary attachment field; unsupported required invoice associations remain blocking.

When the fee template includes `attachment`, the tool also attaches each fee's selected originals to that fee's `feeComponentList`. A successful draft receipt's `attachmentNames` identifies uploaded originals; signed URLs remain Host-only. Their absence from the model response does not mean upload failed. Missing attachments in the vendor UI require checking the order and fee rows, not another standalone OSS upload. Do not claim that ordinary attachments created or associated invoice-ledger records.

Show the bill, selected invoices, identities, amount, and OSS transfer in the mandatory one-time confirmation. Save only a draft. Report the returned operation ID and verified status; a timeout or missing result requires `status` readback, never a changed payload or blind second create. Links sent to Youcheng do not prove it retained the original file; that requires a separate check.
