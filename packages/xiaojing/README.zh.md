# xiaojing/ — 小兢产品能力

[English](README.md) | 中文

本组包含小兢会计的可选产品能力。每个包都是普通 Cordis 插件，开发配置可以独立移除，不需要修改 Harness 核心包。

| 包 | 作用 | ctx key |
|---|---|---|
| [`xiaojing-browser-control/`](xiaojing-browser-control/README.md) | 由 Microsoft Edge 驱动的语义浏览器自动化 | `ctx.xiaojingBrowserControl` |
| [`xiaojing-computer-control/`](xiaojing-computer-control/README.md) | 基于 Windows UI Automation 的语义电脑操控 | `ctx.xiaojingComputerControl` |
