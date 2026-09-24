# Agent Note: Xiaojing historical Session admission

Status: implemented

English | [中文](2026-09-22-xiaojing-historical-session-admission.zh.md)

## Problem

The Xiaojing 0.2.4 release wrote five Finance event types in v0 Sessions that the upstream frozen inventory does not name. An older 0.1.9 Session can also put its first user message immediately before `step/start`. The newer [system-head rule](2026-09-02-system-prompt-as-surface-node.md) requires the first system position before user messages, so strict upstream migration refuses both kinds of released data.

## Decision

The v0 inventory admits exactly Xiaojing's five released Finance event types, validates their version and top-level members, and preserves their client or file record as JSON. Other unknown historical events remain unsupported.

The V2-to-V3 stage moves one immediately pre-step `user/message` append only when the source was transformed from an older generation, the Session is unseeded, and a turn is open. It emits the source `step/start`, the empty system head, then the original user message, remapping later sequence references. The user's id, timestamp, content, and relative order among model-visible messages remain unchanged. Direct V2 sources and every other pre-step arrangement still refuse migration.

## Alternatives considered

**Skip released Sessions:** Leaving them unreadable preserves the upstream rule but breaks the desktop upgrade for existing Xiaojing users.

**Accept arbitrary unknown events or reorder broadly:** Neither option establishes ownership of historical payloads or preserves event meaning across intervening operations.

**Place the new system head after the user:** This violates the current Session rule and can produce a model request with a different prompt position.

## Consequences

The exception changes the order of one lifecycle marker and one user event in the target log, while preserving the source artifact and model-visible message order. It cannot repair already-corrupt logs or a pre-step message separated from its step. Focused migration tests cover admission, refusal, reference remapping, and unchanged source bytes.
