---
kind: upgrade-guide
description: Xiaojing Desktop removes DeepSeek account login and account-authenticated model selection.
---

# Xiaojing API-key setup

English | [中文](guide.zh.md)

## Change

Xiaojing Desktop opens its main workspace with the existing first-use API-key guide. The native login welcome window, account menu, account introduction, and `deepseek-account` model provider are unavailable. The official Web deployment keeps its account provider. Existing settings, credentials, and Session records are retained.

## Migration

1. Open **Settings → Models**, edit **DeepSeek**, and save an API key obtained from the [DeepSeek Platform](https://platform.deepseek.com/). An existing working API key needs no change.
2. If a Session selected a `deepseek-account` model, select a model from DeepSeek or another configured API-key provider before sending its next message. Its previous transcript remains available.
3. Confirm that a fresh Xiaojing launch shows the first-use guide, **Get started** opens the workspace, and Settings offers model configuration without an account login entry. The acknowledged guide stays closed after restart.
