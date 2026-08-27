# Agent Note: Xiaojing Finance official-source tax research skill

Status: implemented

English | [中文](2026-08-26-xiaojing-finance-official-tax-research-skill.zh.md)

## Problem

Finance模式 needs a useful first finance capability before customer records, business-system connectors, or a local regulation library exist. Chinese tax answers can change with jurisdiction, taxpayer status, transaction facts, and the relevant period; a general persona instruction to “prefer official sources” does not define how to establish those facts, distinguish legal effect, detect expired documents, or present evidence. Building a crawler or storing regulation text would introduce content-rights, freshness, migration, and operational obligations that this milestone cannot satisfy.

## Decision

The Finance preset ships the instruction-only `china-tax-official-research` skill under its own `skills/` directory. Its existing `@deepseek-ai/dsh-skill-filesystem` row adds that directory through a `baseUrl`-relative custom root, so the skill follows the preset through source runs, installation, relocation, and user-authored preset copies. Standard mode and official Harness profiles do not see the product root.

The skill uses the existing `web_search` tool. It requires material facts about jurisdiction, locality, entity or taxpayer type, transaction, accounting framework, period, and requested answer date before a rule-dependent conclusion. Its authority order starts with laws and administrative regulations from the National Laws and Regulations Database or the Chinese Government website, then formal State Taxation Administration and Ministry of Finance documents, applicable verified local authorities, and finally official interpretations as non-binding explanation. Third-party pages may discover a document but cannot establish the conclusion.

Every material source is classified by legal effect, time status, and relevance. The answer states its checked-through date, assumptions, reasoning, practical treatment, risks, and an official-source table with issuer, title, document number, dates, status, and direct link. Missing official text, current effect, or applicability is reported as `待核验`; search snippets are not represented as complete provisions. The skill cannot claim that an external filing or transaction completed.

The product manifest inventories the skill path. The product-layer verifier permits exactly one Finance-versus-Standard composition difference beyond the persona: the relative custom skill root. It reads the inventoried source and pins the authoritative domains and unresolved-status rule. The capability stores no regulation text or user data and creates no Host or Client service package.

## Verification

The assembled Xiaojing Web test mounts Standard and Finance agents together, proves their tool schemas remain equal, proves only Finance discovers `china-tax-official-research`, and loads the actual skill through the model-facing `skill` tool. The product-layer verifier parses both compositions and rejects any unlisted row or config drift, a missing manifest entry, a skill outside the product preset, or removal of the official-source and `待核验` rules. The model-visible skill transcript is pinned by a keyless ACP snapshot.

## Alternatives considered

- **Build a local regulation corpus or RAG index.** Rejected because no licensed, versioned source dataset or freshness operation exists. A partial corpus would make stale coverage look authoritative.
- **Enable the generic HTTP fetch provider.** Rejected because the shipped profile intentionally omits it while private-network SSRF protection remains deferred. Search-only verification has a narrower security and maintenance cost, and the skill must remain non-definitive when snippets are insufficient.
- **Put the complete workflow in the Finance persona.** Rejected because every Finance request would pay the prompt cost and later skills could not evolve or be removed independently.
- **Create an empty Finance service package.** Rejected because this capability is instructions over existing skill and web services; it has no new Service Definition, provider, persistent state, or Client consumer.

## Consequences

Finance模式 can answer current Chinese tax-policy questions with a repeatable official-evidence discipline without claiming a local knowledge base. The result remains dependent on live DeepSeek web search availability and the official text exposed in its results; blocked, incomplete, or conflicting evidence produces a qualified answer rather than a fabricated rule.

The skill is removable by deleting its manifest entry, directory, custom root, and focused verification. Future document extraction, deterministic calculators, customer context, Youcheng or SDOO operations, and compliance findings remain separate capabilities and do not accumulate in this skill.
