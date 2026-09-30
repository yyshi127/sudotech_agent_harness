---
description: "Xiaojing isolated visualization cards with the original dsh-visualize palette."
kind: "package-bundle"
---

# @deepseek-ai/dsh-xiaojing-visualize

[English](README.md) | 中文

## 概述

本包是小兢会计对 `Nagi-ovo/dsh-visualize` 的可移除适配。模型可以在 Web 对话中把交互式模拟器、图表、对比内容和界面 mockup 渲染成卡片。


## 目录

- [功能说明](#capabilities)
- [开发备注](#dev-note)

<a id="capabilities"></a>
## 组合方式

渲染状态、错误后备文案及实时预览标题使用带类型的中英文字典。已保存的可视化标题及工具结果文本保留写入方记录的值。

Host 半侧注册 `visualize` 工具及其内置创作 skill，Client 半侧注册完成态工具视图和流式预览。小兢会计 Web 组合只在 `DSH_CLIENT_BUILD_PROFILE=xiaojing` 时加载这两个半侧，官方 Harness profile 保持不变。

卡片固定使用原插件的浅色鲸鱼蓝配色，不继承 Harness 主题、小兢会计浅绿色产品主题或操作系统外观。禁用或删除 Web 组合中的唯一 `xiaojing-visualize` 配置行并重新构建，即可移除该功能。从源码中彻底删除时，还需移除 `web-app` 解析清单中的包依赖；其他小兢功能和持久数据 owner 都不依赖这两处声明。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `maxFragmentBytes` | `1000000` | 单个模型生成 HTML fragment 的 UTF-8 最大字节数。 |

## 工作方式

模型在首次生成卡片前加载内置 `visualize` skill，再使用内联 HTML fragment 调用 `visualize`。`create` 创建新的 `inline` 或 `wide` 卡片；`update` 对已保存的工作区副本执行一次精确文字替换，并在不重新发送完整 fragment 的情况下刷新原卡片。

每个已完成工具结果会把经过验证的 fragment、标题、模式和工作区路径持久化到会话元数据，因此会话重放不依赖原始源码文件仍然存在。工作区内还会保存一份副本，供导出或后续修正。

每轮回答结束后，成功生成的卡片还会显示在回答下方，不随工具执行过程折叠。刷新页面或重新打开会话时，会从已保存的结果恢复卡片；失败的调用不会显示为已完成卡片。

## 安全

每张卡片都运行在带有 `sandbox="allow-scripts"` 的 iframe 中，拥有不透明来源且无法访问 Host 文档。frame 内容安全策略禁止表单、嵌套 frame、object、base URL 变更和网络连接，只允许内联脚本与样式，以及从内置 skill 记录的固定 CDN 白名单加载静态资源。fragment 大小上限同时限制执行输入和会话日志增长。

模型生成的卡片仍是不可信的活动内容，只是被限制在该沙箱内。修改沙箱属性、内容安全策略、CDN 白名单或 fragment 上限时，必须进行聚焦安全评审和测试。

## 来源与许可

本包适配自 [Nagi-ovo/dsh-visualize](https://github.com/Nagi-ovo/dsh-visualize)，已审阅提交为 `b0bed38f40ffbb0d72bb88393d865307944c1bce`。上游 BSD-3-Clause 许可保留在 [`LICENSE`](LICENSE) 中，[`NOTICE.md`](NOTICE.md) 记录小兢会计专属改动。

## Model Experience

### `visualize` 工具与内置 skill

#### 模型看到的内容

插件被组合时，模型会看到稳定的 `visualize` 工具 schema 和一个内置 skill 目录项。加载 skill 后，模型会获得 fragment 格式、设计 token、允许资源、交互检查和回复要求。工具成功后只返回简短确认及工作区路径，不会重复回显完整 fragment。

#### Token 影响

工具 schema 和 skill 目录项属于普通模型请求。加载 skill 会把创作说明加入一次会话上下文。每个新建 fragment 会出现在工具调用参数和持久元数据中；结果文字保持简短，避免重复消耗。

#### KV Cache 影响

插件配置不变时，工具 schema 和 skill 目录项保持稳定前缀。加载 skill 或生成卡片会增加请求专属的后缀内容；更新卡片只会改变后续会话后缀。

## 已知限制与暂缓工作

- 交互卡片只在 Web Client 中渲染，TUI 和 headless Client 显示通用工具结果。
- 卡片固定使用浅色配色，不跟随深色模式变化。
- 卡片内部控件暂时不能向主对话发送后续消息。
- 虽然卡片内部的运行时网络连接 API 被禁止，但加载静态 CDN 资源仍需要网络。

<a id="dev-note"></a>
### 开发备注

无。

不发布运行时不变量伴随插件：注册表和所属服务直接维护这些关系，本包没有需要交叉核对的独立观测。
