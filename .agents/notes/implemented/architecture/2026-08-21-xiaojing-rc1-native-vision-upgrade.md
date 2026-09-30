# Agent Note: Xiaojing Accounting rc.1 native-vision integration

Status: implemented

English | [中文](2026-08-21-xiaojing-rc1-native-vision-upgrade.zh.md)

## Problem

Xiaojing Accounting's rc.8 baseline carries isolated branding, local usage accounting, a patched file-upload entry, Weixin delivery, browser and Windows automation, mandatory deletion approval, fixed desktop identity, and 0.1.9 user data that an upgrade must preserve. Official `dsh-v0.1.1-rc.1` introduces native image messages and a durable attachment store, but its browser UI exposes paste and drag/drop rather than the existing Xiaojing file picker. Replacing the product upload path with the upstream gestures would remove document selection, while continuing to serialize images as local paths would fail to use the official multimodal provider and repeat the earlier `image_url` incompatibility in Goal and Plan modes.

The upgrade also changes the local credential document format from the pre-release flat mapping to version 1. The product cannot claim in-place compatibility unless the official migration preserves the API key, settings, sessions, personas, profiles, accounting history, legacy uploads, and new attachment root without creating a plaintext backup or leaving partial data after failure.

## Decision

### Recorded upstream merge

The upgrade branch starts from Xiaojing commit `xiaojing-history-20260930-2` and formally merges official tag `dsh-v0.1.1-rc.1` at commit `dsh-v0.1.1-rc.1`. Merge commit `xiaojing-history-20260930-3` retains both histories. [`product.json`](../../../../packages/client/xiaojing-product/product.json) records the official tag, commit, and product integration base; official rc.1 shell, renderer, attachment, credential, and provider implementations remain authoritative.

The rc.1 tree removed the obsolete `packages/util/home` Knip stanza, so its now-inapplicable vendor-rescope exact edit is retired rather than recreated. The remaining Chinese vendoring-cookbook postimage follows the localized `rescope.zh.md` link already emitted by the official documentation generator.

### Product presentation and feature isolation

The `xiaojing` Client profile, five neutral brand/onboarding slots, product plugin, theme, startup metadata, default persona, usage Host and Client plugins, Weixin Host and Client plugins, browser-control plugins, computer-control plugin, profile-shadow protection, and fixed desktop manifests remain separate from official UI owners and the Agent Loop. Package versions align with the rc.1 family while the desktop product version stays `0.2.0`. Existing saved settings remain authoritative; only a deployment with no saved default model receives `deepseek-v4-flash-vision-exp` from the Xiaojing composition.

### One upload entry over native images

`ui-conversation` exposes the session-scoped `conversation.addImages(files, limits)` method as a provider-neutral intake seam. Paste, page drop, and external file pickers share one atomic media-type, count, per-file, aggregate-size, and input-state validation before preview URLs are allocated. The patched `dsh-file-uploads` picker partitions a mixed selection: PNG, JPEG, WebP, and GIF call that native intake, while documents and unsupported image formats retain the legacy upload path and explicit no-direct-vision text. Ordinary, Goal, and Plan input use the same control. Native image submission is owned by rc.1, persists under `$DSH_HOME/attachments/v1`, and restores the text and image draft after synchronous admission failure.

### Weixin vision and model scope

The Weixin channel keeps its encrypted CDN download and `$DSH_HOME/uploads` source copy. Supported raster images additionally become native prompt image blocks and are persisted by the rc.1 attachment store. The durable “微信助手” session switches to `deepseek-v4-flash-vision-exp` through `session.selectModel({ saveDefault: false })`; this new generic option preserves the normal UI behavior of saving model choices while preventing a channel image from changing the user's global default or another session. Unsupported image formats and ordinary documents remain path-backed text. Deterministic image limit, read, or Host admission failures return a phone-readable reason, complete that queue item, and continue FIFO instead of entering the transient automatic-retry path.

### Accounting and durable data

