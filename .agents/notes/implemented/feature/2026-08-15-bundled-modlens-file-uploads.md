# Agent Note: Ship ModLens and prompt file uploads in the web profile

Status: implemented

English | [中文](2026-08-15-bundled-modlens-file-uploads.zh.md)

## Problem

The Windows application needs image inspection and prompt file attachments without asking each user to install plugins after setup. Installing these packages only in one mutable profile makes a fresh installation incomplete and lets profile-local dependency resolution drift from the application version. The file-upload client also hides its internal input reference while the core composer still reserves text width for that reference, so the visible caret can move away from the position where typed text is inserted. Its attachment rail can shrink below the fixed card height in the home-page composer and overlap the input card.

## Decision

The application dependency graph pins `@liustack/modlens` at `3.16.6` and `dsh-file-uploads` at upstream commit `3ea46e1583eac426cc34e191ea811e71b0c8347e`. The shipped `web` profile template layers both bundles after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`, so a fresh application resolves them from the installation rather than requiring a profile-local copy. Both projects keep their upstream package names, authorship, repositories, and MIT license notices; this repository integrates them but does not claim their implementation.

The pnpm patch for `dsh-file-uploads` keeps the text selection before hidden file references, preserves composer focus while opening the file picker, and makes the attachment rail a non-shrinking 54-pixel flex item. Hidden references remain in the input machine so the submitted prompt still reconstructs every attachment, while new text appears immediately before that metadata and the caret matches the visible insertion position.

## Verification

The pinned package passes its syntax checks and seven upstream Node tests after the patch. A Playwright-driven run against the installed Electron application uploads a temporary file, focuses the composer after the hidden reference exists, and types `sd`; the resulting input stores `sd` before the hidden reference with both selection endpoints at offset 2. The same run measures a 54-pixel attachment rail, a 54-pixel card, and an 8-pixel gap above the composer instead of overlap. The test removes only its own temporary upload after inspection.

## Alternatives considered

**Install both plugins into each user's profile after application setup.** This makes first use depend on another package operation, duplicates dependencies, and lets a profile-local package copy diverge from the tested application graph.

**Vendor the plugin source into Harness packages.** Vendoring transfers maintenance work into this repository without changing the extension point; pinned external dependencies plus an explicit patch preserve upstream ownership and make the local delta reviewable.

**Wait for an upstream file-upload release.** The current application needs a working composer now, and the incompatibility is specific and small. Keeping it as a pnpm patch makes replacement by a later upstream fix deliberate instead of hiding a local fork.

## Consequences

A desktop release rebuild is required when either bundled plugin version changes. The file-upload patch must be reviewed and either rebased or removed when the pinned upstream commit advances. Profiles that still match the former installation-owned web tuple migrate to the shipped template; any profile with an extra, missing, or reordered bundle remains user-owned and is not rewritten.
