---
description: "通过 Playwright MCP 操作 Chromium，为每个活动 Session 保持独立浏览器状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-browser-use-playwright-mcp

[English](README.md) | 中文

## 概述

通过 Playwright MCP 的上游工具检查网页并操作 Chromium、Chrome 或 Microsoft Edge。提供方在 Session 创建或恢复完成前初始化其 MCP 连接，并跨轮次保留连接。可以启动独立浏览器，也可以让一个 Session 通过调试端点或 Playwright 扩展接入已有浏览器。本包以实验状态发布，仅在显式挂载后启用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在创建或恢复 Session 前，将以下条目挂载到已提供 Agent、工具、系统提示词和工作目录服务的 profile 组合中。加载或重新加载此提供方不会接管已经活动的 Session。浏览器安装遵循上游运行时；使用 `executablePath` 选择已有 Chromium 安装。

```yaml
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
  config:
    mode: launch
    headless: true
```

使用 `mode: attach`，并在 `endpoint` 中设置 HTTP(S) 调试 URL 或 WS(S) 浏览器端点，即可操作已有浏览器。新的活动 Session 在初始化时占用附加连接，并持续保留直到卸载。如果连接已被占用，本次激活不使用该浏览器，但继续运行，后续轮次不会重试。连接释放后，新创建或恢复的激活可以获取它。其他 Session 的直接调用会失败。清理只断开连接，保留外部浏览器及其页面。

使用 `mode: extension`，并在所选浏览器中安装 [Playwright 扩展](https://github.com/microsoft/playwright/tree/main/packages/extension#readme)，即可操作已有标签页，无需配置调试端点。设置 `browser: chrome` 或 `browser: msedge`，会在对应浏览器中打开连接页；用户通过扩展授权连接并选择标签页。`executablePath` 可指定非标准位置的安装。可选的 `extensionToken` 用于与该浏览器中的扩展配对，仅通过子进程环境传递。扩展连接与端点附加连接采用相同的 Session 独占规则，清理时也只断开连接。

挂载多个提供方实例时，为每个实例设置独立的 `browserUse` 隔离域和唯一的 `serverName`。命名空间用于区分工具，不用于选择浏览器，也不会授予对其他 Session 的访问权限。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `mode` | 必填 | `launch`、`attach` 或 `extension`，在本次提供方激活期间固定 |
| `browser` | `chromium` | 启动或扩展连接使用的浏览器通道：`chromium`、`chrome` 或 `msedge` |
| `serverName` | `playwright-mcp` | MCP 工具命名空间，由 1–32 个 ASCII 字母、数字、下划线或连字符组成 |
| `headless` | `true` | 启动时不显示窗口；仅用于 launch 模式 |
| `executablePath` | 上游发现 | 启动浏览器或打开扩展连接页使用的浏览器可执行文件 |
| `endpoint` | attach 时必填 | 已有浏览器调试端点 |
| `extensionToken` | 无 | 扩展模式的秘密配对 token；不通过命令参数传递 |
| `dnsResultOrder` | `ipv4first` | 扩展连接服务的 Node 解析顺序：`verbatim`、`ipv4first` 或 `ipv6first`；仅用于 extension 模式 |
| `toolCallTimeoutMs` | MCP 客户端默认值 | 单次调用超时，单位为毫秒 |

[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-browser-use-playwright-mcp)列出接受的字段。浏览器模式由 profile 或 preset 选择。子进程先清空继承的 `PLAYWRIGHT_MCP_*` 选项，再应用显式配置的扩展 token，避免环境中的选项替换该配置。

扩展模式将 Node 的 `--dns-result-order` 放在原生 CLI 之前。优先 IPv4 可以避免在阻止本机 IPv6 连接的设备上启动无法访问的 IPv6 回环服务；`verbatim` 保留解析器返回的顺序。该设置只改变扩展服务的域名解析，不修改浏览器资料、操作系统网络、launch 模式或端点附加连接。

为整个进程配置系统提示词的 `toolOrder` 时，将浏览器工具留在 `<unlisted-tools>` 中。显式列出浏览器工具名称可能导致未获得浏览器连接的 Session 无法组装提示词。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

提供方解析固定版本 npm 包的可执行入口，并使用当前 Node 启动。服务进程之前可能运行临时协议探测进程。[共享运行时](../browser-use-runtime/README.zh.md)负责等待 Agent 初始化、逐 Session 串行执行与清理；[MCP 客户端](../../mcp/mcp-client/README.zh.md)负责传输、发现和结果投影。

`createSessionMcpOptions(config)` 解析相同的可执行文件、参数、环境、命名空间和独占设置，但不启动进程或注册提供方。消费者可将这些选项用于共享 Session 运行时，在任务需要时才初始化连接。

只要活动 Session 保持连接，浏览器状态就会跨轮次保留。MCP 服务器在经验证的 Session 当前工作目录中启动；Session 后续改变目录时，服务器保留启动目录。销毁会等待服务器关闭，再释放资源。重新加载后恢复 Session 会创建新的浏览器运行状态；已保存的对话历史不会还原 Cookie 或页面。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [浏览器使用](../../../docs/subsystems/browser-use.zh.md) — 提供方选择与 Session 所有权。
- [浏览器使用服务](../../browser-use/browser-use/README.zh.md) — 提供方独占注册。
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) — 上游安装与浏览器行为。

-----

<a id="model-experience"></a>
## 模型体验

### 浏览器工具与截图

#### 模型可见内容

工具以 `mcp__<serverName>__<tool>` 命名，保留上游描述和 JSON schema；默认前缀为 `mcp__playwright-mcp__`。文本与截图通过常规工具结果流程进入 Session 日志。截图需要附件存储及支持图片输入的模型路由；其他路由会收到 MCP 图片诊断。MCP 客户端还提供资源工具和注明服务器来源的指导。只有当前 Session 拥有连接后才显示浏览器指导；针对该服务器的资源请求执行相同的所有权检查。

#### Token 影响

工具目录、资源工具和服务器指导会增加工具定义与提示词文本。调用会向 Session 历史加入参数、文本和获准输入的图片。内联图片字节不进入模型可见历史。

#### KV Cache 影响

不变的工具目录会保留工具定义前缀。结果追加到历史；更换提供方或目录可能降低前缀复用率。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

本集成保留固定版本服务器的浏览器与工具限制。

- 仅支持 Chromium 系列浏览器；不可选择 Firefox 或 WebKit。
- 扩展模式要求在所选浏览器中安装扩展，并由用户授权标签页。仅安装浏览器不会授予对其已有标签页的访问权限。
- 启动失败或取消会拒绝 Session 创建或恢复，并触发客户端清理。断开的客户端不会重试；修复原因后，创建新 Session，或卸载并恢复已有 Session。
- 连接独占仅在此提供方实例内有效。其他进程与浏览器用户仍可修改相同页面。
- 共享资源服务器目录可以显示继承的服务器名称，但不会授予对其他 Session 浏览器的访问权限。
- 取消不会撤销已发送给浏览器的导航、点击或其他操作。
- 工具 schema 跟随固定的实验依赖版本，不承诺 DSH 稳定性。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
