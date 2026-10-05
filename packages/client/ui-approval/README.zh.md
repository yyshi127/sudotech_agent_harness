---
description: "通过作用域交互路径响应 Host 权限请求的浏览器批准界面。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-approval

[English](README.md) | 中文

## 概述

基于 Agent-scoped Remote Event waterfall 的浏览器审批界面。插件通过 `ctx.uiSession` 发布每个待处理请求、接管 Conversation composer、按需渲染关联的 Tool 详情，并将用户决定返回给等待中的 Host 请求。当浏览器必须为等待中的 Host 操作收集批准时，请使用它。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

聚焦审批详情区域后，Enter 仅批准本次，Esc 拒绝。插件挂载期间，这两个按键不能分配给可编辑快捷键。聚焦按钮后，Enter 保留按钮原生操作；重复按键与输入法候选按键不能激活按钮。输入控件保留各自的按键。键盘和指针操作共用同一待处理请求锁；已撤销或替换的请求不能再次作答，较早请求的失败也不会解锁替代请求。

<a id="model-experience"></a>
## 模型体验

无，因为本包只在浏览器中呈现审批请求，不注册任何面向模型的内容。

#### KV Cache 影响

无；审批请求和响应的呈现不会改变模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 每个请求都提供仅本次允许和拒绝。Host 标明可以复用审批的请求还提供“始终允许”，并展示请求方提供的本地化操作范围说明。Client 不保存授权；范围匹配与有效期由 Host 侧审批包管理。请求方提供的本地化文案跟随界面语言，不改写审计原因，也不翻译模型生成的文本。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Remote listener 与临时 Slot entry 由各自注册表持有并观察。
