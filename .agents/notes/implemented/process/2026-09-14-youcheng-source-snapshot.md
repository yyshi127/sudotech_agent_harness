# Agent Note: Youcheng documentation source artifacts

Status: implemented

English | [中文](2026-09-14-youcheng-source-snapshot.zh.md)

## Problem

The supplier's Chinese API extract occupied an English documentation path without a bilingual pair. Its generated hard wrapping also conflicted with maintained-prose rules. Editing or translating the extract would obscure which wording came from the supplier.

## Decision

The [mirror reference](../../../../docs/integrations/youcheng-openapi-replica.md) is a maintained bilingual page linking the structured JSON and a `.source.txt` extract. The existing extract is relocated without changing its bytes. The replication script writes the source artifact, not the maintained page. Documentation checks retain their existing scope and rules.

## Alternatives considered

**Translate or reformat the generated extract.** This would mix editorial changes with captured supplier examples and require reviewing the entire mirror on regeneration.

**Exclude the mirror from documentation checks.** A per-file exception would leave an unpaired reference in the maintained documentation tree. A short paired reference separates editorial ownership from supplier data without weakening checks.

## Consequences

Supplier text remains searchable and downloadable, but the plain-text artifact has no rendered Markdown navigation. Hash comparison verifies relocation integrity; a controlled replication run must preserve the maintained page and emit both source artifacts. Neither artifact establishes current endpoint availability or product acceptance.
