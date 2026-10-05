---
kind: upgrade-guide
description: "Approval answerers use ApprovalAnswer for the new session-scoped choice while action consumers retain ApprovalOutcome."
---

# Session-scoped approval answers

English | [中文](guide.zh.md)

## Change

The `approval/request` waterfall accepts `ApprovalAnswer`, adding `allowed-session` to its former four answer choices. `next()` also returns `ApprovalAnswer`. Consumers of `ctx.approval.request()` and `requestMandatory()` still receive the original `ApprovalOutcome`; the service normalizes session authorization to `allowed-once` and records its scope in optional audit fields. Unclassified requests cannot create session authorization.

Answerers receive a request projection whose `signal` combines caller cancellation and service disposal. Agent and readonly data references are preserved; request-object identity is no longer preserved. Unloading the service withdraws pending prompts as well as cancelling decisions.

ACP advertises `allow-session` with `allow_always` only for trusted classified requests. The authorization belongs to the current Session's operation category and exact target scope, including after restart from an originally closed turn; it never becomes a global rule.

## Migration

1. Answerers that declare the waterfall's return or `next()` type must import `ApprovalAnswer` from `@deepseek-ai/dsh-user-approval/types`. Keep `ApprovalOutcome` for action consumers.
2. Observe the received `signal` to withdraw prompts. Match ownership through `agent` and `callId`, rather than request-object equality.
3. Offer `allowed-session` only when the request has `reusable`. Requester code supplies trusted `category`, exact `scope`, and explanatory `label`; never accept these fields directly from model arguments.
4. ACP clients must handle the advertised `allow-session` choice as authorization for this Session only. Unknown or unadvertised selections remain rejected.
5. Verify that a matching request reuses the authorization, another scope still asks, and a new Session asks again. Existing unclassified callers need no changes.
