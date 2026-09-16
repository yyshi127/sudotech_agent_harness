# Agent Note: Canonical Finance capability inventory

Status: implemented

English | [中文](2026-09-15-finance-capability-inventory.zh.md)

## Problem

Finance capability answers need both a product-level introduction and precise execution boundaries. A detailed support inventory used directly for an ordinary “what can you do?” answer overwhelms the product positioning with implementation status and unsupported examples. General persona text, available tool names, loaded skills, and conversation history cannot safely replace the detailed inventory because they may omit implemented operations, expose internal backends, or present a client binding as proof that Youcheng is reachable.

The product also retains historical reimbursement configuration, receipts, and Host services while current development excludes reimbursement. Deleting those records would be destructive, but leaving the old prompt, tool, and skill exposed would contradict the current Finance scope.

## Decision

The capability module owns two coordinated sources. `FINANCE_POSITIONING` defines Xiaojing as an AI financial assistant through five broad areas: financial-document handling, daily accounting assistance, analysis and deliverables, tax support, and multi-step task execution. It is the source for an ordinary capability introduction. `FINANCE_CAPABILITIES` owns precise support decisions. Each detailed entry has a business title, supported, limited, or unsupported status, an explicit scope—general Xiaojing, the current Finance workspace, or the current Youcheng connector—a user-relevant description, any material limitation, its client-binding requirement, and the internal tools that substantiate the entry.

Every Finance prompt assembly renders the positioning and detailed registry together as `xiaojing:finance-capabilities`. The instructions require an ordinary “what can you do?” answer to stay at the positioning level and not volunteer statuses, interface limitations, internal tools, or unsupported native reports. A specific capability question or explicit complete-list request may use the relevant detailed entries and must state their scope. A limitation of the current Youcheng connector cannot be generalized to Xiaojing's consulting, user-supplied document processing, reliable-data analysis, or future connectors. A request to perform an operation uses the corresponding tool and its normal preflight checks. The rendered context identifies consultation or client-bound state and states that binding proves customer identity only, not a live connection, permission, accounting period, or data coverage.

The registry marks the six native ledgers and statements, accounting controls, and reimbursement as unsupported. It forbids browser, shell, or local approximations from being represented as those native capabilities. The Finance preset no longer registers the reimbursement prompt, `finance_reimbursement`, the standalone attachment-upload tool, or the reimbursement skill. Existing reimbursement configuration, receipts, historical events, and Host operations remain intact for data continuity.

The product UI uses the selected session preset for its role headline: ordinary sessions display `小兢会计，您的AI办公搭子`, while Finance sessions display `小兢会计，您的AI财务助手`. Release `0.2.4` owns this distinction and the current Finance capability summary in the About page.

## Alternatives considered

**Keep capability wording in the persona.** Rejected because persona owns identity and tone; it is not precise enough to track support status, limitations, or runtime prerequisites.

**Infer capabilities from registered tools or skills.** Rejected because one business capability can require several internal tools, a registered tool can expose only a limited operation, and a retained backend is not necessarily a current product capability.

**Expose only the broad positioning to the model.** Rejected because specific questions and execution requests still need accurate support boundaries. Keeping both layers in one prompt lets the model answer at the requested level without inventing capabilities.

**Run live Youcheng checks for every capability introduction.** Rejected because a general product question does not need network traffic. Live state is checked only when the user asks whether an operation can run now or requests execution.

**Delete reimbursement services and stored data.** Rejected because current scope isolation does not authorize destructive migration of historical records. Removing model exposure provides the required boundary without erasing data.

## Consequences

Ordinary capability answers describe Xiaojing's intended value instead of reading like an interface checklist. Specific answers distinguish product support, connector scope, and current runtime availability. Changing Finance positioning or support requires updating its owning constant or registry and the assembled application snapshot. Every Finance request carries a fixed prompt cost for both layers, while client-specific fields remain limited to bound sessions.

Historical reimbursement data remains readable, but Finance conversations cannot discover or invoke reimbursement through current prompt, tool, or skill registration. Unsupported native reports remain named limitations rather than approximate outputs.

## Verification

Focused positioning, registry, and Finance-context tests cover the broad introduction, the prohibition on unsolicited detailed limits, connector-scoped unsupported wording, unique entries, unsupported-tool invariants, bound and unbound wording, disposal, and exclusion from Standard mode. The keyless assembled Finance snapshot pins both prompt layers, verifies identical guidance for two isolated customers, and proves that reimbursement tools and skills remain absent. Product Client tests cover both workspace headlines and the `0.2.4` badge; the settings snapshot covers the release-history entry.
