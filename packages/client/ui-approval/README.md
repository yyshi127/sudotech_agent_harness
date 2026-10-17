---
description: "Browser approval UI that answers Host permission requests through the scoped interaction path."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-approval

English | [中文](README.zh.md)

## Summary

Browser approval presentation over the Agent-scoped Remote Event waterfall. The plugin publishes each pending request through `ctx.uiSession`, takes over the Conversation composer, optionally renders correlated Tool detail, and returns the user's decision to the waiting Host request. Use it when a browser must collect approval for a waiting Host operation.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

Focus the approval detail region to approve once with Enter or reject with Escape. The mounted plugin reserves both keys against editable shortcuts. Focused buttons retain their native Enter action; repeated and IME candidate keys cannot activate them. Input controls keep their own keys. Keyboard and pointer actions share one pending-request lock; a withdrawn or replaced request cannot accept another answer, and an earlier failed answer cannot unlock its replacement.

<a id="model-experience"></a>
## Model Experience

None, as this package presents approval requests in the browser and registers nothing model-facing.

#### KV Cache effect

None; approval request and response rendering does not alter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Every request offers allow-once and reject. A Host request eligible for reuse also offers “Always allow” for the same operation range throughout the current session and displays the requester's localized range label. The Client stores no grants; Host-side approval packages own range matching and lifetime. Requester-supplied localized copy follows the UI language without changing the audit reason or translating model-generated text.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
