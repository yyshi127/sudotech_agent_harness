---
name: finance-data-analysis
description: Use for analyzing financial statements, ledgers, schedules, invoices, reimbursements, or spreadsheet data. Validate source coverage, calculate reproducibly, explain variances and risks, and separate source facts from interpretation.
whenToUse: A user asks for financial trends, comparisons, reconciliations, ratios, anomalies, summaries, or management analysis.
user-invocable: true
---

# Analyzing financial data

## Define the question and population

Confirm the entity, period, currency, accounting basis, comparison basis, and expected output. For client-specific conclusions require a bound client. Identify which files or tables form the population and whether any periods, sheets, rows, or entities are missing.

For connected-ledger questions, use the bound Finance query tools; do not substitute document or filesystem searches. Read uploaded PDF, DOCX, XLSX, PPTX, CSV, or text content with `finance_document`, preserving source locators. Use native file tools only for data already available in the session work directory. Do not silently combine incomparable periods, currencies, tax bases, or accounting standards.

## Make the analysis reproducible

Separate quoted source values from new calculations. For a query-only answer, quote returned amounts with their original field meanings; do not reconstruct balances or introduce arithmetic merely to explain them. A returned debit/credit balance is not proved to be the difference between current-period movements. Preserve each tool's null, currency, coverage and period limitations in tables and prose alike.

Before comparing different tools, verify that their account mapping, currency, period basis, population and accounting status are comparable. A subject balance report and a cash-account journal are not interchangeable. Until those conditions are established, present each source separately as not yet reconciled; do not declare a discrepancy, an inaccurate source, missing synchronization or unposted transactions. Keep journal “接口初始余额” and “接口合计余额” under their own labels, never under subject “期初/期末” column headers.

For requested calculations, show source fields, filters, transformations, verified formulas, rounding, exclusions and reconciliation differences. Prefer a Finance tool that already returns the requested calculation with its scope and source IDs. Use `finance_calculation` for its supported statutory trial calculations. For other arithmetic, produce a transparent worksheet or script in the session work directory and verify totals before interpreting them. Do not invent calculation results in prose.

## Report clearly

Use the user's language for progress messages and the final answer. Answer the requested scope without repeatedly offering actions the user declined, including exports. Lead with the decision-relevant conclusion, then provide the applicable items:

- data scope and completeness;
- key totals and reconciliations;
- trends, variances, ratios, and anomalies;
- likely drivers clearly labeled as inference;
- finance or tax risks requiring follow-up;
- limitations and additional evidence needed.

Do not imply causation from correlation or claim that a source is complete when coverage was not verified. Publish a formal report only when the user explicitly asks for a final deliverable.
