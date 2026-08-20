# @deepseek-ai/dsh-usage-accounting

[English](README.md) | 中文

在本机按当前 API Key 统计 DeepSeek token 与请求时点费用。插件通过 rc.5 的 `llm/stream` waterfall 观察提供方返回的 `usage` 分片，不修改 agent loop 或模型请求。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dshHome` | 解析得到的 Harness home | 在其 `usage-accounting/` 子目录保存用量账本。 |

内置官方价格表是唯一价格来源。插件不会发起价格网络请求，也不会读取价格缓存；价格更新需要随客户端版本发布。不兼容的用量账本会阻止启动，因为静默丢弃或部分重写用量会破坏持久化约定。

## 观察与结算

rc.5 兼容适配文件是唯一导入 `llm/stream`、`TokenUsage`、DeepSeek 设置和凭据解析的位置。每个实际 `deepseek-official` 流的首个 `usage` 分片只记录一次。普通对话、压缩、会话标题和重试请求会在提供方返回用量后分别结算。

每条记录包含缓存命中输入、缓存未命中输入、输出、缓存写入 token、模型、请求发生的北京时间日期、请求用途、价格版本，以及固定的总费用和分类费用。API Key 只保留 SHA-256 指纹。切换 Key 后旧记录仍保留，但 `snapshot()` 只返回当前所配 Key 的本月数据。

## 价格

内置价格表遵循 V4 Flash 与 V4 Pro 的 [DeepSeek 公开价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。高峰为北京时间 09:00–12:00、14:00–18:00，两个区间均为左闭右开；其余时间为空闲时段。

| 模型与时段 | 缓存命中输入 / 百万 | 缓存未命中输入 / 百万 | 输出 / 百万 |
|---|---:|---:|---:|
| V4 Flash 高峰 | ¥0.10 | ¥3.00 | ¥9.00 |
| V4 Flash 空闲 | ¥0.05 | ¥1.50 | ¥4.50 |
| V4 Pro 高峰 | ¥0.30 | ¥9.00 | ¥27.00 |
| V4 Pro 空闲 | ¥0.15 | ¥4.50 | ¥13.50 |

费用使用整数纳元逐 token 计算。每个请求保存其开始时生效的价格版本和准确费用，因此后续调价不会重算历史。未知模型、缓存写入 token 和非官方地址仍计入 token 总数，但标记为未计价。

## 持久化与 Remote API

`$DSH_HOME/usage-accounting/usage-v1.json` 是 schema-v1 原子写入账本。`usageAccounting.snapshot()` 返回当前 Key 按北京时间计算的本月逐日数据与合计；只有记录提交成功后才发送 `usage-accounting/updated`。增加分类费用之前写入的 schema-v1 记录仍可读取并保留原结算总额。只有内置价格表仍包含同版本价格，并且依据已存模型、请求时间和 token 重算后与原总额完全一致时，才恢复分类明细；否则保持不可用。

## Model Experience

None, as this observer reads provider usage after a request and registers no model-facing content.

#### KV Cache effect

No direct effect; the plugin does not change request prefixes, messages, tools, or provider routing.

## Known Limitations and Deferred Work

- 显示金额是依据提供方返回用量和公开价格在本机计算的结果，不是 DeepSeek 开放平台的正式账单或账户余额。
- 统计从插件首次创建账本时开始，不会根据旧会话反向重建。
- 只公开当前 Key 的本月数据；月份切换、导出、图表、云同步和多提供方统计均有意不提供。
