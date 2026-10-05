---
description: "Xiaojing settings for controlling existing Chrome and Edge tabs"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-xiaojing-browser-control

[English](README.md) | 中文

## 概述

小兢会计本机产品的 Chrome 与 Edge 设置。只有 `DSH_CLIENT_BUILD_PROFILE=xiaojing` 且 Client 连接属于 loopback 时，插件才会贡献一个可移除的 `settings.section`；Node 入口没有运行时行为。

## 目录

- [功能说明](#capabilities)
- [开发备注](#dev-note)

<a id="capabilities"></a>
## 功能说明

每个浏览器行显示安装情况、用户许可和 Host 观测到的连接状态。检测失败显示为暂时无法识别，保留该行错误，不妨碍另一种浏览器使用。开关允许控制已经打开的标签页，启用并不建立连接。即使检测失败或浏览器已卸载，用户仍能撤销已有许可。撤销不会关闭用户的浏览器；小兢专用浏览器仍可使用。

管理按钮显示对应浏览器固定的远程调试地址、复制控件，以及 Windows 的“打开设置页”按钮。点击打开后，Host 新建普通浏览器窗口并验证其实际 inspect 页面，确认后才显示成功。用户仍须允许远程调试，并在任务连接时批准请求。失败时保留手动设置和明确的重试按钮；打开过程中禁用重复操作，关闭说明后的旧结果不能更新另一浏览器的说明。其他系统保留复制说明。确认开启后，如果 Host 返回尚未完成设置，也会显示说明；关闭不改变许可，轮询不会反复弹出。仅显示管理、开启许可或轮询都不会启动浏览器。这条路线无需扩展、配对码、端口或 Token 输入框。

`BrowserControlController` 通过经过认证的 Connection RPC 调用 `/xiaojing-native-browser-control` 的 `status`、`set-enabled` 和固定品牌的 `open-settings`。状态要求 `canOpenSettings` 及每种浏览器各一行；解析器移除 Client 安全状态之外的字段。匹配的 Host 和 Client 应一起发布。安装路径和凭据不进入视图。刷新保留已有内容，失败保留已确认的许可，过期读取不能覆盖更新的用户请求，卸载时清理轮询。

## 验证

聚焦 Client 测试及包内说明快照覆盖两种浏览器的控件、固定地址、实际打开确认、打开失败与明确重试、不支持的系统、打开时关闭说明、复制失败、设置与连接状态、未安装、关闭开关、过期响应、无效 JSON、轮询清理和 profile/loopback 注册限制。Host 进程身份及实际设置导航由 `@deepseek-ai/dsh-xiaojing-browser-control` 负责验证。UI 复用共享控件和语义主题 token。

## 模型体验

无；本 Client 包不贡献模型可见输入或工具。

#### KV Cache 影响

无；Host 原生浏览器插件负责 `browser_connect` 及其原生工具结果。

## 已知限制与延后工作

- 浏览器设置和连接授权需要用户操作。本页面不代为授权、不读取标签页，也不发起浏览器连接，连接由所属任务负责。移除页面不会更改 Host 已持久化的许可。

<a id="dev-note"></a>
### 开发备注

无。

不发布运行时不变量伴随插件：所属注册表和 Host 服务直接维护这些关系，本包没有需要交叉核对的独立观测。
