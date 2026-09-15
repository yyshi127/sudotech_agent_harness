# Agent Note: Financial ledger editor without reimbursement settings

Status: implemented

English | [中文](2026-09-07-finance-editor-without-reimbursement.zh.md)

## Problem

The financial ledger editor includes reimbursement credentials even though the current product work is finance-only. Removing this entry must not erase independently saved credentials or historical drafts.

## Decision

The ledger overlay does not mount the reimbursement settings component or inject its read, save, and test actions. Financial connection fields and the separate attachment-storage settings remain available. The [existing reimbursement capability](2026-09-04-reimbursement-draft-attachments.md) retains its backend services, credentials, and receipts; this UI change is not full business isolation.

## Alternatives considered

**Hide the section with CSS.** A mounted hidden section could still read configuration and retain callable actions.

**Remove reimbursement services and data.** The user requested removal of ledger configuration fields, not deletion of saved records or backend functionality.

## Consequences

Users cannot configure reimbursement from ledger information. The assembled Web editor regression checks absence of reimbursement fields and controls while exercising financial save, connection verification, and responsive layout. Its accessibility snapshot records the displayed editor.
