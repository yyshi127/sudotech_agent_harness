# Agent Note: Private attachments and confirmed reimbursement drafts

Status: implemented

English | [中文](2026-09-04-reimbursement-draft-attachments.zh.md)

## Problem

A finance-ledger connection cannot authorize the separate reimbursement service. Chat also needs a vendor-accessible attachment without exposing local files, application secrets, or an unrestricted cloud bucket. An ambiguous network failure during a write must not become a duplicate bill.

## Decision

The [Finance Host](../../../../packages/xiaojing/xiaojing-finance-domain/README.md#private-attachments-and-reimbursement-drafts) owns computer-wide private OSS settings and a separate reimbursement credential per client record. The product UI exposes write-only configuration; no shared secret is bundled. Existing [immutable session bindings](2026-08-27-xiaojing-finance-client-domain.md) and [voucher-read isolation](2026-09-04-temporary-youcheng-voucher-query.md) remain authoritative and independently useful.

The retained reimbursement operation resolves current templates and identities through bounded reads, validates required fields, and asks for mandatory one-time confirmation before cloud writes. Imported originals are checked against the current session log and uploaded through the Host. Vendor support confirmed `attachment.bindingVal` as a JSON-encoded URL array within `orderComponentList`; this fixed field is independent of its presence in template metadata, and ordinary attachments do not require a preceding invoice-ledger write. A separate employee field requires explicit selection rather than defaulting to the applicant. The create payload fixes draft status, and only status readback establishes success.

Cancelled or failed questions and rejected bill confirmations block writes until new human text arrives; pending decisions also block writes. This is reconstructed from the durable log, not inferred from model prose. Resumption still requires mandatory confirmation of the exact bill. Model instructions separately prohibit invented answers, unconfirmed invoice combinations, and template substitutions.

Private atomic receipts identify a request by client, session, and draft payload. A per-owner lock serializes attempts; once creation may have happened, even a changed payload in that session is blocked until reconciliation. Receipts exclude signed links and credentials. Changed credential revisions require manual reconciliation rather than reading another organization's result.

The [canonical Finance capability inventory](2026-09-15-finance-capability-inventory.md) removes reimbursement model exposure while retaining these Host services, credentials, receipts, and historical events. The current Finance preset registers no reimbursement prompt, tool, standalone attachment-upload tool, or reimbursement skill. This note therefore documents preserved backend behavior, not a current Finance chat capability.

Fee templates declaring `attachment` receive per-line links in `feeComponentList`. The Host maps the already uploaded originals by input path, so each row receives only its selected files and neither reuploads them nor duplicates the full bill's files on every row. Required ordinary attachment components are generated before validation and filled after approved uploads. Existing completed receipts remain readback-only, not an implicit edit of an existing bill.

## Alternatives considered

**Embed OSS keys in the installer.** Every installation could extract a shared cloud credential; local authorized configuration keeps the current no-login product usable without distributing that credential.

**Public attachments or ad-hoc shell uploads.** These expose financial documents or allow the model to choose credentials and arbitrary local sources instead of enforcing logged import ownership.

**Create invoice-ledger records for every attachment.** This adds a business write not required by the vendor's ordinary attachment component and does not prove correct invoice association.

**Retry every timeout.** The original write may have succeeded; durable operation IDs permit readback without blind duplicate creation.

**Delete old history when withdrawing model exposure.** Rejected because removing history loses prior confirmations and uncertain-write evidence. The backend records remain intact while current prompt, tool, and skill registration are removed.

**Send attachments only at order level.** Live metadata exposes an attachment component on the selected fee template even when the order template omits one. Supplying the order-level field alone leaves that declared fee component empty.

## Consequences

The retained backend saves supported, explicitly confirmed drafts, not arbitrary reimbursement forms. Required unsupported components and mandatory invoice-ledger associations fail before writing. Reimbursement credentials select an organization independently of the financial ledger; the confirmation identifies the organization and applicant. No approval, payment, scheduled execution, or cross-session invoice deduplication is implemented. Current Finance conversations cannot invoke this backend.

Signed links expire, and vendor transfer of original bytes remains unverified. A verified draft is not proof of durable attachment access. Real-cloud acceptance still requires authorized OSS keys, a supplied invoice, and inspection of the resulting attachment before claiming a complete operational workflow.

## Verification

Focused backend tests cover credential separation, revision conflicts, metadata redaction, cancellation, required employee selection, missing attachment metadata, attachment encoding, fixed draft status, and unknown-write retries with changed parameters. Source ownership and loopback checks remain Host responsibilities, and real-vendor attachment retention remains a named coverage gap. The assembled Finance capability snapshot proves that current Finance composition excludes the reimbursement tool and skill and identifies reimbursement as unsupported.
