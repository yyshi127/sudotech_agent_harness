# Agent Note: Xiaojing rc.2 Files pipeline and isolated visualization

Status: implemented

English | [中文](2026-08-24-xiaojing-rc2-files-and-visualization-upgrade.zh.md)

## Problem

Xiaojing Accounting's 0.2.0 source tree must advance from official `dsh-v0.1.1-rc.1` to `dsh-v0.1.1-rc.2` without moving product branding, usage accounting, unified image-and-document upload, Weixin delivery, browser control, Windows control, mandatory deletion approval, installer identity, or 0.1.9 user data into official core owners. rc.2 replaces the provider-facing image path with one canonical request pipeline that can resolve retained images through the DeepSeek Files API and fall back to retained inline data. Keeping an rc.1-specific image transport in Xiaojing integrations would create two serialization paths and make desktop, Goal, Plan, and Weixin images behave differently.

The product also needs the `Nagi-ovo/dsh-visualize` plugin, but its cards must retain their original light whale-blue appearance rather than inheriting either the Harness theme or the Xiaojing pale-green theme. Installing the upstream package directly into a mutable user profile would weaken product assembly guarantees and could reintroduce profile-local Harness or Cordis copies. The feature therefore needs a reviewed, removable product integration with preserved third-party attribution.

## Decision

### Recorded upstream merge

The upgrade branch starts from Xiaojing integration base `48f0c4f9fc5ecb17cd8460639089ae976ea80a79` and formally merges official tag `dsh-v0.1.1-rc.2` at commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28`. Merge commit `9314d9526c949fb8884f4ddc380deb7f242775ce` preserves both histories. [`product.json`](../../../../packages/client/xiaojing-product/product.json) records the official release, commit, and product integration base. Package versions align with rc.2 while the desktop product version remains `0.2.0`.

### Canonical native-image ownership

Official rc.2 remains the sole owner of native-image normalization, durable attachment references, provider request variants, DeepSeek Files resolution, and inline fallback. Xiaojing's file picker continues to call the provider-neutral, session-scoped `conversation.addImages()` entry for PNG, JPEG, WebP, and GIF, while documents and unsupported image formats remain on `dsh-file-uploads`. Paste, drag/drop, the picker, ordinary input, Goal, Plan, and Weixin all converge on the same native-image representation before the provider runs. Product integrations do not construct `image_url`, `file_id`, or inline provider payloads themselves.

The accounting observer remains attached only to `llm/stream` through its rc.2 compatibility adapter and settles provider-reported usage once. Image usage is not estimated locally. Existing tariff versions, integer-nanoyuan history, API-key fingerprints, Remote fields, and Client presentation remain unchanged.

### Product presentation and theme metadata

The `xiaojing` Client profile, five neutral brand and onboarding slots, startup metadata, default persona, usage UI, Weixin UI, browser settings, and desktop identity remain product-owned. Official UI owners retain neutral fallbacks. The product plugin synchronizes the existing `theme-color` metadata after attaching its dataset so the initial browser chrome matches the rendered Xiaojing background, and restores the generic value when unloaded. Official rc.2 permission labels remain authoritative rather than being overwritten by a product patch.

### Isolated visualization plugin

`@deepseek-ai/dsh-xiaojing-visualize` is adapted from `Nagi-ovo/dsh-visualize` at reviewed commit `b0bed38f40ffbb0d72bb88393d865307944c1bce`. It retains the upstream BSD-3-Clause license and adds a `NOTICE.md` adaptation record. The Host face registers the model tool and bundled skill; the Client face registers the settled card and streaming preview only in the Xiaojing build profile. Every card remains in an opaque-origin `sandbox="allow-scripts"` iframe with the upstream restrictive content security policy.

The Client injects a fixed light whale-blue palette and never reads Harness, Xiaojing, or operating-system theme state. One Web composition row activates the feature and the `web-app` resolver manifest declares its package dependency. The product-layer verifier requires both declarations so a successful source build cannot silently omit the runtime module. Removing or disabling the row and rebuilding removes the tool, skill, preview, and card renderer without changing product branding, accounting, uploads, channels, automation, or persistent-data owners; complete source removal also deletes the resolver dependency.

### Data and release compatibility

The desktop package name, App ID, NSIS GUID, executable name, installation directory, shortcut identity, and `%APPDATA%\@sudotech\xiaojing-accounting-desktop` data root remain unchanged. rc.2 reads the existing session, credential, persona, profile, upload, attachment, accounting, browser, Weixin, and Electron state without rewriting compatible files. The 0.1.9 compatibility fixture and fixed installer-identity gates remain release blockers; source compatibility does not substitute for a later real Windows in-place installation test.

## Verification

Focused verification covers official rc.2 image normalization, Files request variants and fallback, native-image replay, mixed picker routing in ordinary, Goal, and Plan modes, Xiaojing profile assembly, initial theme metadata, accounting, Weixin image delivery, browser and Windows control, deletion approval, visualization validation, sandbox policy, streaming preview, fixed palette, and plugin removal. The desktop identity and synthetic 0.1.9 user-data gates, repository typecheck, build, lint, hygiene, documentation sync, keyless snapshots, assembled Web replay, and the 3090 product preview remain required before packaging. Packaging remains blocked until the user accepts the preview and the installer later passes real clean-install and 0.1.9 overwrite tests.

## Alternatives considered

- **Copy the rc.2 source over the product tree.** This would lose the recorded merge ancestry and obscure which conflicts belong to upstream versus Xiaojing. A three-way merge keeps the official history and confines adaptations to neutral slots, compatibility files, and product composition.
- **Keep the rc.1 provider image serialization for Xiaojing uploads and Weixin.** This would fork the request path and bypass rc.2 Files resolution and fallback. Delegating native images to official normalization gives every entry point the same durable and provider behavior.
- **Install the visualization package into each user's mutable profile.** This would require post-install setup and expose product assembly to dependency shadowing. A reviewed workspace package enabled only by the Xiaojing composition is reproducible and removable without user profile mutation.
- **Make visualization cards follow the Xiaojing theme.** This would change the requested plugin appearance and couple it to product CSS. A fixed local palette preserves the plugin's visual identity and limits future upstream-theme conflicts to one package.
- **Embed visualization behavior in the product brand plugin.** This would mix reusable active content with brand presentation and make removal incomplete. A separate Cordis package owns its tool, skill, UI, security policy, and tests.

## Consequences

All supported image entry points now rely on the rc.2 canonical provider path, including DeepSeek Files resolution with retained-inline fallback, while the existing single upload button and document workflow remain intact. The visualization feature is reproducible in Xiaojing builds, visually independent, attributed, and removable through one composition change. Product theme metadata now matches the initial rendered background without moving brand values into official UI code.

The visualization tool adds a stable model tool schema and skill catalog entry whenever its composition row is enabled, and model-authored HTML remains active but sandboxed content. Static CDN assets still require network access. The rc.2 source and fixture checks establish application-level compatibility, but a distributable 0.2.0 release is still prohibited until the Windows installer is built after preview acceptance and proves an actual overwrite upgrade from 0.1.9 without data or identity drift.
