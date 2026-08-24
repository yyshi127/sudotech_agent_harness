# Agent Note: 小兢会计仅使用 Edge 的浏览器自动化

Status: implemented

[English](2026-08-24-xiaojing-edge-only-browser-automation.md) | 中文

## Problem

小兢会计浏览器操控插件原来同时提供 Microsoft Edge 和 Google Chrome，但两条路径都通过独立 Playwright 持久 profile 启动浏览器，并不接管用户已经运行的日常浏览器。Chrome 选项因此无法提供用户预期的个人窗口接管行为，却额外引入第二套运行时、持久设置、本次任务 schema 字段、策略检查、两个 profile 目录和跨浏览器生命周期测试。继续保留该界面会暗示当前实现无法稳定交付的能力。

## Decision

小兢会计浏览器自动化只支持 Microsoft Edge。`@deepseek-ai/dsh-xiaojing-browser-control` 在 `$DSH_HOME/browser-control/profile` 中只维护一个延迟启动的 Playwright 持久上下文；`browser_control` 不再包含浏览器选择输入，结果也不再包含浏览器判别字段。`open` 仍会在该 Edge 上下文中依次复用目标完全相同的页面、同源页面或空白页面，只有不存在合适页面时才创建新标签页。既有的 DOM 语义观察、不透明目标所有权、私有目标策略、高影响操作授权、取消、恢复和插件移除行为保持不变。

Host 不再拥有 `xiaojing-browser-control` 设置命名空间。可移除的 Client 插件继续保留独立“浏览器控制”分区，但改为静态能力页面：显示 Microsoft Edge 已启用，并说明可见启动、最小化后的 DOM 操作和专用登录 profile。产品提示词直接标明 Edge，不再要求模型选择或覆盖浏览器。

Web 组合不再声明第二个 profile 目录或浏览器默认值。移除 Chrome 实现不会删除旧版本创建的 `$DSH_HOME/browser-control/chrome-profile` 或其他同级目录；新运行时只是不再读取这些路径。这样可以保留回退条件，并确保普通覆盖升级不破坏用户数据。

源码启动时，如果已停用的共享目录 `$DSH_HOME/profiles/node_modules` 仍包含指向旧工程的链接，也必须以当前安装为准。Node 返回解析结果前会把链接转换为真实路径，因此 profile 后备解析现在会同时检查共享旧目录的逻辑路径和链接目标的真实目录，再从当前安装重试解析；旧目录本身保持不变。

本决策只取代[小兢语义浏览器与 Windows 自动化](2026-08-21-xiaojing-semantic-automation.zh.md)中的多浏览器部分。原说明继续负责插件隔离、语义目标模型、风险授权、生命周期和 Windows UI Automation 决策。

## Alternatives considered

- **通过功能开关隐藏 Chrome。** 否决，因为不可达代码、配置、依赖和测试仍会保留已移除产品能力的维护与升级成本。
- **保留只有 Edge 一个值的浏览器设置。** 否决，因为只有一个值的可写偏好并不是偏好，而且会留下无意义的 Host 持久化与传输代码。
- **接管用户正在运行的 Chrome 或增加扩展。** 作为未来独立能力延期，因为它需要另一套连接、授权、安装和安全设计，不能成为保留现有 Playwright Chrome 路径的理由。
- **删除整个浏览器控制设置分区。** 否决，因为独立页面仍能让用户清楚了解已安装的 Edge 行为，而且它继续可以从 Harness UI 中独立移除。

## Verification

聚焦 Host 测试通过单一运行时驱动真实 Playwright 兼容浏览器进程，并覆盖导航、现有标签页复用、语义观察、过期节点拒绝、受保护动作、会话隔离、有界标签页、取消、重启和卸载。工具 schema 与结果类型不包含浏览器选择或浏览器判别字段。聚焦 Client 测试验证回环地址小兢限制、静态 Microsoft Edge 展示、不存在浏览器选择控件，以及 slot 卸载。组合测试固定仅 Edge 的产品提示词。profile 后备解析测试覆盖链接被转换为真实路径的旧共享包，并证明客户端元数据来自当前安装。生成的配置、API 和工具目录只能包含 Edge 运行配置和仅 Edge 的工具 schema。产品层、类型、构建、文档和组装预览检查继续作为发布门禁。

## Consequences

产品只需要解释、运行和测试一套浏览器自动化行为。用户不会再看到暗示可以接管个人窗口的 Chrome 选项。Edge 登录状态继续保存在既有受保护 profile 中；浏览器操控仍是独立的 Cordis Host 与 Client 插件，因此小兢会计其他能力不受影响。旧版本创建的 Chrome profile 数据会继续占用磁盘，直到用户主动删除，但应用不会读取或修改它。