The accounting compatibility adapter is the only rc.1-facing usage seam. `deepseek-v4-flash-vision-exp` uses the built-in published Flash tariff, and image consumption is never estimated: settlement uses only the provider's usage result. Historical rows retain their stored tariff version and exact category costs. The desktop data contract adds `harness/attachments`; installer identity and `%APPDATA%\@sudotech\xiaojing-accounting-desktop` remain unchanged. The 0.1.9 fixture gate exercises official flat-credential migration on a private copy, compares the pre/post SHA-256 key fingerprint, verifies the resulting version-1 file remains writable, rejects an ambiguous legacy document without changing it, and permits no plaintext backup or partial side file.

Windows can temporarily deny the final settings-file rename while a scanner or indexer holds the path. The shared atomic writer now retries only `EPERM`, `EACCES`, and `EBUSY` over a bounded interval without deleting the old target first. A permanent failure or exhausted retry removes the temporary sibling, preserves the previous complete file, and remains visible to the caller.

## Verification

Focused tests exercise product-profile gating and fallbacks, unified mixed-file routing in ordinary, Goal, and Plan modes, shared image admission, durable attachment validation, DeepSeek image serialization, usage settlement including Vision Exp, Weixin native-image delivery and session-only model selection, deterministic image rejection without queue blockage, immediate receipts and 30-second progress, browser tab reuse and browser selection, Windows UI Automation, and mandatory deletion confirmation under the `never` approval policy. Desktop gates verify immutable installer identity, exact default-profile migration, old session and persona readability, credential migration, unchanged settings and workspace bytes, legacy uploads, native attachment-root preservation, and historical accounting totals. Repository generators, typecheck, build, lint, hygiene, documentation sync, coverage, keyless snapshots, Xiaojing Web preview, and Electron development preview remain release gates; packaging is still blocked until the user accepts the previews and a later real 0.1.9-to-0.2.0 Windows in-place installation test passes.

## Alternatives considered

- **Replace the Xiaojing picker with rc.1 paste and drag/drop.** This would adopt the smallest upstream UI but remove the single document-and-image entry the product already exposes. A neutral image-intake method lets the existing picker delegate native image ownership without copying the upstream draft implementation.
- **Keep every selected file on the legacy upload path.** This preserves document behavior but sends supported images only as local-path text, so the official vision provider cannot inspect them and Goal or Plan can reproduce incompatible message serialization. MIME-based partitioning keeps one user gesture while assigning each file to the correct owner.
- **Change the global default model when Weixin receives an image.** This would make the current channel request routable but unexpectedly alter new desktop sessions and the user's saved preference. Session-only selection confines the compatibility adjustment to the durable Weixin assistant.
- **Recalculate old accounting rows with the rc.1 tariff version.** The numeric rates currently match for Flash, but changing a settled row's version would rewrite history and make later tariff changes ambiguous. Historical records remain immutable; only new Vision Exp requests use the new built-in table version.
- **Move product features into the rc.1 UI during conflict resolution.** This would reduce plugin wiring but recreate the upgrade cost the product layer was designed to avoid. The merge changes only neutral seams and compatibility adapters; Xiaojing behavior remains unloadable.

## Consequences

Xiaojing gains official multimodal storage and provider serialization without losing its existing document workflow, and future image entry points have one generic Client API instead of duplicating draft state. The Weixin channel can inspect supported phone images while preserving mobile acknowledgements, queue ordering, security confirmation, and global model settings. Unsupported formats remain transportable but require an installed document or conversion tool; this upgrade does not add OCR, ModLens, a vision bridge, or another model provider.

The upload integration remains a maintained pnpm patch against `dsh-file-uploads`, so an upstream plugin update requires an explicit patch rebase and the mixed-mode behavior test. Source and fixture gates establish application compatibility but do not prove NSIS registry and file-replacement behavior. The installer must retain its permanent identity and pass a real overwrite install from 0.1.9 before 0.2.0 can be published.
