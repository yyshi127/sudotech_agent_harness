---
description: "Channel-neutral approval service for one-shot decisions and operation-class authorization within one session."
kind: "package-reference"
---

# @deepseek-ai/dsh-user-approval

English | [中文](README.zh.md)

## Summary

Use this package to require a decision before a sensitive tool action proceeds. The `ask` policy consults the deployment's answerers; `never` rejects ordinary requests without prompting. Missing or failed answerers return `unavailable`. Trusted requesters may offer authorization for one operation class and target scope within the requesting session. Every request, decision, and authorization reuse is audited. The model sees the resulting tool outcome and current policy, but not the human permission UI or audit events.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

`setAutomaticApproval(session, enabled)` accepts explicit authorization projected by a trusted product from logged user intent. It grants ordinary and mandatory requests, even under `never`, and settles already displayed questions by withdrawing their answerer signal. Cancellation, revocation before the decision commits, and audit failures still prevent execution. The service does not persist this flag: the owner must reconstruct, restrict, and revoke it. Without this flag, existing policy and classified-authorization behavior are unchanged.

Compose this service when sensitive tool actions should pause for a human or machine decision instead of running unconditionally. The tools pipeline and the sandboxed bash tool route their `ask` decisions through this seam and fail closed when it is absent, so interactive deployments mount it with at least one answerer.

### Composing answerers

Answerers are `approval/request` waterfall listeners: return an outcome to answer for an owned agent, or call `next()` to delegate. Agent-scoped listeners receive only that agent's requests, and a deployment composes one terminal answerer — sibling listener order is not a policy-priority mechanism. Without a terminal answerer, requests resolve `unavailable` and fail closed; the service itself never prompts a human.

### Setting the policy

The effective policy is the one set for the session, falling back to the configured default. `ask` (the default) delegates to the composed answerers; `never` rejects every ordinary request deterministically before interactive dispatch. Mandatory confirmations use `requestMandatory` and still fail closed without an answer or matching explicit session authorization.

```yaml
- name: '@deepseek-ai/dsh-user-approval'
  config:
    policy: ask
```

| Field | Default | Meaning |
|---|---|---|
| `policy` | `ask` | Default for sessions without an `approval/policy` override |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-user-approval) is the exhaustive source for every accepted field and its JSDoc. `setPolicy(agent, policy)` switches a live agent and queues a "changed by the user" message for its next model step; `setApprovalPolicy(session, policy)` is the direct durable write path used by session initialization.

### Requesting a decision

`request(req)` names the agent, tool, optional call id and reason, and an abort signal. Optional `displayReason` supplies localized presentation text without changing the logged reason. It requires an open turn: an idle or between-turn caller throws before auditing anything. Aborting withdraws the question — the request settles `cancelled` and a late answer is discarded. A failure that prevents either audit append from committing rejects instead of returning an unlogged decision.

Trusted requester code may supply `reusable: { category, scope, label, displayLabel? }`; the model must not choose these values. `category` identifies the operation and `scope` its exact target; `label` and optional localized `displayLabel` explain both to the user. An answerer may then return `allowed-session`. The service returns the unchanged `allowed-once` outcome and reuses that authorization only for matching category and scope in the same Session. Unclassified requests remain one-shot. Mandatory consumers opt into reuse explicitly; unclassified deletion confirmations remain one-shot.

Concurrent matching requests wait for the first decision and audit commit before rechecking authorization. Creation and reuse are recorded in optional audit fields. A live grant becomes reusable only after its decision append succeeds. After restart, only originally closed turns restore grants; interrupted-turn repair does not authorize the unfinished tail. Earlier closed-turn grants remain valid, and copied history never authorizes another Session. Ordinary `never` still rejects even when a matching authorization exists.

### What the model and user see

