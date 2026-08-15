# Agent Note: Anchor pi-ai runtime dependencies in the desktop package

Status: implemented

English | [中文](2026-08-15-desktop-pi-ai-runtime-closure.zh.md)

## Problem

The Electron package collector includes `@earendil-works/pi-ai` when it reaches that package through the workspace bundle chain, but the generated Windows application omits pi-ai's npm dependencies. The installed backend therefore exits while loading `@deepseek-ai/dsh-llm-pi-ai`, first reporting that it cannot resolve `typebox`. Source launches do not reproduce the failure because the workspace's pnpm graph supplies those packages outside the packaged application.

## Decision

The desktop application declares `@earendil-works/pi-ai` version `0.82.1` as a direct runtime dependency. This edge is a packaging anchor for the same pi-ai implementation already selected by `@deepseek-ai/dsh-llm-pi-ai`; application code continues to consume the DSH adapter rather than importing pi-ai directly. A Windows release is accepted only after the bundled Node.js runtime imports the packaged pi-ai entry and the packaged CLI reaches its web-listening state from a temporary Harness home.

## Verification

The failing `0.1.4` application contains pi-ai but omits `typebox`, `partial-json`, `openai`, and the provider SDK packages. Its backend log records `ERR_MODULE_NOT_FOUND` for `typebox` during the `llm-pi-ai` loader entry. The replacement build checks the direct dependency closure inside `win-unpacked`, imports pi-ai with the bundled Node.js executable, and starts the packaged `dsh web --port 0` command before the installer is copied to the release directory.

## Alternatives considered

**Add only `typebox` to the desktop application.** `typebox` is merely the first missing import; the same packaged graph also omits other pi-ai dependencies, so fixing one package would expose the next startup or provider-specific failure.

**Copy pi-ai dependencies with `extraResources`.** A hand-maintained copy list duplicates the upstream manifest and can silently miss a dependency when pi-ai changes. A direct package dependency lets pnpm and the package collector own that closure.

**Rely on the workspace installation layout.** The layout exists only during source development and is not part of the installed application, so it cannot be a release dependency source.

## Consequences

The desktop manifest contains one dependency used as a packaging anchor rather than a direct code import. Its pinned version must move with the version selected by `@deepseek-ai/dsh-llm-pi-ai`; the packaged-runtime smoke exposes drift or another omitted runtime dependency before release.
