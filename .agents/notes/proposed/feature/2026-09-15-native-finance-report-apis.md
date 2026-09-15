# Agent Note: Native finance reports through supported server APIs

Status: proposed

English | [中文](2026-09-15-native-finance-report-apis.zh.md)

## Problem

Xiaojing eventually needs Youcheng's native general ledger, detail ledger, auxiliary ledger, balance sheet, income statement and cash-flow statement. The public Finance catalog does not expose these six operations. The observed website endpoints reject AppKey access-token authentication, while website-token and browser-session dependencies do not provide a reliable product integration.

## Proposal

Implement the six reports only through Youcheng server APIs that accept the Finance client's existing AppKey and access token. Each request must bind the saved ledger ID, explicit accounting period, supported filters and complete pagination without a browser, user phone number, interactive login or copied session credential. Existing native-response projection and literal-text workbook code may be reused only after the supplier response fields and pagination behavior are qualified against ledger35616.

Keep the report consumer disabled until all six server operations are documented, callable and independently verified. The ordinary Finance preset must not advertise or mount a partial report capability.

## Alternatives considered

**Chrome or extension automation.** Xiaojing cannot control the required browser state reliably enough for a Finance deliverable, so this path remains rejected even though captured responses are useful schema evidence.

**Phone-based Finance SSO.** The documented endpoint creates a ten-minute human login link and requires an undocumented registered `source`. It couples background reporting to a person and does not qualify as a server report API.

**Reconstruct native reports from subject balances.** Derived tables cannot preserve supplier templates, formulas, native ledger rows or statement semantics, so they do not satisfy a native-report capability.

## Acceptance criteria

- Official supplier documentation identifies all six server endpoints and their authentication, ledger, period, filter, pagination and response fields.
- Read-only calls with the configured application credentials return ledger35616 data without browser or SSO state and reject a foreign ledger.
- Product queries preserve native blank amounts, exact decimals, row order, column meanings and source metadata; incomplete or changed pages do not publish a result.
- Natural-language, cancellation, timeout, empty-result, restart, cross-client isolation, workbook comparison and current-package installation tests pass for all six before the consumer is enabled.

## Risks

Youcheng may not expose these operations. Until it does, the six reports remain unavailable rather than silently falling back to browser automation or locally reconstructed statements.
