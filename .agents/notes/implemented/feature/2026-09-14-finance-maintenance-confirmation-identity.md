# Agent Note: Finance maintenance confirmation identity

Status: implemented

English | [中文](2026-09-14-finance-maintenance-confirmation-identity.zh.md)

## Problem

Finance maintenance persists an exact prepared operation before requesting the Finance-specific mandatory confirmation. The confirmation previously displayed the vendor target and version but omitted the local prepared-operation ID. A tester or audit record could therefore not unambiguously match the visible confirmation to the durable operation that would be reserved and dispatched.

## Decision

The Finance-specific mandatory confirmations for voucher and journal deletion include the local prepared-operation ID together with the exact version and target preview. Reservation still revalidates the complete saved preview and current configuration before and after approval, and dispatch remains single-use under the durable target claim. Missing or rejected confirmation stops before the Youcheng mutation request and leaves the operation available for read-only inspection.

The product-wide destructive-action confirmation remains a separate first layer. This change does not bypass either layer, accept caller-supplied approval, add a test-mode exemption, or broaden the authorized target scope.

## Alternatives considered

**Show only the Youcheng target ID and version.** Rejected because the same external target can have multiple separately prepared local attempts after an explicit no-send result, while an earlier consumed or uncertain attempt must remain distinguishable.

**Relax the live acceptance harness when the local ID is absent.** Rejected because it would certify a confirmation that cannot be tied to the persisted operation and would hide a product auditability gap.

## Verification

Host tests assert that both mandatory-confirmation reasons contain the generated prepared-operation ID, amount and target. The complete Finance Host suite passes 137 tests. Shipping voucher-deletion and journal-deletion Web scenarios pass snapshot refresh and independent replay. Real main-application acceptance rejects the old confirmations before either vendor delete request; a new synthetic journal verifies the corrected confirmation.

The laboratory driver may reuse an attachment-verified voucher fixture in one new run only when the original detailed approval was rejected, the session is idle, and the original durable operation remains prepared without a reservation or outcome. It binds the source to one child run and copies immutable fixture evidence, never operation intents. Eight offline guard tests cover wrong ledgers, changed versions, accepted or unknown operations and missing refusal evidence. The new run must prepare another operation and obtain both confirmations; it does not replay the original operation. Unrelated-record comparisons use the fresh deletion baseline so other authorized tests during attachment-expiry waiting are not attributed to voucher deletion.

## Consequences

Confirmation text is longer by one opaque local identifier, but the approved operation is now identifiable across the dialog, durable record and recovery evidence. An attempt whose confirmation was rejected or whose dispatch intent was already consumed is not silently reused; a fresh operation is required when the existing safety rules permit another attempt.
