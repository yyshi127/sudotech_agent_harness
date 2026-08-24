# Agent Note: Xiaojing Edge-only browser automation

Status: implemented

English | [中文](2026-08-24-xiaojing-edge-only-browser-automation.zh.md)

## Problem

The Xiaojing browser-control plugin exposed both Microsoft Edge and Google Chrome, but both routes used separate Playwright persistent profiles rather than attaching to a person's already running browser. The Chrome choice therefore did not provide the personal-window takeover behavior users expected, while adding a second runtime, a durable setting, per-task schema fields, policy checks, two profile directories, and cross-browser lifecycle tests. Keeping that surface suggested a capability the implementation could not reliably deliver.

## Decision

Xiaojing browser automation supports only Microsoft Edge. `@deepseek-ai/dsh-xiaojing-browser-control` owns one lazy Playwright persistent context at `$DSH_HOME/browser-control/profile`; `browser_control` has no browser-selection input or browser discriminator in its results. `open` continues to reuse an exact destination, a same-origin page, or a blank page in that Edge context before creating a tab. Existing semantic DOM observations, opaque target ownership, private-destination policy, high-impact approval, cancellation, recovery, and plugin-removal behavior stay unchanged.

The Host no longer owns a `xiaojing-browser-control` settings namespace. The removable Client plugin keeps the standalone “Browser Control” section as a static capability page that reports Microsoft Edge as enabled and explains visible startup, minimized DOM operation, and the dedicated login profile. The product prompt identifies Edge directly and does not ask the model to select or override a browser.

The Web composition no longer declares a second profile directory or browser default. Removing the Chrome implementation never deletes `$DSH_HOME/browser-control/chrome-profile` or any sibling directory created by an earlier build; the new runtime simply does not read those paths. This preserves rollback and keeps ordinary in-place upgrades non-destructive.

Source launches also keep the current installation authoritative when the retired shared `$DSH_HOME/profiles/node_modules` directory contains a link to an older checkout. Node dereferences that link before returning the resolved URL, so the profile fallback now checks both the logical legacy directory and the linked package's real directory before retrying from the current installation. The legacy directory remains unchanged.

This decision supersedes only the multi-browser portions of [Xiaojing semantic browser and Windows automation](2026-08-21-xiaojing-semantic-automation.md). That note continues to own the shared plugin separation, semantic target model, risk approval, lifecycle, and Windows UI Automation decisions.

## Alternatives considered

- **Keep Chrome hidden behind a feature flag.** Rejected because unreachable code, configuration, dependencies, and tests would still carry the maintenance and upgrade cost of a removed product capability.
- **Keep the browser setting with Edge as its only value.** Rejected because a writable one-value preference is not a preference and leaves stale Host persistence and transport code.
- **Attach to a person's running Chrome or add an extension.** Deferred as a separate future capability because it requires a different connection, authorization, installation, and security design. It is not a reason to retain the current Playwright Chrome route.
- **Remove the whole browser-control settings section.** Rejected because the standalone page still gives users a clear place to understand the installed Edge behavior and remains independently removable from Harness UI.

## Verification

Focused Host tests exercise a real Playwright-compatible browser process through the single runtime and cover navigation, existing-tab reuse, semantic observations, stale-node rejection, protected actions, session isolation, bounded tabs, cancellation, restart, and disposal. The tool schema and result types contain no browser selector or browser discriminator. Focused Client tests verify the loopback Xiaojing guard, static Microsoft Edge presentation, absence of browser-choice controls, and slot teardown. Composition tests pin the Edge-only product prompt. The profile fallback test covers a dereferenced legacy link and proves that client metadata resolves from the current installation. Generated configuration, API, and tool catalogs must contain only the Edge runtime configuration and Edge-only tool schema. Product-layer, type, build, documentation, and assembled-preview checks remain release gates.

## Consequences

The product has one browser automation behavior to explain, operate, and test. Users no longer see a Chrome choice that implies personal-window takeover. Edge login state remains durable in the existing protected profile, and other Xiaojing capabilities are unchanged because browser control remains an independent Cordis Host and Client pair. Previously created Chrome profile data can occupy disk until the user removes it, but the application neither reads nor mutates it.
