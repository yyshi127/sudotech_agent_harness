# Agent Note: 小兢语义浏览器与 Windows 自动化

Status: implemented

[English](2026-08-21-xiaojing-semantic-automation.md) | 中文

## Problem

小兢会计需要在安装后立即具备浏览器和原生 Windows 应用操控能力。如果要求用户发现外部插件、安装驱动、配置另一组 API Key，或者在每个新会话中重新教它如何操作电脑，就不能满足该产品行为。像素与 OCR 自动化还会引入大型运行环境、较弱的目标身份，以及本次明确不包含的第二套视觉能力。

## Decision

两项能力由两个独立 Cordis 包负责：`@deepseek-ai/dsh-xiaojing-browser-control` 注册 `browser_control`，`@deepseek-ai/dsh-xiaojing-computer-control` 注册 `computer_control`。二者在 Web 组合中分别占用独立配置行，因此开发 overlay 可以移除任意能力，而无需修改 Harness 核心。产品组合默认启用二者。工具有意注册为部署级全局配置行，因为每个小兢会话，包括关闭 runtime context 的用户预设，都必须获得已安装 schema 及其路由说明。小兢 Host 产品插件会为允许 runtime context 的会话增加组合提示。Schema 与可选的组合提示都会要求模型选择最短、确定性最高的路径：文件、数据、编辑和命令工具保持主路径，网站使用浏览器操控，只有任务必须操作原生应用可见界面时，Windows 操控才作为补充。

浏览器操控通过 `playwright-core` 使用 `DSH_HOME` 下的专用持久 profile 启动系统已安装的 Microsoft Edge。它返回有界可见文本和语义交互目标。目标是会话独占的不透明标识，会过期，并在执行动作或切换标签页后失效。模型请求不能包含 CSS 选择器、JavaScript、CDP 命令、浏览器 profile 路径或密码值。路由检查分别处理关联 frame 的请求和 Service Worker 请求；仅当已授权的同源页面仍处于打开状态时，才允许 Service Worker 访问私有目标。Windows 产品不捆绑 Chrome for Testing。可配置 Chromium 可执行文件只保留给测试或受控部署。

Windows 操控通过 Harness subprocess 能力维护一个持久 Windows PowerShell 5.1 helper。Helper 接受有界的换行 JSON 协议，查询 Windows“开始”应用目录，启动一个选定目录项，并公开可见顶层窗口和 `System.Windows.Automation` 控件。模型只能看到会过期且绑定会话的应用 ID，不能提供或读取应用注册 ID、可执行文件路径、PowerShell 源码或任意 Shell 命令。启动成功后会消费本次应用列表并返回新的窗口列表。窗口和控件标识同样不透明、绑定会话且有界，并会在状态变化后失效。

浏览器操作按 agent 会话串行，Windows 操作则由单个 helper 全局串行。两个提供方都会传播取消、拒绝跨会话不透明 ID、在自有进程中断后恢复，并在插件卸载时释放浏览器或 helper 进程。取消浏览器最后一个页面时，会先创建空白替代页再关闭失败页，因此恢复期间可见 Edge 进程仍可继续使用。访问私有或回环地址、上传本地文件、提交型按键、高风险应用启动、提交、支付、删除、发送及同类原生操作需要一次性授权。缺少、取消、不可用或被拒绝的授权都会关闭式失败。密码字段、UAC、安全桌面、管理员权限应用、纯像素控件、验证码和仅 Canvas 网站仍不受支持。

## Alternatives considered

- **捆绑 Chrome for Testing。** 实测解压后运行环境为 415.4 MiB，而且[官方 Chrome for Testing 文档](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing)将其限定为消费可信内容的自动化。随包提供会增加第二套浏览器更新和安全责任。产品改用 Windows 支持且自动更新的 Edge。
- **允许模型提供选择器、JavaScript、CDP、坐标或 PowerShell。** 这些输入既脆弱，也会形成任意执行通道。有界语义观察和固定动作使执行面可审查。
- **允许模型启动可执行文件路径或命令。** 这会重复现有命令能力，并把便捷启动操作变成任意进程启动器。提供方只解析当前 Windows“开始”应用目录产生的不透明 ID。
- **把 OCR 或截图作为主要控制路径。** 这会增加大型推理运行环境和坐标漂移，同时削弱控件身份。本地 OCR 与视觉保留为未来独立能力。
- **依赖外部 RPA 服务或浏览器扩展。** 该路径会增加安装、认证、更新和可用性依赖，不能成为开箱即用的桌面能力。
- **把工具加入每个预设文件。** 用户创建的预设仍会缺少工具，未来预设变化也可能静默移除产品能力。部署级全局注册配合动态能力提示，可让每个会话获得相同的已安装能力集合。

## Verification

浏览器包测试覆盖私有地址分类、协议拒绝、Windows 上真实 Microsoft Edge 页面、没有关联 frame 的 Service Worker 流量、语义观察、填写、受保护提交分类、跨会话与过期观察拒绝、有界标签页列表、首次及后续导航中断恢复和浏览器重启。一个子进程回归测试还会通过声明的 `tsx` ESM 源码启动器运行浏览器包，从而验证开发时转译后的 Playwright 页面回调。电脑操控包测试校验 helper 返回值、应用目录归属、有界窗口列表和高风险启动分类，并使用真实 WinForms 窗口覆盖跨会话拒绝、观察、值编辑、受保护动作分类、调用、有界等待、中断恢复和 helper 重启。Windows 实机验证通过不透明应用 ID 解析并启动记事本，并确认产生的 UI Automation 窗口。无需密钥的组装 snapshot 会固定两项 schema 和路由说明，包括关闭 runtime context 的预设；发行组合测试则固定普通会话的组合提示。产品层、Cordis 配置、workspace、类型、构建、文档和桌面数据路径门禁覆盖组装后的应用。

## Consequences

小兢会计无需另一组 API Key、浏览器驱动安装或 OCR 运行环境，即可操作普通语义网站和原生 Windows 应用，也能打开普通的“开始”注册应用而不暴露通用进程启动接口。无需可见应用即可完成的任务仍由原生工具以更快、更可靠的方式处理。浏览器状态会在普通应用重启和覆盖升级之间保存在专用 profile 中，不透明观察则保持瞬态。该结果不等同于通用电脑视觉；没有提供有效 DOM 或 UI Automation 语义的网站和应用，需要未来独立且可移除的视觉能力。
