---
name: finance-invoice-review
description: Use for reviewing Chinese invoice files or invoice data for completeness, consistency, deductible-tax prerequisites, duplicate-risk clues, and accounting follow-up. Read the source first, separate document facts from policy judgments, and produce a review table without claiming authenticity verification.
whenToUse: A user asks to inspect, check, compare, organize, or identify risks in one or more invoices.
user-invocable: true
---

# Reviewing invoices

This workflow supports professional preliminary review. It does not verify an invoice against a tax-authority platform, validate an electronic signature, or replace the user's internal approval.

## Establish the review scope

Confirm the client when the task depends on a specific entity. In a general Finance consultation, review only document facts and generic risks; do not infer the buyer, accounting treatment, deductibility, or business purpose.

Use `finance_document` to list and read every relevant source. Use its visual route when the document exposes retained images or rendered pages. Preserve page, row, paragraph, slide, or image locators.

## Review in four layers

1. **Document facts** — invoice type, code and number, issue date, buyer and seller, tax identifiers, goods or service description, amount, tax rate, tax, total, remarks, and source locator.
2. **Internal consistency** — totals, arithmetic, parties, dates, duplicated numbers or amounts, and visible alterations or missing fields. Use `finance_calculation` for supported deterministic arithmetic instead of mental estimates.
3. **Business evidence** — contract, order, acceptance, payment, travel or reimbursement records, and stated business purpose. Mark missing material; never invent it.
4. **Policy judgment** — when a conclusion depends on current tax or invoice rules, use `finance_evidence` and label unresolved applicability `待核验`.

## Deliver the result

Produce a compact table with source locator, confirmed facts, anomaly or missing evidence, severity, suggested follow-up, and evidence status. Separate `已确认`, `合理推断`, and `待核验`. State explicitly that authenticity and invoice status were not checked unless an authoritative verification tool returned that result.

Do not post vouchers, approve reimbursement, submit tax forms, or change an external system. If the user asks for a reusable report, create it in the current session work directory; publish it only when the user clearly asks for a final deliverable.
