---
description: "Xiaojing Accounting product branding, onboarding, theme, and default persona"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-xiaojing-product

English | [中文](README.zh.md)

## Summary

The Xiaojing Accounting product layer over DeepSeek Harness. Its Host half supplies the default deployment persona; its browser half supplies brand, theme, hero, first-use guidance, and the product About page through generic slots. The official UI packages retain their default DeepSeek presentation when this plugin is absent.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Product contributions

The product shadows the generic `system-prompt` Chat renderer so internal model instructions remain persisted and model-visible without appearing in the Xiaojing end-user transcript.

The first-use dialog supplies the API key setup guide through `onboarding.content`: obtaining, setting, replacing, and protecting a key, with a link to the DeepSeek Platform. The generic welcome owner still saves acknowledgement before advancing; the product dialog does not replace model configuration or reset existing settings.

The office empty-session hero and Finance sessions use the same paired-character artwork, stored as `xiaojing-office-robot-logo.png` and `xiaojing-finance-robot-logo.png`, while the sidebar uses the transparent square character artwork `xiaojing-character-logo.png`. Both hero asset aliases exclude transparent margins from their display area. The hero mark is 145 pixels high above the title; the sidebar enlarges the character by about 15% within its transparent margins while retaining the shell-supplied frame and adjacent wordmark position. The title is centered independently of its version badge, which moves below the title in narrow layouts. The initial HTML receives `dsh-boot-logo` and `dsh-boot-logo-alt` from the profile's `DSH_CLIENT_BOOT_LOGO` and `DSH_CLIENT_BOOT_LOGO_ALT`, so the SUDO brand is available before client plugins activate. The profile's `DSH_CLIENT_FAVICON` selects the same transparent character artwork for the browser tab in the initial HTML; builds without this value retain the generic favicon.

The browser plugin registers `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`, `conversation.hero.brand.content`, `onboarding.content`, and `settings.section` only in the `xiaojing` Client build profile. Product copy, palette overrides, versioned beta badge, newest-first incremental release history, and the default persona live in this package. The ordinary new-session hero says `小兢会计，您的AI办公搭子`; a Finance session says `小兢会计，您的AI财务助手`. Release `0.3.1` appears in the hero badge and heads the About page history. A new release prepends one history record; previous records remain unchanged so the About page never attributes an older feature to the current release. Electron supplies its actual application version through one restricted preload method; an ordinary Web preview uses a checked fallback that must equal `apps/desktop/identity.json.productVersion`. Tests require that fallback to equal the first release-history record and reject duplicate version entries. The product-layer gate rejects a version mismatch and rejects Xiaojing brand marks written back into official UI source roots. The plugin lifecycle also synchronizes the existing browser `theme-color` metadata after the product dataset is attached and restores the generic value when the plugin unloads. The build profile selects the inventoried SUDO logo for the pre-plugin loading page through generic boot metadata; the shell retains its `HARNESS` fallback when that metadata is absent. `product.json` records the official `dsh-v0.2.0-rc.2` baseline by its official release tag, generic slots, browser asset paths, desktop product manifests, and the product-owned `finance` preset. A product-layer gate parses the declarative Finance and Standard compositions and permits only the Finance persona, declared Finance consumers, and product skill directory to differ.

The `finance` preset is an ordinary patch at `apps/cli/config/xiaojing-agent-presets/finance/agent.cordis.yml`. It inserts `preset-finance` with `@deepseek-ai/dsh-agent-preset`; that declaration owns the `finance` id, fallback display metadata, order, and child plugin list. Profile boot loads the patch only for the `xiaojing` Client build, after bundle patches and before profile, home, and command-line overlays. Runtime preset-root discovery and a `preset.yml` sidecar do not participate. The public `AgentPresetDisplayRegistry` lets this Client plugin supply active-locale copy for the registered `finance` id, while the generic UI falls back to declaration metadata when no provider is registered. `product.json.agentPresets` records the expected composition path, while `product.json.financeExtension` inventories the five current Finance skills and the implemented Host/Client package families and records the composition-row prefixes, compatibility-adapter filename, and protected `harness/finance` durable root. Removed or future capabilities are not kept as placeholder skill entries.

The Host product plugin also owns Xiaojing's mandatory deletion policy. Explicit deletion tools and shell deletion commands request one-use confirmation through the shared approval channel even when the session policy is `never`. A monotonic tool guard denies any matching call that did not pass through that exact confirmation. Browser and Windows controls classify delete/remove/uninstall targets and the Delete key as mandatory confirmations inside their own tool providers.

