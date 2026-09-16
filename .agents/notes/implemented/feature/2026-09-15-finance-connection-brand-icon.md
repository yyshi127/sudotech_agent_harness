# Agent Note: Finance connection brand icon

Status: implemented

English | [中文](2026-09-15-finance-connection-brand-icon.zh.md)

## Problem

A generic green success dot confirms connectivity but does not identify which finance system owns the active ledger binding. Rendering a vendor wordmark at full width would crowd the compact Workspace row, while hard-coding Youcheng inside the shared Workspace browser would couple product-neutral UI to one connector.

## Decision

`WorkspaceCategoryBadge.brandIconSrc` lets a product category provide a static brand image for a successful badge. The shared row clips the image to its leading 16 px square and uses it instead of the success dot; pending, failed, and unverified states retain their product-neutral indicators and accessible status label.

The Finance client category supplies the Youcheng Finance logo only after a Youcheng connection check succeeds. The existing connection action remains between the customer and ledger names, including its green horizontal success presentation. The source wordmark remains intact as a packaged product asset; the row displays only its leading square mark.

## Alternatives considered

**Hard-code Youcheng in the shared Workspace row.** This was rejected because the shared package must not interpret Finance connector identities.

**Render the complete wordmark.** This was rejected because the narrow sidebar row cannot accommodate vendor text without competing with the customer and ledger names.

**Replace every state indicator with a vendor mark.** This was rejected because a brand mark does not communicate checking, failure, or unverified state.

## Consequences

Connected Youcheng rows identify the active finance system without adding a second text label. A future connector can provide its own image through the same optional badge field; no vendor registry or speculative connector UI is introduced. The product build must package each referenced image, and providers remain responsible for meaningful accessible status text.
