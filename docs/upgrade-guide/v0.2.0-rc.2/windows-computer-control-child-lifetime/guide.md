---
kind: upgrade-guide
description: "Windows computer_control rejects subprocess providers without native Job support instead of using process-tree fallback."
---

# Windows computer control requires native Job support

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-xiaojing-computer-control` previously could launch its helper through the local subprocess fallback. It now requests `SubprocessSpawnSpec.windowsChildLifetime: 'independent'` so closing or cancelling that helper preserves applications opened by `launch_app`. The helper itself remains managed. Local providers without native Windows Job support and SSH providers reject this request before spawning, with `independent Windows children require a local Windows Job`. Other subprocess consumers that omit the field retain their existing process-tree lifetime. Enclosing host Jobs can still govern launched applications.

## Migration

1. Run this plugin on Windows with `@deepseek-ai/dsh-subprocess-local` and the complete packaged native dependencies. Restore an incomplete Windows installation; if the selected provider cannot supply native Windows Jobs, disable `@deepseek-ai/dsh-xiaojing-computer-control` in `cordis.yml` rather than removing the lifetime option.
2. Call `computer_control` with `action: 'list_windows'` and confirm it succeeds without the capability error. An application opened by `launch_app` must remain open when its computer-control task is cancelled. See the [provider limitations](../../../../packages/xiaojing/xiaojing-computer-control/README.md).