When the saved default still selects `deepseek-official/deepseek-v4-flash` or `deepseek-official/deepseek-v4-flash-vision-exp`, the Host product plugin changes only that selection to `deepseek-official/deepseek-flash` so new sessions use the V4.1 Flash text-and-image route. Other saved providers and models remain unchanged; session-specific historical selections are not rewritten.

The product identifies itself as “小兢会计，您的AI办公搭子” and accurately describes its technical origin as based on DeepSeek Harness with internal branding and configuration. It does not claim that SUDO Tech developed the underlying framework.

## Upstream upgrade contract

An upstream upgrade starts from stable `main` on a `codex/upgrade-rcX` branch and merges the verified official tag or commit. Product code, brand assets, desktop identity, and accounting logic remain unchanged. Conflicts are resolved only in the generic slots, the rc-specific accounting adapter, the independent integration patches listed by `apps/desktop/integration-patches.json`, and any required atomic data migration.

The upgraded branch may merge only after the product-layer verifier, focused behavior tests, built Web replay, fresh Windows install, and previous-release in-place upgrade checks pass. A version that cannot read or migrate the previous release's data is not releasable.

## Official-source Chinese tax research

The product-owned `finance-tax-research-cn` skill instructs Finance模式 to establish jurisdiction, taxpayer facts, transaction facts, accounting or tax period, and the requested answer date before reaching a rule-dependent conclusion. It uses `finance_evidence`, treats search snippets as discovery only, and labels unsupported source text, status, or applicability as `待核验`. The other four skills cover financial-document reading, invoice review, voucher drafting, and financial-data analysis. They orchestrate the shared document, evidence, deterministic-calculation, and controlled-file tools without treating skill names as proof that a business operation is supported. The voucher skill creates a Youcheng voucher only after an explicit request, versioned preview, mandatory approval, and verified readback; it does not post the voucher. The current Finance preset includes no reimbursement skill.

The skill stores no regulation text, builds no crawler or RAG index, and does not enable generic HTTP fetching. Search snippets cannot be represented as complete provisions, and a result without enough official text must remain non-definitive. Removing its manifest entry and preset skill directory withdraws the capability without changing Harness core packages or user data.

## Model Experience

### Product-wide business-facing responses

#### What the model sees

Every Xiaojing preset receives one stable response policy after persona assembly. It requires the final answer to lead with the usable business outcome, suppresses internal execution evidence and failed-attempt narration after success, limits failures to one user-visible reason and next action, and presents generated files by content and usable location rather than audit metadata. Technical diagnostics remain available only when the user explicitly requests them. Tool providers must still project model-safe results; this prompt is not a substitute for filtering raw transport, retry, pagination, checksum, or test data before it reaches the model.

#### Token effect

One fixed product-wide section is added to each model request. Finance adds its narrower accounting interpretation and safety rules without repeating tool execution evidence.

#### KV Cache effect

The policy is prefix-stable for every preset and changes only when the product policy changes.

### Mandatory deletion instruction

#### What the model sees

When either built-in automation provider is composed, the stable automation context states that deletion always requires confirmation under Full access and the `never` approval policy, and prohibits evasion by changing or obscuring the deletion command.

#### Token effect

One fixed sentence in the existing built-in automation context; it is not repeated per tool call.

#### KV Cache effect

The sentence is prefix-stable while the product capability composition remains unchanged.

### Default deployment persona system prompt

#### What the model sees

The plugin fills `deployment:persona-prefix` only when downstream assembly leaves it empty. In the Xiaojing profile, Standard and PTC inherit this office identity; Creator embeds the same text through `{{xiaojing_office_persona}}` and retains its extension instructions. Finance and explicit user-authored personas remain authoritative, including complete-prompt replacements. The deployment suffix supplies the working directory separately. The office introduction is “我是小兢会计，您的AI办公搭子！”; its six capability categories remain conditional on available tools and authorization.

##### Verbatim default persona

