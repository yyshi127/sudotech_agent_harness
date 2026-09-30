# Agent Note: 小兢会计 rc.2 Files 链路与独立可视化

Status: implemented

[English](2026-08-24-xiaojing-rc2-files-and-visualization-upgrade.md) | 中文

## Problem

小兢会计 0.2.0 源码需要从官方 `dsh-v0.1.1-rc.1` 升级到 `dsh-v0.1.1-rc.2`，同时不能把产品品牌、用量统计、统一图片与文档上传、微信回传、浏览器操控、Windows 操控、强制删除审批、安装器身份或 0.1.9 用户数据迁入官方核心 owner。rc.2 把面向提供方的图片路径统一为一条规范请求链路，可以通过 DeepSeek Files API 解析已保留图片，并在失败时回退到已保留的内联数据。如果小兢集成继续保留 rc.1 专属图片传输，就会形成两套序列化路径，使桌面、Goal、Plan 和微信图片出现不同行为。

产品还需要 `Nagi-ovo/dsh-visualize` 插件，但卡片必须保留原生浅色鲸鱼蓝外观，不能继承 Harness 主题或小兢会计浅绿色主题。直接把上游包安装到可变用户 profile 会削弱产品组合保证，也可能重新引入 profile 本地 Harness 或 Cordis 副本。因此，该功能需要成为经过审阅、可移除并保留第三方归属的产品集成。

## Decision

### 保留记录的上游合并

升级分支从小兢产品集成基准 `xiaojing-history-20260930-4` 开始，正式合并官方 tag `dsh-v0.1.1-rc.2` 对应提交 `dsh-v0.1.1-rc.2`。合并提交 `xiaojing-history-20260930-5` 保留双方历史。[`product.json`](../../../../packages/client/xiaojing-product/product.json) 记录官方 release、commit 和产品集成基准。包版本与 rc.2 对齐，桌面产品版本继续保持 `0.2.0`。

### 规范化原生图片归属

官方 rc.2 继续独占原生图片规范化、持久附件引用、提供方请求变体、DeepSeek Files 解析和内联回退。小兢文件选择器继续为 PNG、JPEG、WebP 和 GIF 调用与提供方无关的会话作用域 `conversation.addImages()` 入口，文档和不支持的图片格式仍走 `dsh-file-uploads`。粘贴、拖放、文件选择器、普通输入、Goal、Plan 和微信都会在提供方运行前汇入同一种原生图片表示。产品集成不会自行构造 `image_url`、`file_id` 或内联提供方 payload。

计费观察器仍只通过 rc.2 兼容适配器接入 `llm/stream`，并对提供方返回的 usage 结算一次。图片用量不在本机估算。既有价格版本、整数纳元历史、API Key 指纹、Remote 字段和 Client 展示保持不变。

### 产品展示与主题元数据

`xiaojing` Client profile、五个中性品牌与初次使用 slot、启动元数据、默认人格、用量界面、微信界面、浏览器设置和桌面身份继续由产品层拥有。官方 UI owner 保留中性 fallback。产品插件在挂载自身 dataset 后同步现有 `theme-color` 元数据，使初次浏览器外观与已渲染的小兢背景一致；插件卸载时恢复通用值。官方 rc.2 权限标签继续作为真源，不再由产品补丁覆盖。

### 独立可视化插件

`@deepseek-ai/dsh-xiaojing-visualize` 适配自已审阅至提交 `b0bed38f40ffbb0d72bb88393d865307944c1bce` 的 `Nagi-ovo/dsh-visualize`。它保留上游 BSD-3-Clause 许可，并通过 `NOTICE.md` 记录适配。Host 半侧注册模型工具和内置 skill，Client 半侧只在 Xiaojing 构建 profile 中注册已完成卡片和流式预览。每张卡片继续运行在具有上游严格内容安全策略的不透明来源 `sandbox="allow-scripts"` iframe 中。

Client 注入固定浅色鲸鱼蓝配色，从不读取 Harness、小兢会计或操作系统主题状态。一个 Web 组合行负责启用该功能，`web-app` 解析清单负责声明对应包依赖。产品层检查会同时验证这两处声明，防止源码构建成功却静默漏装运行时模块。删除或禁用配置行并重新构建，即可移除工具、skill、预览和卡片 renderer，而不改变产品品牌、计费、上传、频道、自动化或持久数据 owner；从源码中彻底删除时还需移除解析依赖。

### 数据与发布兼容

桌面 package name、App ID、NSIS GUID、可执行文件名、安装目录、快捷方式身份和 `%APPDATA%\@sudotech\xiaojing-accounting-desktop` 数据根目录保持不变。rc.2 读取既有会话、凭据、人格、profile、上传、附件、计费、浏览器、微信和 Electron 状态，不会重写兼容文件。0.1.9 兼容 fixture 与固定安装器身份门禁继续阻断发布；源码兼容不能代替后续真实 Windows 覆盖安装测试。

## Verification

聚焦验证覆盖官方 rc.2 图片规范化、Files 请求变体与回退、原生图片重放、普通／Goal／Plan 模式混合选择器路由、小兢 profile 组装、初始主题元数据、计费、微信图片传递、浏览器与 Windows 操控、删除审批、可视化校验、沙箱策略、流式预览、固定配色和插件移除。桌面身份与合成 0.1.9 用户数据门禁、仓库 typecheck、build、lint、hygiene、文档同步、无 Key snapshot、组装后 Web 回放及 3090 产品预览都必须在打包前通过。用户确认预览，且安装器随后通过真实全新安装和 0.1.9 覆盖测试之前，仍禁止打包。

## Alternatives considered

- **把 rc.2 源码复制覆盖产品树。** 这样会丢失可追溯合并历史，也会混淆哪些冲突属于上游或小兢。三方合并可以保留官方历史，并把适配限制在中性 slot、兼容文件和产品组合中。
- **为小兢上传和微信保留 rc.1 提供方图片序列化。** 这样会分叉请求路径并绕过 rc.2 Files 解析与回退。把原生图片交给官方规范化后，所有入口拥有相同持久化与提供方行为。
- **把可视化包安装到每个用户的可变 profile。** 这样需要安装后设置，并让产品组合暴露于依赖遮蔽。只由 Xiaojing 组合启用的已审阅工作区包可复现，也不需要修改用户 profile 即可移除。
- **让可视化卡片跟随小兢会计主题。** 这样会改变用户要求保留的插件外观，并让它与产品 CSS 耦合。固定本地配色可以保留插件视觉身份，并把后续上游主题冲突限制在一个包内。
- **把可视化行为写入产品品牌插件。** 这样会混合可复用活动内容与品牌展示，导致移除不完整。独立 Cordis 包负责其工具、skill、界面、安全策略和测试。

## Consequences

所有受支持图片入口现在依赖 rc.2 规范提供方路径，包括 DeepSeek Files 解析和已保留内联数据回退，同时既有唯一上传按钮与文档流程保持不变。可视化功能可以在 Xiaojing 构建中稳定复现，具有独立外观、明确归属，并可通过一个组合变更移除。产品主题元数据会匹配初次渲染背景，而且品牌值没有进入官方 UI 代码。

可视化组合行启用时，工具会增加稳定的模型 schema 和 skill 目录项；模型生成 HTML 仍是活动内容，但被限制在沙箱中。静态 CDN 资源仍需要网络。rc.2 源码与 fixture 检查可以证明应用级兼容，但在用户确认预览后构建 Windows 安装器，并实际证明从 0.1.9 覆盖升级不会发生数据或身份漂移之前，仍禁止发布 0.2.0。
