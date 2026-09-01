# Agent Note: Xiaojing desktop main-module packaging

Status: implemented

English | [中文](2026-08-30-xiaojing-desktop-main-module-packaging.zh.md)

## Problem

Electron-builder applies `build.files` independently from npm's top-level `files` list. A local module can therefore pass source tests and still be absent from `app.asar`, causing the installed desktop application to fail before its main process starts.

## Decision

Every relative module imported by the Electron main process is listed in `build.files`. Desktop identity verification extracts those imports from `main.mjs` and rejects the build configuration when any imported file is missing.

The Windows release procedure also inspects the generated `app.asar` before publishing an installer. Source-only tests do not substitute for this packaged-file check.

## Alternatives considered

**Rely on the top-level npm `files` list.** Electron-builder's explicit `build.files` list takes precedence for application packaging, so the npm list cannot prove that the installed application contains a module.

**Remove the local module and inline its logic in `main.mjs`.** This would hide the packaging defect by weakening the module separation instead of validating the actual Electron configuration.

## Consequences

Adding a new relative main-process module requires one corresponding `build.files` entry. The identity check fails before packaging when the entry is omitted, and release verification confirms the generated archive contains the module.
