# Agent Note: Xiaojing packaged Host boot verification

Status: implemented

English | [中文](2026-08-30-xiaojing-desktop-packaged-host-boot.zh.md)

## Problem

Workspace development links can satisfy a plugin's peer dependency even when the assembled Electron application does not provide that package. Archive checks for the Electron main process cannot detect this gap, so an installer may pass source and archive verification while its packaged Host exits during plugin loading.

## Decision

The Web application bundle provides `@deepseek-ai/dsh-web-fetch-http`, which the Xiaojing Finance evidence plugin imports as its HTTP provider.

The Windows release verifier starts the packaged Node runtime and packaged `dsh` CLI with the Xiaojing profile, an isolated temporary `DSH_HOME`, no DeepSeek API key, and `--no-open`. Verification succeeds only after the complete plugin tree loads and the Host reports its loopback URL. The verifier then terminates that exact temporary process tree and removes its temporary data.

## Alternatives considered

**Check package manifests without starting the Host.** Static dependency checks cannot prove that Electron-builder copied the resolved package tree or that native and conditional imports load on the target platform.

**Add the missing provider only to the desktop package.** That would repair one installer while leaving the Web application bundle incomplete for other assemblies that enable the same Finance plugin.

## Consequences

The Windows package step includes one keyless Host startup, so it takes slightly longer. A release fails before publication when the packaged Xiaojing plugin tree has a missing runtime package or cannot reach readiness, without reading or modifying the user's data.
