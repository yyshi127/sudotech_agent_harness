---
kind: upgrade-guide
description: Xiaojing replaces the default Edge-only browser tool and its pairing settings with native Edge and Chrome connections.
---

# 小兢原生浏览器连接

[English](guide.md) | 中文

## 变更

小兢 Web 和 Desktop 组装禁用旧 `browser_control` Host，将其配对页替换为 Chrome 和 Edge 权限开关。`@deepseek-ai/dsh-xiaojing-browser-control/native` 入口提供 `browser_connect`，随后使用所选原生 MCP 工具。默认仍为 Edge，用户明确要求时支持 Chrome。启用浏览器后优先使用其现有标签页；否则省略 surface 时使用专用浏览器。官方 DSH 组装不变。

已配对的小兢 Edge 扩展不能授权 Playwright 官方扩展。旧配置、凭据、业务数据和浏览器 profile 均保留。native-settings 状态响应新增必填 `canOpenSettings`；自定义 Client 须使用匹配的 Host 版本。服务新增 `openSettingsTimeoutMs`，固定设置页导航默认为 30000 毫秒；原生连接超时不变。

## 迁移

1. 将调用 `browser_control` 的提示词或自动化改为调用 `browser_connect`，随后使用返回的工具前缀。仅在用户要求时指定 `browser: "chrome"`；已打开的标签页指定 `surface: "existing"`。
2. 自定义设置状态解析器需接受 `canOpenSettings`，Host 与 Client 一起发布。操作现有标签页时，在浏览器控制设置中启用指定浏览器。“管理”显示说明；Windows 点击“打开设置页”，会在新的普通窗口打开正确的 inspect 页面，其他系统保留可复制地址。用户自行勾选远程调试并批准连接；应用不启用调试或导航已有窗口。权限开关初始关闭；关闭只断开访问，不关闭浏览器。显式部署保留 CDP 和 Playwright 官方扩展路线。参见[连接前提](../../../../packages/xiaojing/xiaojing-browser-control/README.zh.md#connecting-already-open-tabs)。
3. 确认 `browser_connect` 返回预期的浏览器和标签页列表。连接失败后必须显式重新连接，不会转用其他浏览器。
