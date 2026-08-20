# Agent Note: 小兢会计产品隔离、本机计费与桌面升级

Status: implemented

[English](2026-08-20-xiaojing-product-accounting-and-desktop-upgrades.md) | 中文

## Problem

小兢会计在官方 DeepSeek Harness 基线之上调整产品身份、初次使用说明、桌面封装和内部插件。直接在官方 UI 包中写品牌代码，会让上游合并冲突与产品改版无法区分；动态安装的插件还可能遮蔽随包 profile。桌面版本也必须保持同一个安装器身份和用户数据根目录，否则普通源码升级可能产生第二套安装，或让会话与凭据失去关联。

本机费用展示还有独立的准确性问题。DeepSeek 适配器会在每次请求后返回互不重叠的缓存命中输入、缓存未命中输入和输出用量，而公开 V4 价格会随模型和北京时间峰谷变化。按消息汇总或估算 token 都无法复现实际计费请求流。

## Decision

### 产品层

官方 UI owner 只公开 `sidebar.brand`、`conversation.hero.brand` 和 `onboarding.content`。[`@deepseek-ai/dsh-client-xiaojing-product`](../../../../packages/client/xiaojing-product/README.md) 填充这些 slot、应用配色，并且只填充空的部署人格，不覆盖已经选择的 agent 人格。插件激活前，静态 Web 应用中的通用元数据选择已登记的产品 Logo，shell 则保留中性默认内容。`product.json` 固定上游 rc.5 tag 与 commit，并登记产品资源和桌面清单。`scripts/verify-xiaojing-product-layer.mjs` 拒绝官方 UI 源码目录中出现小兢会计标记，同时核对 slot 和组合引用。

启动后配置 API Key、profile 运行时遮蔽防护和附件上传输入区修复仍是独立集成补丁，并登记在 [`apps/desktop/integration-patches.json`](../../../../apps/desktop/integration-patches.json) 中。它们的所属路径与品牌隔离分开执行机器检查。

### 用量结算与计价

[`@deepseek-ai/dsh-usage-accounting`](../../../../packages/llm/usage-accounting/README.md) 通过 `llm/stream` 观察 `deepseek-official`。一个 rc.5 兼容文件集中拥有 stream、usage、设置和凭据 API 的全部导入。每个实际流的首个提供方 `usage` 分片只结算一次，因此对话、压缩、标题和重试调用保持为独立计费请求，同时无需修改 agent loop。

记录只保留 API Key 的 SHA-256 指纹，并且只公开当前 Key 按北京时间计算的本月数据。每次结算保存价格版本，以及整数纳元表示的总费用和分类费用。高峰为北京时间 09:00–12:00、14:00–18:00；内置 Flash 与 Pro 高峰价格及减半的空闲价格与公开价格表一致。未知模型、缓存写入 token 和自定义地址仍显示为未计价 token。内置价格表是唯一运行时价格来源，因此价格更新需要随客户端版本发布，启动时不会发起价格网络请求。历史记录永不重新计价。缺少分类费用的旧 schema-v1 记录只有在同版本内置价格重算结果与已存总额及未计价数量完全一致时才恢复明细，否则保持不可用。

### 桌面身份与数据

[`apps/desktop/identity.json`](../../../../apps/desktop/identity.json) 固定 package name、AppUserModelId、NSIS GUID、目录名、可执行文件、产品名、当前用户安装范围和快捷方式。Electron 在获取单实例锁之前固定 `%APPDATA%\@sudotech\xiaojing-accounting-desktop`。随包 Host 使用其 `harness` 子目录作为 `DSH_HOME`，并将“文档”工作区保留在安装目录之外。

NSIS 更新路径沿用注册的 `InstallLocation` 并跳过路径选择。[`user-data-contract.json`](../../../../apps/desktop/user-data-contract.json) 枚举受保护数据；其检查程序对合成 0.1.7 fixture 执行应用文件替换，并要求每个受保护字节保持不变。因此，未来若持久格式不兼容，必须先增加原子迁移并更新上一正式版 fixture，才能发布。

### 上游集成

上游基线显式记录，而不是从当前文件内容推测。升级分支合并经核对的官方 tag 或 commit，并将适配限制在通用 slot、rc 兼容适配器、独立集成补丁和必要数据迁移。产品资源、计费规则和桌面身份不会只因官方包变化而移动。

## Verification

Host 测试固定缓存 bucket、准确分类结算、严格旧记录恢复、单次结算、Key 隔离、损坏账本拒绝、不可变价格版本和全部峰谷边界。Client 测试固定可点击明细浮层、侧边栏摘要、本月统计位置、周一开头日历、未统计与未计价状态，以及旧响应抑制。产品测试固定 slot 文案、默认人格优先级和准确来源说明。任何桌面分发命令之前都会运行身份、产品层和合成 0.1.7 数据检查；整装浏览器回放验证实际加载的组合。

## Alternatives considered

- **继续直接修改官方组件中的品牌。** 这样首次 diff 最小，但每次上游 UI 冲突都会混入产品文案、资源和配色。通用 slot 加单一产品插件让官方 fallback 可执行，同时使产品行为可卸载。
- **读取 DeepSeek 开放平台账户账单。** 本应用用于推理的 API Key 没有可用的官方按 Key 计费 Remote。本机依据提供方 usage 结算能够立即更新且可审计，界面同时明确不将其展示为正式账单或余额。
- **在 agent loop 中计数。** 这会把计费绑定到一种 loop 实现，并漏掉辅助直接 LLM 调用。观察 `llm/stream` 可以统计实际提供方请求，并把 rc 变化集中在一个适配文件。
- **每次桌面更新都要求先卸载。** 卸载重装会增加自定义路径操作，并提高删除或遗失用户数据的风险。稳定 NSIS 身份和不可变用户数据根目录支持普通覆盖替换。

## Consequences

官方源码升级在通用 owner 或 rc API 变化时仍需审查，但无需重建产品逻辑。费用账本按每个观察到的请求增加一条不可变记录，并且有意不提供历史重建、云同步、余额、图表或多提供方抽象。仅使用内置价格可消除启动联网与价格缓存的故障路径，但调价需要发布客户端版本。桌面发布必须完成上一版本覆盖升级测试；没有显式迁移决策时，不能改变兼容标识。
