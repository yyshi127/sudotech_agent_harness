# Agent Note: 小兢会计 rc.8 上游集成

Status: implemented

[English](2026-08-20-xiaojing-rc8-upgrade.md) | 中文

## Problem

小兢会计 0.1.9 集成在 DeepSeek Harness rc.5 之上，并包含产品插件、本机用量统计、修补后的文件上传插件、桌面兼容标识，以及升级后必须保留的用户数据。官方 rc.8 替换了大量 Web Client 组装和交互代码。把产品文件重新覆盖到一份干净 rc.8 源码上会丢失上游合并关系，也难以区分遗漏的产品行为和有意采用的 rc.8 变化；继续保留 rc.5 UI 组装则无法采用新布局和 Client 构建模型。

已安装 Web profile 还包含 ModLens。0.2.0 必须移除由安装程序提供的默认项，同时不能重写用户调整顺序或增加插件后的 profile；在允许构建安装包之前，还必须证明 rc.8 能读取旧会话、凭据、预设、附件、设置、storage 和用量记录。

## Decision

### 上游合并

升级分支从小兢稳定提交 `8d7ded5a542a8fe99394e27b27e69cd3472838a3` 开始，合并官方 tag `dsh-v0.1.0-rc.8` 对应提交 `141eb6fef83422698aef7a981029e843e8161534`。一个 detached 的纯 rc.8 工作树作为冲突解决对照。生成文件冲突由 rc.8 的生成命令或真源解决，不手工拼接生成结果。最终 merge commit 保留双方历史，[`product.json`](../../../../packages/client/xiaojing-product/product.json) 记录准确的上游和产品集成基准。

rc.8 Web renderer、shell、设置界面和 Client 构建环境是当前真源。已经被替代的 rc.5 UI 组装和自定义可写 API Key 界面补丁被移除。Electron 仍在 Host 启动前清除继承的 `DEEPSEEK_API_KEY`，凭据创建和替换由 rc.8 原生界面负责。

### 产品构建与界面归属

`xiaojing` Client 构建 profile 同时向 Vite 和动态 Client 包构建提供公开标题、语言、配色元数据、启动 Logo 元数据和 `DSH_CLIENT_BUILD_PROFILE=xiaojing`。`official` profile 构建上游展示；未选择 profile 的普通本地构建保留 rc.8 fallback。小兢浏览器插件只在 `xiaojing` profile 编译时注册产品 renderer，因此仅安装该包不会替换官方展示。

