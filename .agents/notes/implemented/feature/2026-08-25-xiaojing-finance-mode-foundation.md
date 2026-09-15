# Agent Note: Xiaojing Finance模式 foundation

Status: implemented

English | [中文](2026-08-25-xiaojing-finance-mode-foundation.zh.md)

## Problem

Xiaojing needs a professional finance and tax mode without weakening or duplicating the behavior users already rely on in Standard mode. Adding business-system integrations, client records, regulation storage, and compliance rules before the mode boundary exists would couple later finance work to the preset file or Agent Loop and make individual capabilities difficult to remove or upgrade.

The first milestone must therefore be selectable and useful as a behavior foundation while remaining honest about what is not implemented. It must not change existing session compositions, the deployment default, user data, or any current Xiaojing feature.

## Decision

The official preset root remains the four upstream system presets. The product-owned `apps/cli/config/xiaojing-agent-presets/` root adds a fifth system preset with stable id `finance`, display name `Finance模式`, and order 5 only when profile boot receives the `xiaojing` Client build profile. Its `agent.cordis.yml` retains the tools, planning, goals, subagents, workflows, compaction, and shell platform gating of the shipped `standard` preset, then adds an exact allowlist of Xiaojing Finance consumers for client context, controlled files, reference data, balances, vouchers, journals, open items, analysis, versioned write preparation and maintenance operations. The `persona` row differs, and the existing filesystem skill provider adds the product-owned `skills/` directory beside the Finance composition.

The Finance persona distinguishes confirmed facts, assumptions, and unresolved verification; refuses invented laws, standards, citations, client facts, calculations, and completed external actions; asks for the entity and period facts that can change an answer; prefers official sources for current Chinese finance and tax rules; and labels unresolved applicability or legal effect as “待核验”. It does not claim a submission, approval, posting, payment, filing, or external-system change succeeded without a confirming tool result.

`packages/client/xiaojing-product/product.json` owns the preset and skill inventories plus the `financeExtension` rules. The rules inventory the Finance Host and Client packages, Cordis rows, compatibility adapters, and protected `harness/finance` durable root. `scripts/verify-xiaojing-product-layer.mjs` parses both compositions with the Loader's `!!js` value form, requires the common non-persona rows to stay synchronized with Standard, validates each Finance-only consumer by exact row id and package export, and rejects any other capability drift. It also pins the product manifest, both preset roots, preset name, fifth Xiaojing roster position, description, verification-aware persona, skill sources, package-to-row mappings, assembled rows, and desktop data protection. A Standard mode capability change or an unregistered Finance consumer therefore fails the product gate.

The generic Agent preset UI exposes `AgentPresetDisplayRegistry` without knowing the Finance id or copy. The Xiaojing product Client registers localized Finance text through that registry, and user-authored rows continue to display their own metadata even when they use the same id. Existing installations remain on their saved default and existing sessions retain the preset recorded at creation. Finance owns client binding, durable operation records, document/evidence/calculation services and Youcheng read/write consumers under the product inventory. It does not add a regulation corpus or bypass vendor permissions, exact-version confirmation, single-dispatch protection or verified readback.

## Verification

The Xiaojing Web composition tests start Standard and Finance agents through the real assembled application. They verify the shared baseline, the exact Finance-only tools and model-visible schemas, and Finance workflows for read, prepare, confirm, send, recover and refusal paths. They pin the Finance persona, verify no Code Mode SDK section appears, prove Finance skills are absent from Standard, and load those skills through Finance's real model-facing tool. Profile tests require the official root to remain unchanged and the Xiaojing profile to add only its product root; the product gate requires the exact official and product rosters, inventoried skills, packages and Finance consumers. The shell-platform test includes Finance, registry tests prove product copy cannot relabel user presets, and the browser snapshot displays `Finance模式` only under the Xiaojing build profile.

## Alternatives considered

- **Change Standard mode into the finance mode.** Rejected because Standard remains the general-purpose baseline and existing sessions or users must not acquire finance-specific behavior implicitly.
- **Create empty finance Host and Client packages now.** Rejected because the repository requires a complete current consumer rather than speculative package names. Client context, evidence, documents, workflows, connectors, and compliance each receive a package when their first complete capability seam is implemented.
- **Maintain an unchecked copy of Standard mode.** Rejected because it would silently lose future upstream tools or behavior. The parsed structural gate makes synchronization an enforced release condition.
- **Make Finance模式 the deployment default immediately.** Rejected because choosing a new-install default is a separate product decision after professional finance services and acceptance tests exist.

## Consequences

Xiaojing users can select Finance模式 and retain every Standard mode tool while gaining product-owned Finance skills, client binding and explicitly inventoried consumers; official Harness profiles remain unchanged. Finance durable records and client configuration are product data and remain protected across desktop upgrades. Removing the mode now requires removing its product preset, display registration, manifest entries, Finance packages, protected data contract and focused checks together.

The preset file intentionally duplicates Standard mode's readable composition, matching the shipped preset convention. That costs one synchronized file edit whenever Standard changes, but the product gate makes omission loud and prevents unreviewed capability drift. Finance functionality belongs in Xiaojing-only Cordis services, tools, Skills, Remotes, and settings sections described by the broader finance roadmap; business logic must not accumulate inside the persona or preset file.
