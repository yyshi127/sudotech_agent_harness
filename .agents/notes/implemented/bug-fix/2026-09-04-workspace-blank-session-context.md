# Agent Note: Workspace blank-session context

Status: implemented

English | [中文](2026-09-04-workspace-blank-session-context.zh.md)

## Problem

The new-session preset chip can retain an earlier choice after another plugin changes the current session's preset. A blank session selected directly from the sidebar can also bypass the product category's context preparation, leaving a client workspace in general consultation.

## Decision

The [preset chip](../../../../packages/client/ui-agent-preset/README.md) reflects the current session's committed preset whenever no user choice is pending. A pending choice retains priority and is consumed only through the existing apply flow. Display synchronization performs no selection RPC.

The [Workspace browser](../../../../packages/client/ui-workspace/README.md) routes the current blank row through its startable product category in both grouped and flat views. The existing Finance provider selects the preset and stages the workspace's client before opening. Historical sessions and ordinary or creation-disabled workspaces continue opening directly.

The [Finance controller](../../../../packages/client/ui-xiaojing-finance-clients/README.md) invalidates displayed context after successful staging. Reusing the current session therefore refreshes the composer without requiring navigation to another session. Failed staging does not publish a context change.

## Alternatives considered

**Changing only the visible label** leaves client staging absent and does not establish the context needed by business tools.

**Embedding Finance selection in the generic browser** couples shared UI to one product. The existing category activation already owns that behavior.

## Consequences

Sidebar entry and composer state agree without changing persisted client data, workspace paths, or historical bindings. Clicking a blank product row can repeat its category preparation; categories must continue rejecting unavailable contexts before opening them.

## Verification

Focused tests pin external preset updates, blank-row activation in both layouts, and direct historical navigation. The assembled Web scenario selects a previously unstaged client blank, switches through ordinary and consultation modes, and queries a voucher with a verified durable client binding. Only the model and vendor network are mocked.
