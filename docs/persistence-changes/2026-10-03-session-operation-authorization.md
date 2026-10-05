---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-03-session-operation-authorization

English | [中文](2026-10-03-session-operation-authorization.zh.md)

## Summary

Adds optional trusted operation classification and session-owned authorization audit fields to approval questions and decisions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-03-session-operation-authorization
baseline: false
changes:
  - root: "event:approval/asked"
    previous: "2026-09-11-initial"
    after: "d53791005c8503dd7c37fccfafb06b9213270c0660621b87f70e2f97f17792da"
    decision: same-version
  - root: "event:approval/decided"
    previous: "2026-09-11-initial"
    after: "53b59363ea6c46bb0ef4b01b02f15eed3c26187c9c13015c2aa867131311d730"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing approval records and the four ApprovalOutcome alternatives remain unchanged. Absence of the optional fields grants no reusable authorization. Creation and reuse belong to one Session id and exact category/scope. Live reuse begins only after the decision append commits; restart restores grants only from originally closed turns and excludes interrupted/forked repair closures. Valid interrupted history remains readable without creating authorization. Released validators and the Session writer version remain unchanged.

<a id="verification"></a>
## Verification

Node 24 running node_modules/vitest/vitest.mjs run packages/interaction/user-approval/tests packages/acp/acp/tests/approval.spec.ts passed 65 tests across four files. Real Loader/Agent tests cover cancellation, late answers, unload, failed audit commits, concurrent matching requests, new-session isolation, and actual production JSONL/Zstandard persistence plus AgentRegistry.resume for closed grants and interrupted-tail rejection.

<a id="dev-note"></a>
## Dev Note

None.
