---
description: "Xiaojing finance, document, desktop and automation capabilities."
kind: "package-group"
---

# xiaojing/ — 小兢产品能力

[English](README.md) | 中文

## 概述

本组包含小兢会计的可选产品能力。每个包都是普通 Cordis 插件，开发配置可以独立移除，不需要修改 Harness 核心包。

[产品服务参考](../../docs/subsystems/xiaojing.zh.md)说明本组服务及其请求和结果类型。

## 包

| 包 | 作用 | ctx key |
|---|---|---|
| [`xiaojing-finance-domain/`](xiaojing-finance-domain/README.zh.md) | Finance 本地客户档案、专属 Workspace 与不可变会话上下文 | `ctx.xiaojingFinanceDomain` |
| [`xiaojing-finance-calculations/`](xiaojing-finance-calculations/README.zh.md) | 带版本的增值税、附加税费、企业所得税和工资薪金个税确定性试算 | `ctx.xiaojingFinanceCalculations` |
| [`xiaojing-finance-documents/`](xiaojing-finance-documents/README.zh.md) | 为 Finance 与普通小兢会话提供共享确定性文字提取和受限文档视觉读取，包括扫描型 PDF 页面 | `ctx.xiaojingFinanceDocuments` |
| [`xiaojing-finance-evidence/`](xiaojing-finance-evidence/README.zh.md) | 按日期检索官方财税依据 | `ctx.xiaojingFinanceEvidence` |
| [`xiaojing-browser-control/`](xiaojing-browser-control/README.zh.md) | Microsoft Edge 语义浏览器自动化 | `ctx.xiaojingBrowserControl` |
| [`xiaojing-computer-control/`](xiaojing-computer-control/README.zh.md) | 基于 Windows UI Automation 的语义电脑操控 | `ctx.xiaojingComputerControl` |
| [`xiaojing-desktop-companion/`](xiaojing-desktop-companion/README.zh.md) | 桌面小兢的脱敏任务状态聚合与 loopback SSE | `ctx.xiaojingDesktopCompanion` |
| [`xiaojing-weixin-channel/`](xiaojing-weixin-channel/README.zh.md) | 腾讯 iLink 绑定、文字任务回传和持久化微信 Agent 会话 | 无 |
| [`xiaojing-visualize/`](xiaojing-visualize/README.zh.md) | 可移除的可视化工具、skill 和沙箱卡片 | 无 |


## 目录

- [功能说明](#capabilities)
- [开发备注](#dev-note)

<a id="capabilities"></a>
## Finance 扩展包

Finance Host 包使用 `@deepseek-ai/dsh-xiaojing-finance-*` 和 `xiaojing-finance-*` 配置行；Client 包使用 `@deepseek-ai/dsh-client-ui-xiaojing-finance-*` 和 `ui-xiaojing-finance-*` 配置行。`xiaojing-finance-domain` 负责本地纳税主体档案、Finance 专属 Workspace、不可变会话绑定、生成的 Remote 和受控文件；`xiaojing-finance-calculations` 负责带版本的纯试算，并且只读取不可变客户快照中的纳税人类型；`xiaojing-finance-documents` 只维护一套确定性解析核心，其 Finance 适配器保持客户导入隔离，普通会话适配器只授权当前会话中持久化的人类上传；`xiaojing-finance-evidence` 则在不修改客户域的前提下增加官方来源研究。rc 专属导入集中在兼容适配器；持久化档案、标准化文档缓存和受限依据缓存只写入受保护的 `$DSH_HOME/finance` 根目录，用户可见客户文件写入单独配置的 Finance 工作区根目录。试算不新增独立持久化文件，可从会话工具事件重建。

<a id="dev-note"></a>
### 开发备注

无。
