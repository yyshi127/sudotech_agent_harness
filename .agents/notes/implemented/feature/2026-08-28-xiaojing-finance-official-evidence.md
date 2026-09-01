# Agent Note: Xiaojing Finance official-source evidence service

Status: implemented

English | [中文](2026-08-28-xiaojing-finance-official-evidence.zh.md)

## Problem

Finance mode needs current, attributable Chinese finance and tax rules, but the product has no licensed local legislation corpus. Letting the model rely on memory or search snippets would confuse discovery with legal authority, hide rule dates and legal effect, and make confident answers impossible to reconstruct. Bundling public pages would also assume completeness and redistribution rights that have not been established.

The capability must remain removable, reuse Harness services instead of changing the Agent Loop, work for both general and client-bound Finance sessions, and fail without inventing citations or leaking credentials, client records, or low-level network diagnostics.

## Decision

`@deepseek-ai/dsh-xiaojing-finance-evidence` is a Xiaojing-only Host capability. It uses the existing `ctx.web.search` service to discover candidates and a private bounded HTTP fetcher to retrieve only HTTPS URLs admitted by its fixed official-source registry. The registry covers national legislation, State Council, tax-authority, Ministry of Finance, and provincial tax-authority sources. Search titles and snippets remain discovery-only; only fetched official text can produce an evidence excerpt.

The engine classifies each fetched document separately by authority tier, legal effect, lifecycle relative to the requested Beijing date, and conditional applicability. Its active registry covers L0 through L3 official material. L4 professional or international material remains outside this official-only scope. Authority never substitutes for legal effect, current status, or client-fact matching. A client-bound session may default locality from the immutable `finance/client-bound` snapshot, but the result records that value as a search assumption rather than proof of applicability.

The service returns evidence availability as `verified`, `partial`, `pending`, or `out-of-scope`. `verified` requires fetched official text with both a recognizable legal effect and current status. The other states force affected propositions to remain `待核验`. Hong Kong, Macao, Taiwan, and foreign jurisdictions are rejected as out of scope. These states are not legal opinions and do not establish that a conditional rule applies to the user's facts.

The Finance preset alone loads `@deepseek-ai/dsh-xiaojing-finance-evidence/tool`. Its `finance_evidence` result is an ordinary structured `tool/result`, so every model-visible link, excerpt, assumption, and limitation is reconstructable from the session log. `src/compat.ts` is the package's only adapter for Harness Web discovery and Finance client binding. The Web Host row and Finance consumer row are both declared in the product-owned inventory; official presets and Standard mode do not load either entry.

`$DSH_HOME/finance/evidence-cache-v1.json` stores schema-versioned structured metadata, bounded excerpts, response hashes, and retrieval status through a file lock and atomic replacement. It does not store search snippets, bulk official text, credentials, or client records. Corruption stops initialization and preserves the damaged file. Every result retains `terms-review-pending` because public accessibility does not prove reuse permission. Fetch failure produces a safe discovery-only limitation and does not expose the underlying exception to the model.

## Alternatives considered

- **Bundle a local full-text tax-law corpus.** Rejected because the product has no established complete inventory, update operation, or redistribution permission, and a stale partial corpus would look more authoritative than it is.
- **Use generic Web search output as the citation.** Rejected because provider snippets are truncated discovery data and cannot establish official text, lifecycle, legal effect, or completeness.
- **Enable generic Web fetch for the Finance Agent.** Rejected because the feature needs a narrow official-source reader, not a new arbitrary browsing capability or a route for model-supplied URLs outside the registry.
- **Require a bound client for every research request.** Rejected because general Finance consultation must research national rules; client locality is optional context and never the authority for a conclusion.
- **Cache complete downloaded pages indefinitely.** Rejected because that creates an unreviewed corpus, expands rights and privacy exposure, and allows stale text to outlive its bounded retrieval purpose.

## Verification

Parser tests pin real calendar validation, title and date extraction, legal-effect and lifecycle classification, bounded excerpts, and fetched-body hashing. Registry tests pin HTTPS admission, official-host precedence, Mainland scope, and local-query planning. Cache tests pin schema validation, bounded retention, expiry, atomic writes, corruption preservation, and rejection of discovery-only values. Engine tests pin snippet non-use, client-locality assumptions, out-of-scope handling, cache reuse, safe fetch failure, and verified versus partial states. Tool tests pin the public schema, readable evidence report, and structured execution result.

The shipped Web composition test mounts the real Finance preset and proves that it retains Standard capabilities while adding exactly `finance_evidence` and `finance_files`. The product-layer verifier requires one Xiaojing-only Host row, one Finance-only consumer row, package inventory membership, and `src/compat.ts`. The evidence cache remains below the desktop contract's protected `harness/finance` path.

## Consequences

Finance can answer current rule-dependent questions with attributable official links and explicit uncertainty without shipping a local legal corpus. The design buys narrow source admission, logged model evidence, bounded storage, and independent removal. It gives up offline rule research, complete-corpus claims, automatic policy monitoring, non-mainland jurisdictions, and any promise that a fetched rule applies without matching the user's facts. Future source or rights expansion requires an explicit registry and legal-review decision rather than a silent crawler change.