The model sees only the asking consumer's eventual tool outcome — allowed, rejected, cancelled, or unavailable — plus the current policy in the runtime-context snapshot; the audit events and the human permission UI are not model context. A `never` switch is announced to the model by a sourced user message, and both policies contribute their complete current meaning to the snapshot.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The observable behavior is covered in [Use this package](#use-this-package); this section explains dispatch, policy enforcement, and the audit path.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `ApprovalService`: request dispatch, policy fold and write path, runtime-context contribution |
| [`src/types.ts`](src/types.ts) | `ApprovalRequestId` brand and outcome types |

### Dispatch

`decide()` races the answerer waterfall against request cancellation and service disposal and contains every answerer failure. Answerers receive the same readonly data references with a combined signal, so standalone service unload withdraws their prompts. A throwing listener or unknown answer fails closed to `unavailable`. The `never` policy is enforced before reuse and dispatch and rechecked before committing the decision. The audit pair identifies the action's turn; persistence retains physically valid interrupted history, while authorization restoration excludes repaired turns.

### Policy and the runtime-context snapshot

The system-prompt contribution `approval:policy` states the complete current meaning of the effective policy — `ask` with its fail-closed consequence, or `never` with its non-escalation consequence — after retained history, so switching policy appends a new full snapshot instead of rewriting the stable request header. `setPolicy()` also injects a sourced user message announcing the change for the next step.

### Audit

`request()` appends `approval/asked` with the request identity and tool, then `approval/decided` with the closed outcome; the exact appended fields live in [`src/index.ts`](src/index.ts). Both are log-only.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the approval vocabulary to the consumers and the design rationale.

- [Approval subsystem reference](../../../docs/subsystems/approval.md) — the shared request/outcome vocabulary and the `ctx.approval` Cordis surface.
- [Approval seam Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-approval-seam.md) — design rationale for the seam.
- [Sandbox reference](../../shell/tool-bash/README.md) — how the sandboxed bash tool consumes approvals for escalated retries.
- [Interaction group map](../README.md) — adjacent permission preset and question packages.

-----

<a id="model-experience"></a>
## Model Experience

### Current approval policy context

#### What the model sees

The first request and each effective policy or authorization change append a full runtime-context snapshot after retained history. Sessions without reusable authorization retain the policy text below. An authorized Session states that reuse is limited to the approved operation class and target scope; ordinary `never` remains deterministic and unclassified mandatory confirmations still require individual decisions. Unchanged requests retain the earlier snapshot without adding another message.

##### Ask-policy contribution

```markdown
Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.
```

##### Never-policy contribution

```markdown
Ordinary approval prompts are disabled in this session: actions that require ordinary approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`). Mandatory security confirmations, including deletion confirmation, still require the user to approve each action.
```

#### Token effect

One concise context message on the first request and on an effective change; unchanged requests add no duplicate policy tokens.

#### KV Cache effect

Append-only after retained history. An `ask`/`never` switch preserves the stable system and conversation prefix instead of rewriting the first wire message.

### Tool outcome

#### What the model sees

`approval/asked` and `approval/decided` are log-only. The model sees only the asking consumer's eventual allowed, rejected, cancelled, or unavailable tool outcome; the human permission UI is not context.

#### Token effect

Zero duplicate audit tokens. A rejection may replace a normal tool result with a small retained error, while an allowance leaves the consumer's ordinary result.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the seam is a poor fit or needs special composition care. They are current package constraints, not a general permission comparison.

- **Requests are valid only inside an open turn** — an idle or between-turn caller throws before auditing; a durable out-of-turn approval workflow is deferred.
- **Session scope only** — authorization is limited to a trusted operation class and exact target within one Session; there are no global rules or individual-grant revocation controls. Session policy remains `ask` / `never`.
- **The request carries no tool arguments** — an answerer sees the tool name, reason, and optional call id; the ACP machine channel requires a call id and delegates requests without one.
- **No built-in answerer** — headless or incompletely composed deployments resolve `unavailable` and fail closed; the service itself never prompts a human.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
