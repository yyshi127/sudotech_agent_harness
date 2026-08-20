# Agent Note: Xiaojing Accounting rc.8 upstream integration

Status: implemented

English | [中文](2026-08-20-xiaojing-rc8-upgrade.zh.md)

## Problem

Xiaojing Accounting 0.1.9 was integrated on DeepSeek Harness rc.5 and carried a product plugin, local usage accounting, a patched file-upload plugin, desktop compatibility identifiers, and user data that must survive an upgrade. Official rc.8 replaces substantial Web client assembly and interaction code. Copying product files onto a clean rc.8 checkout would lose the upstream merge ancestry and make it difficult to distinguish omitted product behavior from intentional rc.8 changes, while retaining rc.5 UI assembly would prevent the product from adopting the new layout and client build model.

The installed Web profile also contained ModLens. Version 0.2.0 must remove that installation-owned default without rewriting profiles that users reordered or extended, and it must prove that rc.8 can read previous sessions, credentials, presets, attachments, settings, storage, and accounting records before an installer may be built.

## Decision

### Upstream merge

The upgrade branch starts at Xiaojing stable commit `8d7ded5a542a8fe99394e27b27e69cd3472838a3` and merges official tag `dsh-v0.1.0-rc.8` at commit `141eb6fef83422698aef7a981029e843e8161534`. A detached pure-rc.8 worktree is the conflict-resolution reference. Generated conflicts are resolved by the rc.8 generator or source of truth instead of hand-combining generated output. The resulting merge commit retains both histories and [`product.json`](../../../../packages/client/xiaojing-product/product.json) records the exact upstream and product integration bases.

The rc.8 Web renderer, shell, settings surfaces, and Client build environment are authoritative. Superseded rc.5 UI assembly and the custom writable API-key UI patch are removed. Electron still clears inherited `DEEPSEEK_API_KEY` values before Host startup, while rc.8 owns credential creation and replacement.

### Product build and UI ownership

The `xiaojing` Client build profile supplies the public title, locale, palette metadata, startup logo metadata, and `DSH_CLIENT_BUILD_PROFILE=xiaojing` to both Vite and dynamic Client package builds. An `official` profile builds the upstream presentation, and an unselected local build retains rc.8 fallback behavior. The Xiaojing browser plugin registers product renderers only when compiled for the `xiaojing` profile, so installing the package alone cannot replace the official presentation.

The product consumes `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`, `conversation.hero.brand.content`, and `onboarding.content`. The first three brand slots come from rc.8, while `conversation.hero.brand.content` is the one additional neutral slot needed for the Xiaojing headline and badge. Every owner retains rc.8 fallback content. Product names, assets, palette overrides, onboarding copy, and default persona remain in `xiaojing-product`; generic UI packages contain only slot definitions, owner layout, and fallback behavior. The Web plugin-loading page reads generic build metadata and displays `HARNESS` only when no product logo is present.

### Function plugins

Usage accounting continues to observe actual provider usage through `llm/stream`, with all rc.8-specific stream, token, settings, endpoint, and credential imports contained in `packages/llm/usage-accounting/src/compat.ts`. Pricing, integer-nanoyuan settlement, immutable rows, API-key fingerprint isolation, Remote fields, update events, and Client presentation remain unchanged. This preserves 0.1.9 ledger meaning instead of treating the source upgrade as a chance to redesign accounting.

`dsh-file-uploads` remains in the shipped Web profile and keeps the local attachment-layout and caret patch. ModLens, its dependencies, default profile entry, notices, and visual-bridge behavior are removed. The profile loader atomically rewrites only the exact installation-owned 0.1.9 bundle sequence `base + web-app + ModLens + dsh-file-uploads` to `base + web-app + dsh-file-uploads`. A profile with a different order, an additional plugin, or any other manifest difference remains unchanged. Runtime-shadow protection continues to reject profile-local Harness or Cordis copies that could replace the application runtime.

### Desktop identity and durable data

The desktop source version becomes `0.2.0`, but package name, AppUserModelId, NSIS GUID, installation directory, executable name, product name, installation scope, shortcut name, and `%APPDATA%\@sudotech\xiaojing-accounting-desktop` data root remain fixed. Workspace constraints classify `apps/desktop` as a private deployment application rather than an npm release member. This source milestone does not build or install an NSIS package; the first 0.2.0 installer remains blocked on product preview and a later real 0.1.9-to-0.2.0 Windows in-place upgrade test.

The upgrade fixture models 0.1.9 settings, an opaque credential, a user preset, installation-owned and customized profiles, a checksummed Zstandard session, attachment and storage files, Electron state, a Documents workspace, and an accounting ledger with current- and old-key rows. The compatibility verifier simulates application replacement, opens the session through the rc.8 JSONL persistence implementation, resolves and replaces the copied credential without printing it, discovers the preset, validates settings and accounting category costs, and permits only the exact default-profile migration. All other protected files must remain byte-identical. Development also uses a temporary copy of current local data; the formal data root is read-only and no verification invokes the DeepSeek API.

## Verification

Focused tests cover the Client build profiles, product registration gating and slot fallbacks, usage observation and UI, file-upload patch, exact profile migration, custom-profile preservation, writable credentials, and immutable desktop identity. The user-data verifier exercises the assembled rc.8 persistence, credential, preset, profile, and accounting readers against the previous-release fixture. Generated Typert, Client API and slot catalogs, configuration catalogs, dependency metadata, and bilingual documentation are regenerated from rc.8 sources. The final source gate requires relevant typecheck, build, lint, hygiene, documentation sync, a composed Host Web preview on port 3090, and an Electron development preview before packaging work begins.

## Alternatives considered

- **Copy a clean rc.8 tree and reapply visible Xiaojing files.** This appears simpler because it avoids textual merge conflicts, but it discards merge ancestry, makes missed behavior difficult to audit, and encourages product code to follow file locations instead of extension points. A recorded merge plus a pure reference worktree preserves provenance and exposes every compatibility decision.
- **Keep the rc.5 renderer on top of the rc.8 Host.** This would reduce immediate visual change but retain replaced assembly code and create an unsupported mixed version. The product instead adopts rc.8 layout and keeps only neutral slots and isolated product renderers.
- **Rewrite every profile containing ModLens.** This would remove more copies but could silently destroy user plugin choices. Exact installation-owned tuple migration removes only state whose origin is known.
- **Retain ModLens as an optional bundled dependency.** Version 0.2.0 has no visual-bridge requirement, and retaining the dependency would preserve startup and compatibility paths that are not exercised by the product. Users' unrelated custom profile content remains outside the migration.

## Consequences

Future upstream upgrades start from an auditable rc.8 merge base and should ordinarily change only neutral UI slots, the accounting compatibility adapter, independent integration patches, generated outputs, or explicit durable-data migrations. The product now has two deliberate build results: official fallback and Xiaojing. A product preview must use `build:xiaojing`; a generic build is not evidence of Xiaojing branding.

The profile migration is intentionally narrow and may leave ModLens in a user-customized profile because ownership cannot be proven from package presence alone. Removing it from such a profile requires an explicit user choice. The source checks establish reader compatibility but do not prove Windows installer behavior; packaging and in-place installation remain separate release gates after visual confirmation.
