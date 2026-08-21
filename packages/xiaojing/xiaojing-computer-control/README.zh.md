# @deepseek-ai/dsh-xiaojing-computer-control

[English](README.md) | 中文

小兢会计的 Windows 语义电脑操控插件。一个 Cordis 插件同时提供 `ctx.xiaojingComputerControl`、注册 `computer_control` 工具，并维护一个有界的换行 JSON 辅助进程；辅助进程只使用 Windows PowerShell 5.1、Windows“开始”应用目录与操作系统自带的 `System.Windows.Automation` API。

辅助进程可以搜索“开始”应用、启动选中的目录项，并返回有界的应用、可见顶层窗口与 UI Automation 控件列表。应用、窗口与目标 ID 只保存在内存中，绑定一个智能体会话，会过期，并在状态变化后替换。启动操作会消费本次应用列表并返回新的窗口列表。模型看不到 Windows 应用注册 ID 或可执行文件路径。工具不接受坐标、截图、OCR 输入、PowerShell 源码或任意 Shell 命令。

当文件、数据、编辑或命令工具无需驱动可见应用即可完成任务时，应优先使用这些原生工具。`computer_control` 只补充必须操作原生应用可见界面的任务，网站则使用 `browser_control`。可能提交内容的键盘输入、高风险应用，以及名称涉及支付、删除、安装、运行、转账、发布或发送的控件，都必须先通过 `ctx.approval` 获得一次性授权。

## 配置

配置项包括 PowerShell 可执行文件、辅助进程与请求超时、应用、窗口和控件结果上限、启动等待时间、树深度、观察有效期、等待轮询间隔和协议行上限。产品配置使用 Windows 10 与 Windows 11 自带的 Windows PowerShell。

## 模型体验

### `computer_control` schema

#### 模型看到的内容

模型会看到 [`computer_control` schema](../../../docs/tool-catalog.md#deepseek-aidsh-xiaojing-computer-control)，其中要求仅在任务必须操作原生应用可见界面时使用本工具。应用尚未打开时，先通过 `list_apps` 获取不透明 `appId`，再用 `launch_app` 启动；应用已打开时，从 `list_windows` 开始，选择返回的 `windowId` 后调用 `observe`。模型只能执行目标 `actions` 中列出的操作，每次操作都会返回新的观察。

#### Token 影响

每次请求都包含一个稳定的工具定义。结果只会在当前会话后缀中增加有界的应用、窗口或 UI Automation 目标列表。

#### KV Cache 影响

schema 在插件生命周期内保持稳定，不会导致不同轮次之间缓存的请求前缀失效。Windows 观察以普通工具结果的形式出现在该前缀之后。

## 已知限制与后续工作

- 只能启动已注册到 Windows“开始”应用目录的条目。后台应用或仅驻留托盘的应用可能成功启动，但不会提供可操控窗口。
- 提供方不能跨越 Windows 权限级别或桌面边界：普通进程无法控制 UAC、登录界面、安全桌面、服务和管理员权限应用。
- 它不能控制纯像素控件、Canvas 应用、远程桌面或 UI Automation 语义不完整的程序。
- 本地 OCR 与坐标兜底明确不在当前版本中。
