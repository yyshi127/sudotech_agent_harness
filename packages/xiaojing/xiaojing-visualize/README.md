---
description: "Xiaojing isolated visualization cards with the original dsh-visualize palette."
kind: "package-bundle"
---

# @deepseek-ai/dsh-xiaojing-visualize

English | [中文](README.zh.md)

## Summary

Xiaojing's removable adaptation of `Nagi-ovo/dsh-visualize`. The plugin lets the model render interactive simulations, charts, comparisons, and interface mockups as cards inside the Web conversation.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Composition

Rendering status, error fallback, and streaming-preview titles use typed Chinese and English dictionaries. Saved visualization titles and tool-result text remain the values recorded by their producers.

The Host face registers the `visualize` tool and its bundled authoring skill. The Client face registers the settled tool view and streaming preview. Xiaojing's Web composition loads both faces only when `DSH_CLIENT_BUILD_PROFILE=xiaojing`; the official Harness profile is unchanged.

The card uses the original plugin's fixed light whale-blue palette. It deliberately does not inherit the Harness theme, the Xiaojing pale-green product theme, or the operating-system appearance. Disable or remove the single `xiaojing-visualize` row from the Web composition and rebuild to remove this feature. Complete source removal also deletes the package dependency from the `web-app` resolver manifest; no other Xiaojing feature or durable data owner depends on either declaration.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `maxFragmentBytes` | `1000000` | Maximum UTF-8 size of one model-authored HTML fragment. |

## Operation

The model loads the bundled `visualize` skill before its first card, then calls `visualize` with an inline HTML fragment. `create` renders a new `inline` or `wide` card. `update` applies one exact text replacement to the saved workspace copy and refreshes the existing card without resending the full fragment.

Each settled tool result persists the validated fragment, title, mode, and workspace path in session metadata, so replay does not depend on the original source file remaining present. A copy is also saved below the session workspace for export or a later correction.

Completed turns also display their successful cards below the answer, outside the collapsible tool process. Reloading or reopening a conversation restores those cards from the saved results; failed calls do not produce a completed card.

## Security

Every card runs in an iframe with `sandbox="allow-scripts"`, giving it an opaque origin and no access to the Host document. The frame content security policy blocks forms, nested frames, objects, base URL changes, and network connections. It permits inline script and style plus static resources from the fixed CDN allowlist documented by the bundled skill. The fragment size ceiling bounds both execution input and session-log growth.

Model-authored card content remains untrusted active content inside that sandbox. Changing the sandbox attributes, content security policy, CDN allowlist, or fragment ceiling requires a focused security review and tests.

## Source and license

This package adapts [Nagi-ovo/dsh-visualize](https://github.com/Nagi-ovo/dsh-visualize) at reviewed commit `b0bed38f40ffbb0d72bb88393d865307944c1bce`. The upstream BSD-3-Clause license is preserved in [`LICENSE`](LICENSE), and [`NOTICE.md`](NOTICE.md) records the Xiaojing-specific changes.

## Model Experience

### `visualize` tool and bundled skill

#### What the model sees

When the plugin is composed, the model sees the stable `visualize` tool schema and a bundled skill catalog entry. The skill body supplies the fragment format, design tokens, allowed resources, interaction checks, and response guidance when loaded. A successful tool result returns a short confirmation and workspace path instead of echoing the complete fragment.

#### Token effect

The tool schema and skill catalog entry are part of the normal model request. Loading the skill adds its authoring instructions once to the session context. Each created fragment appears in the tool-call arguments and durable metadata; the result text stays short to avoid duplicating it.

#### KV Cache effect

The tool schema and skill catalog entry are prefix-stable while the plugin configuration is unchanged. Loading the skill or generating a card adds request-specific suffix content; updating a card changes only the later conversation suffix.

## Known Limitations and Deferred Work

- Interactive cards render only in the Web client. TUI and headless clients display the generic tool result.
- Cards use a fixed light palette and do not follow dark-mode changes.
- Controls inside a card cannot send a follow-up message to the parent conversation.
- Static CDN resources require network access even though runtime connection APIs inside the card are blocked.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