产品使用 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`、`conversation.hero.brand.content` 和 `onboarding.content`。前三个品牌 slot 来自 rc.8；`conversation.hero.brand.content` 是为小兢标题和标签新增的唯一中性 slot。每个 owner 都保留 rc.8 fallback。产品名称、资源、配色覆盖、初次使用文案和默认人格继续位于 `xiaojing-product`；通用 UI 包只包含 slot 定义、owner 布局和 fallback 行为。Web 插件加载页读取通用构建元数据，只有不存在产品 Logo 时才显示 `HARNESS`。

### 功能插件

用量统计继续通过 `llm/stream` 观察提供方返回的真实 usage，所有 rc.8 专属 stream、token、设置、endpoint 和凭据导入集中在 `packages/llm/usage-accounting/src/compat.ts`。价格、整数纳元结算、不可变记录、API Key 指纹隔离、Remote 字段、更新事件和 Client 展示保持不变。这样可以保留 0.1.9 账本语义，而不是借源码升级重新设计计费。

`dsh-file-uploads` 保留在发行版 Web profile 中，并继续使用本地附件布局和光标补丁。ModLens、其依赖、默认 profile 条目、声明和视觉桥接行为全部移除。profile loader 只会把安装程序拥有的 0.1.9 精确 bundle 顺序 `base + web-app + ModLens + dsh-file-uploads` 原子改为 `base + web-app + dsh-file-uploads`。顺序不同、增加插件或存在其他 manifest 差异的 profile 保持不变。运行时遮蔽防护继续拒绝 profile 本地 Harness 或 Cordis 副本替换应用运行时。

### 桌面身份与持久数据

桌面源码版本变为 `0.2.0`，但 package name、AppUserModelId、NSIS GUID、安装目录、可执行文件名、产品名、安装范围、快捷方式名和 `%APPDATA%\@sudotech\xiaojing-accounting-desktop` 数据根目录保持固定。工作区约束将 `apps/desktop` 归类为私有部署应用，而不是 npm 发布成员。本源码里程碑不构建或安装 NSIS 包；首个 0.2.0 安装包仍需等待产品预览确认，以及之后真实的 0.1.9 到 0.2.0 Windows 覆盖升级测试。

升级 fixture 模拟 0.1.9 设置、不透明凭据、用户预设、安装程序默认和用户自定义 profile、带校验和的 Zstandard 会话、附件与 storage 文件、Electron 状态、“文档”工作区，以及包含当前 Key 和旧 Key 记录的用量账本。兼容检查会模拟应用替换，通过 rc.8 JSONL 持久化实现打开会话，在不输出凭据的情况下解析并替换副本中的 Key，发现用户预设，验证设置和用量分类费用，并且只允许精确默认 profile 迁移。其他所有受保护文件必须保持字节不变。开发验证还使用当前本机数据的临时副本；正式数据根目录保持只读，任何检查都不会调用 DeepSeek API。

## Verification

聚焦测试覆盖 Client 构建 profile、产品注册条件与 slot fallback、用量观察和界面、文件上传补丁、精确 profile 迁移、自定义 profile 保留、可写凭据和不可变桌面身份。用户数据检查使用上一版本 fixture 验证组装后的 rc.8 持久化、凭据、预设、profile 和用量 reader。Typert、Client API 与 slot catalog、配置 catalog、依赖元数据和双语文档都从 rc.8 真源重新生成。最终源码门禁还要求通过相关 typecheck、build、lint、hygiene、文档同步、3090 端口的组装 Host Web 预览和 Electron 开发预览，之后才能开始打包。

## Alternatives considered

- **复制一份干净 rc.8，再覆盖可见的小兢文件。** 这种方式看似减少文本冲突，但会丢失合并关系，使遗漏行为难以审计，并诱导产品代码继续依赖文件位置而不是扩展点。保留合并记录并使用纯 rc.8 对照工作树，可以记录来源并暴露每个兼容决策。
- **在 rc.8 Host 上继续使用 rc.5 renderer。** 这会减少当前视觉变化，但保留已被替代的组装代码，形成缺少支持的混合版本。当前产品采用 rc.8 布局，只保留中性 slot 和隔离的产品 renderer。
- **重写所有包含 ModLens 的 profile。** 这样可以删除更多副本，但可能静默破坏用户插件选择。只有精确的安装程序默认列表能够证明归属，因此只迁移该列表。
- **把 ModLens 继续作为可选随包依赖。** 0.2.0 没有视觉桥接需求；保留依赖会继续维护产品不使用的启动与兼容路径。用户自定义 profile 中的其他内容不属于本次迁移。

## Consequences

后续上游升级从可审计的 rc.8 合并基线开始，通常只需要修改中性 UI slot、计费兼容适配器、独立集成补丁、生成产物或显式持久数据迁移。产品现在有两个有意区分的构建结果：官方 fallback 与小兢。产品预览必须使用 `build:xiaojing`；普通构建不能作为小兢品牌验收依据。

profile 迁移有意保持窄范围，因此用户自定义 profile 中可能仍保留 ModLens，因为仅凭包名无法证明它由安装程序拥有。移除此类条目必须由用户明确选择。源码检查可以证明 reader 兼容，但不能证明 Windows 安装器行为；打包与覆盖安装仍是视觉确认后的独立发布门禁。
