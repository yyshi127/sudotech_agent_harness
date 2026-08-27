# @deepseek-ai/dsh-client-xiaojing-product

English | [中文](README.zh.md)

The Xiaojing Accounting product layer over DeepSeek Harness. Its Host half supplies the default deployment persona; its browser half supplies brand, theme, hero, first-use guidance, and the product About page through generic slots. The official UI packages retain their default DeepSeek presentation when this plugin is absent.

## Product contributions

The browser plugin registers `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`, `conversation.hero.brand.content`, `onboarding.content`, and `settings.section` only in the `xiaojing` Client build profile. Product copy, palette overrides, versioned beta badge, release highlights, and the default persona live in this package. Electron supplies its actual application version through one restricted preload method; an ordinary Web preview uses a checked fallback that must equal `apps/desktop/package.json`. The product-layer gate rejects a version mismatch and rejects Xiaojing brand marks written back into official UI source roots. The plugin lifecycle also synchronizes the existing browser `theme-color` metadata after the product dataset is attached and restores the generic value when the plugin unloads. The build profile selects the inventoried SUDO logo for the pre-plugin loading page through generic boot metadata; the shell retains its `HARNESS` fallback when that metadata is absent. `product.json` records the official `dsh-v0.1.1-rc.2` baseline, generic slots, browser asset paths, desktop product manifests, and the product-owned `finance` preset displayed as `Finance模式`. A product-layer gate parses the Finance and Standard compositions and allows only the Finance persona and its inventoried product skill root to differ.

The `finance` preset lives under `apps/cli/config/xiaojing-agent-presets/`, and profile boot adds that root only for the `xiaojing` Client profile; the official preset root remains unchanged. This Client plugin supplies the localized Finance display copy through the generic `AgentPresetDisplayRegistry`, so the official preset UI contains no product id or wording. `product.json.financeExtension` inventories Finance skills and owns the future package prefixes, composition-row prefixes, compatibility-adapter filename, and protected `harness/finance` durable root. Host and Client package inventories stay empty until a service-backed finance capability is implemented; instruction-only skills do not require placeholder packages.

The Host product plugin also owns Xiaojing's mandatory deletion policy. Explicit deletion tools and shell deletion commands request one-use confirmation through the shared approval channel even when the session policy is `never`. A monotonic tool guard denies any matching call that did not pass through that exact confirmation. Browser and Windows controls classify delete/remove/uninstall targets and the Delete key as mandatory confirmations inside their own tool providers.

The product identifies itself as “小兢会计，您的AI办公搭子” and accurately describes its technical origin as based on DeepSeek Harness with internal branding and configuration. It does not claim that SUDO Tech developed the underlying framework.

## Upstream upgrade contract

An upstream upgrade starts from stable `main` on a `codex/upgrade-rcX` branch and merges the verified official tag or commit. Product code, brand assets, desktop identity, and accounting logic remain unchanged. Conflicts are resolved only in the generic slots, the rc-specific accounting adapter, the independent integration patches listed by `apps/desktop/integration-patches.json`, and any required atomic data migration.

The upgraded branch may merge only after the product-layer verifier, focused behavior tests, built Web replay, fresh Windows install, and previous-release in-place upgrade checks pass. A version that cannot read or migrate the previous release's data is not releasable.

## Official-source Chinese tax research

The product-owned `china-tax-official-research` skill instructs Finance模式 to establish jurisdiction, taxpayer facts, transaction facts, accounting or tax period, and the requested answer date before reaching a rule-dependent conclusion. It uses the existing `web_search` tool and prioritizes the National Laws and Regulations Database, the Chinese Government website, the State Taxation Administration policy database, the Ministry of Finance, and applicable verified local authorities. It classifies legal effect, effective status, and relevance; requires direct official links and document metadata; and labels unsupported source text, status, or applicability as `待核验`.

