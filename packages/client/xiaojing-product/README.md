# @deepseek-ai/dsh-client-xiaojing-product

English | [中文](README.zh.md)

The Xiaojing Accounting product layer over DeepSeek Harness. Its Host half supplies the default deployment persona; its browser half supplies brand, theme, hero, and first-use guidance through generic slots. The official UI packages retain their default DeepSeek presentation when this plugin is absent.

## Product contributions

The browser plugin registers `sidebar.brand`, `conversation.hero.brand`, and `onboarding.content`. Product copy, palette overrides, and the default persona live in this package. The static Web app selects the inventoried SUDO logo for the pre-plugin loading page through generic boot metadata; the shell retains its `HARNESS` fallback when that metadata is absent. `product.json` records the official rc.5 baseline, generic slots, browser asset paths, and desktop product manifests. `scripts/verify-xiaojing-product-layer.mjs` rejects Xiaojing brand marks written back into the official UI source roots.

The product identifies itself as “小兢会计，您的AI办公搭子” and accurately describes its technical origin as based on DeepSeek Harness with internal branding and configuration. It does not claim that SUDO Tech developed the underlying framework.

## Upstream upgrade contract

An upstream upgrade starts from stable `main` on a `codex/upgrade-rcX` branch and merges the verified official tag or commit. Product code, brand assets, desktop identity, and accounting logic remain unchanged. Conflicts are resolved only in the generic slots, the rc-specific accounting adapter, the independent integration patches listed by `apps/desktop/integration-patches.json`, and any required atomic data migration.

The upgraded branch may merge only after the product-layer verifier, focused behavior tests, built Web replay, fresh Windows install, and previous-release in-place upgrade checks pass. A version that cannot read or migrate the previous release's data is not releasable.

## Model Experience

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

## Known Limitations and Deferred Work

- The product layer relies on three generic UI slots introduced on the rc.5 integration baseline; a future official release that changes those owners requires an adapter update before merge.
- Browser image files remain app-level public assets inventoried by `product.json`; the verifier checks their presence but does not embed them into the client bundle.
