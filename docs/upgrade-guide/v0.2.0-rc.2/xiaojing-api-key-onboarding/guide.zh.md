---
kind: upgrade-guide
description: 小兢桌面端移除 DeepSeek 账号登录及使用账号认证的模型选择。
---

# 小兢 API Key 设置

[English](guide.md) | 中文

## 变更

小兢桌面端打开主工作区并显示原有的首次使用 API Key 说明。不再提供原生登录欢迎窗口、账号菜单、账号引导和 `deepseek-account` 模型提供商。官方 Web 部署保留账号提供商。已有设置、凭据和 Session（会话）记录保持保留。

## 迁移

1. 打开**设置 → 模型**，编辑 **DeepSeek**，保存从 [DeepSeek 开放平台](https://platform.deepseek.com/) 获取的 API Key。已有可用 API Key 无需变更。
2. 若某个 Session 选择了 `deepseek-account` 模型，请在发送下一条消息前改选 DeepSeek 或其他已配置 API Key 的提供商模型。此前的对话记录仍可查看。
3. 确认全新启动小兢时显示首次使用说明，点击**开始使用**后进入工作区，设置中提供模型配置且没有账号登录入口。确认过的说明在重启后保持关闭。