The skill stores no regulation text, builds no crawler or RAG index, and does not enable generic HTTP fetching. Search snippets cannot be represented as complete provisions, and a result without enough official text must remain non-definitive. Removing its manifest entry, preset skill directory, and custom root withdraws the capability without changing Harness core packages or user data.

## Model Experience

### Mandatory deletion instruction

#### What the model sees

When either built-in automation provider is composed, the stable automation context states that deletion always requires confirmation under Full access and the `never` approval policy, and prohibits evasion by changing or obscuring the deletion command.

#### Token effect

One fixed sentence in the existing built-in automation context; it is not repeated per tool call.

#### KV Cache effect

The sentence is prefix-stable while the product capability composition remains unchanged.

### Default deployment persona system prompt

#### What the model sees

The plugin fills `deployment:persona` only when downstream system-prompt assembly leaves that section empty; an explicitly selected or user-authored agent persona remains authoritative. When filled, the model sees the default product identity and origin disclosure below, with `{{cwd}}` resolved by the system-prompt service.

##### Verbatim default persona

```markdown
You are 小兢会计, an AI office companion configured for internal use. Your working directory is {{cwd}}. For a simple identity question, answer concisely as “我是小兢会计，您的 AI 办公搭子。” in Chinese, or the equivalent in the user's language. Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product's technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.
```

#### Token effect

The default persona adds one fixed system-prompt section only when no other deployment persona is present.

#### KV Cache effect

The text is prefix-stable while the product version and working directory stay unchanged. Changing the selected persona or working directory changes the system prompt and may invalidate provider prefix reuse.

### Finance模式 preset system prompt

#### What the model sees

A session created with the shipped `finance` preset receives every Standard mode tool, while its `deployment:persona` section is replaced by the finance-specific text below. Its filesystem skill provider also mounts the product-owned `skills/` directory beside the preset; other finance services and skills remain independently removable.

##### Verbatim Finance模式 persona

```markdown
You are 小兢会计, an AI office companion configured for internal use, operating in Finance模式. Your working directory is {{cwd}}. Finance模式 retains every capability of Standard mode and applies an evidence-first discipline to finance and tax work. Distinguish confirmed facts, assumptions, and items that require verification. Do not invent laws, tax rules, accounting standards, citations, client facts, calculations, or completed business actions. When jurisdiction, taxpayer type, accounting standard, accounting period, or tax period can affect the answer, state the applicable assumptions or ask for the missing facts. For current Chinese finance or tax rules, prefer official sources and cite them; when applicability or legal effect cannot be established, say “待核验”. Do not claim that a submission, approval, posting, payment, filing, or external-system change succeeded unless a tool result verifies the final state. For a simple identity question, answer concisely as “我是小兢会计，当前处于 Finance模式。” in Chinese, or the equivalent in the user's language. Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product's technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.
```

#### Token effect

The preset replaces the Standard mode persona with one fixed finance persona. It adds no per-request finance catalog, client record, or regulatory text.

#### KV Cache effect

The persona remains prefix-stable for a fixed working directory. Selecting another preset changes the system-prompt prefix by design.

## Known Limitations and Deferred Work

- The product layer relies on six generic UI slots on the `dsh-v0.1.1-rc.2` integration baseline; a future official release that changes those owners requires an adapter update before merge.
- Browser image files remain app-level public assets inventoried by `product.json`; the verifier checks their presence but does not embed them into the client bundle.
- Shell classification recognizes explicit deletion commands. It cannot infer destructive behavior hidden inside an unrelated opaque third-party executable; any new tool that can delete user data must expose and enforce its own mandatory deletion classification.
- `Finance模式` provides the Standard mode tools, finance-specific verification behavior, and official-source Chinese tax research. It does not yet provide client context, a local regulation library, document extraction, deterministic calculators, Youcheng workflows, SDOO integration, or compliance findings.
- The protected `harness/finance` root is reserved for schema-versioned Finance plugin data; the foundation does not create or write that directory.
