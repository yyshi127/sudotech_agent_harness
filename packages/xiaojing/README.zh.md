# xiaojing/ — 小兢产品能力

[English](README.md) | 中文

本组包含小兢会计的可选产品能力。每个包都是普通 Cordis 插件，开发配置可以独立移除，不需要修改 Harness 核心包。

| 包 | 作用 | ctx key |
|---|---|---|
| [`xiaojing-browser-control/`](xiaojing-browser-control/README.md) | 可选择 Edge/Chrome 的语义浏览器自动化 | `ctx.xiaojingBrowserControl` |
| [`xiaojing-computer-control/`](xiaojing-computer-control/README.md) | 基于 Windows UI Automation 的语义电脑操控 | `ctx.xiaojingComputerControl` |
| [`xiaojing-weixin-channel/`](xiaojing-weixin-channel/README.md) | 腾讯 iLink 绑定、文字任务回传和持久化微信 Agent 会话 | 无 |
