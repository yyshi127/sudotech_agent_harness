# Agent Note: Mandatory deletion confirmation

Status: implemented

English | [中文](2026-08-21-mandatory-deletion-confirmation.zh.md)

## Problem

The `never` approval policy rejects ordinary approval requests before any answerer runs. Full access uses that policy, so a model-issued `pwsh` command such as `Remove-Item` could execute without a question when the shell did not otherwise request sandbox escalation. The same gap affected deletion controls inside Xiaojing browser and Windows automation. Deletion must require a fresh user decision regardless of the ordinary session policy, while a missing, rejected, cancelled, or expired decision must leave the action unexecuted.

## Decision

`ApprovalService.requestMandatory()` uses the existing scoped `approval/request` answerer chain and audit pair but does not apply the ordinary `never` pre-dispatch rejection. It remains turn-enclosed and fail-closed, and `allowed-once` remains the only grant. `request()` and its deterministic ordinary-policy behavior do not change.

The Xiaojing product plugin detects explicit deletion tool names and shell commands. Its pre-execute listener requests mandatory confirmation and marks only the current tool execution token after a grant. A monotonic `tools.guard()` then denies every matching call without that mark, so a different pre-execute listener cannot short-circuit the confirmation. The mark is consumed once and cleared from the final result path. Browser and Windows providers use mandatory requests for delete, remove, or uninstall targets and explicit Delete-key actions; their other high-impact actions keep ordinary approval behavior.

The product automation context states that deletion remains confirmation-bound under Full access and `never`, and prohibits changing or obscuring a deletion command to evade the question. The shell classifier recognizes common PowerShell, command-shell, POSIX, Git, Python, Node.js, .NET, `find`, and `robocopy` deletion forms. A new tool capable of deletion must classify that operation in its own provider when its destructive intent is not visible in the tool name or arguments.

## Alternatives considered

- **Treat Full access as implicit deletion consent.** Full access is useful for unattended ordinary work, but permanent data loss is not safely reversible and requires a narrower decision.
- **Change `never` to prompt for every high-impact action.** This would silently change the existing policy and make unattended ordinary operations interactive. A separate mandatory entry point keeps the exception explicit.
- **Rely only on a prepended waterfall listener.** A later prepended listener can claim the waterfall without delegation. The monotonic guard is the non-bypassable denial backstop within the composed product runtime.
- **Parse every shell language completely.** Multiple shells and embedded scripts make complete static interpretation impractical. Conservative recognition covers explicit model-generated deletion commands, while opaque deletion-capable tools must enforce the policy at their provider.

## Consequences

Desktop and Weixin sessions now receive the existing confirmation UI or six-digit Weixin challenge before a recognized deletion, even under Full access. A denial, timeout, disconnect, unavailable answerer, or unconfirmed short-circuit prevents tool execution. The policy does not claim to infer hidden destructive behavior inside arbitrary third-party executables, so future deletion-capable tools must add an explicit mandatory classifier and focused regression coverage.
