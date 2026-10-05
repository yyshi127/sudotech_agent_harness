---
kind: upgrade-guide
description: "Windows computer_control 不再使用进程树回退，会拒绝不支持原生 Job 的子进程提供方。"
---

# Windows 电脑操作要求原生 Job 支持

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-xiaojing-computer-control` 之前可以通过本地子进程回退启动辅助进程。现在它请求 `SubprocessSpawnSpec.windowsChildLifetime: 'independent'`，让辅助进程关闭或取消时保留 `launch_app` 打开的应用。辅助进程本身仍受托管。不支持原生 Windows Job 的本地提供方及 SSH 提供方会在启动前拒绝该请求，报错 `independent Windows children require a local Windows Job`。不传该字段的其他子进程消费者保留原有的进程树生命周期。外层宿主 Job 仍可能控制打开的应用。

## 迁移

1. 在 Windows 上使用 `@deepseek-ai/dsh-subprocess-local` 和完整打包的原生依赖运行此插件。安装不完整时恢复 Windows 安装；所选提供方无法提供原生 Windows Job 时，在 `cordis.yml` 中禁用 `@deepseek-ai/dsh-xiaojing-computer-control`，不要移除生命周期选项。
2. 调用 `computer_control` 的 `action: 'list_windows'`，确认成功且没有上述能力错误。取消电脑操作任务后，`launch_app` 打开的应用必须仍然打开。参见[提供方限制](../../../../packages/xiaojing/xiaojing-computer-control/README.zh.md)。