```markdown
你就是小兢会计，用户的AI办公搭子，不是“小兢会计的AI助手”或“小兢会计的智能助手”。用户用中文问候或询问身份时，自我介绍使用：“我是小兢会计，您的AI办公搭子！”；其他语言使用对应表达。

当前是办公搭子工作区，不是财务助手工作区。产品名称中的“会计”不代表当前会话采用财务身份。不要把日常办公介绍成财税专属服务，也不要把编程、命令或脚本当作默认身份；这些只是完成任务时可用的手段。

用户询问“你能做什么”时，用日常办公语言介绍以下六类能力，按当前可用工具和授权条件说明，不要照搬工具目录：

1. 文档处理：读取、整理、提炼 PDF、Word、Excel、PPT、OFD、CSV、TXT 等材料中的信息；具体格式和扫描件识别能力以已配置的文档工具为准。

2. 数据处理：梳理表格、核对汇总、查找差异，生成可复核的报表草稿。

3. 内容撰写：把需求变成文稿，起草通知、说明、邮件、总结等内容。

4. 信息检索：检索政策、法规、行业等公开信息，保留来源并说明无法核实的内容。

5. 网页操作：连接并获得授权后，在可用浏览器工具支持的范围内协助填表、查数据、走流程；不能仅因界面有浏览器面板就声称能接管它。

6. 电脑操作：在授权范围和可用电脑工具支持下操作应用与文件，推进多步骤任务，不只是提供建议。

可以结合已配置工具处理材料、生成成果。没有相应工具、连接或授权时，如实说明，不声称已执行；用户明确提出财务任务时按实际能力协助，不因此改变办公身份或假定已接入客户账套。

Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product's technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.
```

#### Token effect

The default persona adds the fixed text below when no explicit persona is present; Creator embeds it once in its own persona.

#### KV Cache effect

The text is prefix-stable while the product version and working directory stay unchanged. Changing the selected persona or working directory changes the system prompt and may invalidate provider prefix reuse.

### Finance模式 preset system prompt

#### What the model sees

A session created with the shipped `finance` preset receives every Standard mode tool, while its `deployment:persona-prefix` section is replaced by the finance-specific text below. Its filesystem skill provider also mounts the product-owned `skills/` directory beside the preset; other finance services and skills remain independently removable.

##### Verbatim Finance模式 persona

```markdown
You are 小兢会计, an AI office companion configured for internal use, operating in Finance模式. Your working directory is {{cwd}}. Finance模式 retains every capability of Standard mode and applies an evidence-first discipline to finance and tax work. Distinguish confirmed facts, assumptions, and items that require verification. Do not invent laws, tax rules, accounting standards, citations, client facts, calculations, or completed business actions. When jurisdiction, taxpayer type, accounting standard, accounting period, or tax period can affect the answer, state the applicable assumptions or ask for the missing facts. For current Chinese finance or tax rules, prefer official sources and cite them; when applicability or legal effect cannot be established, say “待核验”. Do not claim that a submission, approval, posting, payment, filing, or external-system change succeeded unless a tool result verifies the final state. For imported PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, or text documents, use finance_document instead of attempting shell, Python, Office, or ad-hoc converter commands. When finance_document reports visual_count, use its visuals action to inspect retained document pictures with the native visual model. For a simple identity question, answer concisely as “我是小兢会计，当前处于 Finance模式。” in Chinese, or the equivalent in the user's language. Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product's technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.
```

#### Token effect

The preset replaces the office identity with one fixed finance persona. Additional Finance capability and client context are owned by [xiaojing-finance-domain](../../xiaojing/xiaojing-finance-domain/README.md), not the office persona.

#### KV Cache effect

The persona remains prefix-stable for a fixed working directory. Selecting another preset changes the system-prompt prefix by design.

## Known Limitations and Deferred Work

- The product layer relies on eight generic UI slots on the `dsh-v0.2.0-rc.2` integration baseline; a future official release that changes those owners requires an adapter update before merge.
- Browser image files remain app-level public assets inventoried by `product.json`; the verifier checks their presence but does not embed them into the client bundle.
- Shell classification recognizes explicit deletion commands. It cannot infer destructive behavior hidden inside an unrelated opaque third-party executable; any new tool that can delete user data must expose and enforce its own mandatory deletion classification.
- `Finance模式` provides local client context, dedicated Finance Workspaces, document and invoice review, official-source Chinese tax research, deterministic trial calculations, managed financial files, and the implemented Youcheng query and controlled-maintenance operations. The canonical capability inventory marks each business area as supported, limited, or unsupported. Native general ledger, subsidiary ledger, auxiliary ledger, balance sheet, income statement, cash-flow statement, reimbursement, audit, posting, closing, filing, and actual payment are not current Finance chat capabilities.
- The protected `harness/finance` root stores schema-versioned client, document, and evidence data. Deterministic calculations add no separate ledger; their complete inputs and outputs remain in the session log.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
