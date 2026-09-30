---
description: "Official-source finance and tax evidence retrieval for Xiaojing Finance mode"
kind: "package-reference"
---

# @deepseek-ai/dsh-xiaojing-finance-evidence

English | [中文](README.zh.md)

## Summary

Xiaojing Finance Host capability for date-aware research of Chinese mainland finance and tax rules from configured official sources. The Host plugin owns source admission, bounded page retrieval, evidence parsing, and a structured local cache. The separate Finance-preset consumer registers `finance_evidence`; Standard and other presets receive no tool. Neither entry modifies the Agent Loop.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Retrieval and evidence semantics

The service uses the existing Harness Web search capability only to discover candidate URLs. A private HTTP fetcher then accepts HTTPS pages from the fixed official registry: the National Laws and Regulations Database, China Government Network, State Taxation Administration policy and authority sites, Ministry of Finance sites, and provincial tax-authority sites. Search titles and snippets remain discovery leads and never become evidence unless the official page is fetched.

Fetched pages produce attributable metadata, a bounded excerpt, response SHA-256, retrieval time, legal-effect classification, lifecycle relative to the requested date, conditional applicability, and explicit limitations. Authority tiers follow the baseline from statutory text through binding rules, competent-authority guidance, and official explanatory material. L4 professional or international materials are outside this official-only registry. Authority tier never substitutes for legal effect, current status, or applicability to the user's facts.

`verified` means at least one fetched official page exposes both a recognizable legal effect and current status. `partial` means the pass found official material but could not establish all required attributes. `pending` means no citable official text was obtained. `out-of-scope` covers Hong Kong, Macao, Taiwan, and foreign jurisdictions. These values describe evidence availability, not legal advice or a finding that a rule applies to a client.

The request may supply an evaluation date and Mainland locality. The date defaults to the current Beijing date. A client-bound Finance session defaults locality from its immutable registered-region snapshot, but that value is only a discovery assumption and never proves applicability. Mainland cities such as Suzhou remain in scope and route to national and applicable provincial sources. General Finance sessions search national sources unless the request supplies a locality. Once official evidence is `verified`, later client-applicability uncertainty remains a separate limitation and does not downgrade that evidence status.

## Persistence, privacy, and failure behavior

The bounded cache is stored at `$DSH_HOME/finance/evidence-cache-v1.json` with schema version `1`, a file lock, and atomic replacement. It stores only parsed metadata, a short official-text excerpt, hashes, and retrieval status. It does not store API keys, client records, search snippets, or a bulk copy of an official corpus. Corrupt cache data rejects plugin initialization and remains unchanged.

Public availability does not establish redistribution permission. Every item therefore retains `terms-review-pending`; the service does not claim that robots observations, website terms, corpus completeness, or reuse rights have been cleared. Retrieval failures, rejected redirects, unavailable pages, and incomplete lifecycle metadata produce a discovery-only or partial result rather than a fabricated citation. Low-level fetch errors are not exposed to the model.

Search, fetch, excerpt, cache, timeout, body-size, URL-length, and redirect limits are deployment configuration. The direct fetcher remains private to this package and does not enable generic Web fetching for the Agent. The complete generated configuration reference lives in the [configuration catalog](../../../docs/config-catalog.md).

## Model Experience

### Official evidence tool

#### What the model sees

Finance receives `finance_evidence(query, as_of_date?, locality?)`. Its result is persisted as an ordinary `tool/result` and rendered as a Chinese evidence report with direct official links, authority, lifecycle, legal effect, dates, excerpt, assumptions, and limitations. The bundled Finance Skill requires this tool before definitive date-sensitive rule claims and requires `待核验` for partial or pending propositions.

#### Token effect

Only the requested research result enters the calling session. Bounded excerpts limit variable tool-result size; the package does not inject a standing local corpus into every prompt.

#### KV Cache effect

Tool output varies by question, date, locality, current official pages, and cache state. It therefore belongs after the stable Finance system prompt and does not change the standing prompt prefix.

## Known Limitations and Deferred Work

- Remove the `xiaojing-finance-evidence` Host row and the Finance preset's `finance-evidence` consumer row to remove the capability. The client domain, controlled files, Standard mode, and official Harness profiles remain independent.
- This package is not a complete tax-law database, does not reconcile every official catalogue entry, and does not monitor updates in the background.
- It does not replace professional review for filings, disputes, transactions, or other high-risk conclusions.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
