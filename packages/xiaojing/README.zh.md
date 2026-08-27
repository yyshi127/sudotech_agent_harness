# xiaojing/ — 小兢产品能力

[English](README.md) | 中文

本组包含小兢会计的可选产品能力。每个包都是普通 Cordis 插件，开发配置可以独立移除，不需要修改 Harness 核心包。

| 包 | 作用 | ctx key |
|---|---|---|
| [`xiaojing-browser-control/`](xiaojing-browser-control/README.zh.md) | Microsoft Edge 语义浏览器自动化 | `ctx.xiaojingBrowserControl` |
| [`xiaojing-computer-control/`](xiaojing-computer-control/README.zh.md) | 基于 Windows UI Automation 的语义电脑操控 | `ctx.xiaojingComputerControl` |
| [`xiaojing-desktop-companion/`](xiaojing-desktop-companion/README.zh.md) | 桌面小兢的脱敏任务状态聚合与 loopback SSE | `ctx.xiaojingDesktopCompanion` |
| [`xiaojing-weixin-channel/`](xiaojing-weixin-channel/README.zh.md) | 腾讯 iLink 绑定、文字任务回传和持久化微信 Agent 会话 | 无 |
| [`xiaojing-visualize/`](xiaojing-visualize/README.zh.md) | 可移除的可视化工具、skill 和沙箱卡片 | 无 |

## Finance 扩展包

Finance 当前没有 Host 或 Client 服务包。纯指令的官方财税来源研究 skill 随产品预设分发，并登记在 `packages/client/xiaojing-product/product.json` 中；它不需要空的服务占位包。只有完整能力 seam 已具备 Service Definition、提供方、消费方、组合行、持久化约定和聚焦验证时，才创建对应包。Host 包使用 `@deepseek-ai/dsh-xiaojing-finance-*` 和 `xiaojing-finance-*` 配置行；Client 包使用 `@deepseek-ai/dsh-client-ui-xiaojing-finance-*` 和 `ui-xiaojing-finance-*` 配置行。rc 专属导入集中在 `src/compat.ts`，持久化财务数据只写入受保护的 `$DSH_HOME/finance` 根目录。
