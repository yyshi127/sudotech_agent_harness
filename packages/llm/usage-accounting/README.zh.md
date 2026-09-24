---
description: "在本机统计 DeepSeek token 与请求时点费用，并保守恢复符合条件的默认 Messages 用量记录价格。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-accounting

[English](README.md) | 中文

## 概述

在本机按当前 API Key 统计 DeepSeek token 与请求时点费用。插件通过 rc.2 的 `llm/stream` waterfall 观察提供方返回的 `usage` 分片，不修改 agent loop 或模型请求。

## 目录

- [配置](#configuration)
- [观察与结算](#observation-and-settlement)
- [价格](#pricing)
- [持久化与 Remote API](#persistence-and-remote-api)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dshHome` | 解析得到的 Harness home | 在其 `usage-accounting/` 子目录保存用量账本。 |

内置官方价格表是唯一价格来源。插件不会发起价格网络请求，也不会读取价格缓存；价格更新需要随客户端版本发布。不兼容的用量账本会阻止启动，因为静默丢弃或部分重写用量会破坏持久化约定。

<a id="observation-and-settlement"></a>
## 观察与结算

rc.2 兼容适配文件是唯一导入 `llm/stream`、`TokenUsage`、DeepSeek 设置和凭据解析的位置。每个实际 `deepseek-official` 流的首个 `usage` 分片只记录一次。普通对话、压缩、会话标题和重试请求会在提供方返回用量后分别结算。

两个 DeepSeek 官方根地址都会计价：Chat Completions 根地址 `https://api.deepseek.com` 和 Messages 根地址 `https://api.deepseek.com/anthropic`。其他路径和自定义来源仍标记为未计价。

每条记录包含缓存命中输入、缓存未命中输入、输出、缓存写入 token、模型、请求发生的北京时间日期、请求用途、价格版本，以及固定的总费用和分类费用。API Key 只保留 SHA-256 指纹。切换 Key 后旧记录仍保留，但 `snapshot()` 只返回当前所配 Key 的本月数据。

<a id="pricing"></a>
## 价格

内置价格表遵循 2026 年 9 月 14 日生效的 Flash 与 V4 Pro [DeepSeek 公开价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。`deepseek-flash` 以及仍可调用的旧模型名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 均使用 Flash 价格。高峰为北京时间 09:00–12:00、14:00–18:00，两个区间均为左闭右开；其余时间为空闲时段。

| 模型与时段 | 缓存命中输入 / 百万 | 缓存未命中输入 / 百万 | 输出 / 百万 |
|---|---:|---:|---:|
| Flash 高峰 | ¥0.04 | ¥2.00 | ¥8.00 |
| Flash 空闲 | ¥0.02 | ¥1.00 | ¥4.00 |
| V4 Pro 高峰 | ¥0.30 | ¥9.00 | ¥27.00 |
| V4 Pro 空闲 | ¥0.15 | ¥4.50 | ¥13.50 |

费用使用整数纳元逐 token 计算。每个请求保存其开始时生效的价格版本和准确费用，因此后续调价不会重算历史。早期 schema-v1 记录未保存分类费用时，系统只使用保留的旧内置价格表恢复分类明细，绝不使用旧表结算新请求。视觉图片消耗只采用提供方返回的 usage，插件不会自行估算图片 token。未知模型、缓存写入 token 和非官方地址仍计入 token 总数，但标记为未计价。

<a id="persistence-and-remote-api"></a>
## 持久化与 Remote API

`$DSH_HOME/usage-accounting/usage-v1.json` 是 schema-v1 原子写入账本。`usageAccounting.snapshot()` 返回当前 Key 按北京时间计算的本月逐日数据与合计；只有记录提交成功后才发送 `usage-accounting/updated`。增加分类费用之前写入的 schema-v1 记录仍可读取并保留原结算总额。只有内置价格表仍包含同版本价格，并且依据已存模型、请求时间和 token 重算后与原总额完全一致时，才恢复分类明细；否则保持不可用。

当前连接仍使用隐式官方 Messages 地址时，`snapshot()` 会恢复从内置价格生效日开始的受影响 `deepseek-flash` 记录的显示价格，但不会改写账本。只有价格版本和全部分类费用均为 null、总费用为零且所有 token 均被存为未计价时，记录才符合恢复条件。显式地址、其他模型、更早日期或其他记录状态不会恢复价格。

<a id="model-experience"></a>
## Model Experience

None, as this observer reads provider usage after a request and registers no model-facing content.

#### KV Cache effect

No direct effect; the plugin does not change request prefixes, messages, tools, or provider routing.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- 显示金额是依据提供方返回用量和公开价格在本机计算的结果，不是 DeepSeek 开放平台的正式账单或账户余额。
- 统计从插件首次创建账本时开始，不会根据旧会话反向重建。
- 只公开当前 Key 的本月数据；月份切换、导出、图表、云同步和多提供方统计均有意不提供。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

无。

</details>
