---
name: finance-data-analysis
description: Use for analyzing financial statements, ledgers, schedules, invoices, reimbursements, or spreadsheet data. Validate source coverage, calculate reproducibly, explain variances and risks, and separate source facts from interpretation.
whenToUse: A user asks for financial trends, comparisons, reconciliations, ratios, anomalies, summaries, or management analysis.
user-invocable: true
---

# Analyzing financial data

## Define the question and population

Confirm the entity, period, currency, accounting basis, comparison basis, and expected output. For client-specific conclusions require a bound client. Identify which files or tables form the population and whether any periods, sheets, rows, or entities are missing.

Read normalized PDF, DOCX, XLSX, PPTX, CSV, or text content with `finance_document`, preserving source locators. Use native file tools only for data already available in the session work directory. Do not silently combine incomparable periods, currencies, tax bases, or accounting standards.

## Make the analysis reproducible

Show the source fields, filters, transformations, formulas, rounding, exclusions, and reconciliation difference. Use `finance_calculation` for its supported statutory trial calculations. For other arithmetic, produce a transparent worksheet or script in the session work directory and verify totals before interpreting them.

## Report clearly

Lead with the decision-relevant conclusion, then provide:

- data scope and completeness;
- key totals and reconciliations;
- trends, variances, ratios, and anomalies;
- likely drivers clearly labeled as inference;
- finance or tax risks requiring follow-up;
- limitations and additional evidence needed.

Do not imply causation from correlation or claim that a source is complete when coverage was not verified. Publish a formal report only when the user explicitly asks for a final deliverable.
