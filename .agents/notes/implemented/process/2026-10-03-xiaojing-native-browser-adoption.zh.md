# Agent Note: 精确声明小兢采用原生浏览器能力

Status: implemented

[English](2026-10-03-xiaojing-native-browser-adoption.md) | 中文

## Problem

小兢选择 Harness 原生浏览器提供方控制 Edge 和 Chrome。这些提供方及其共享 runtime 仍是实验包。因此，通用的[默认产品隔离策略](2026-09-12-default-product-experimental-isolation.zh.md)会拒绝产品已经明确采用的实际实现。将依赖移动到私有应用无法解决该策略的问题，因为每个应用都是安装入口。修改发布身份则会错误表示上游 API 的稳定状态。

## Decision

[`xiaojing-native-browser-adoption`](../../../../scripts/xiaojing-native-browser-adoption.ts) 声明一个仅适用于该产品的采用点。`packages/xiaojing/xiaojing-browser-control` 必须声明名称 `@deepseek-ai/dsh-xiaojing-browser-control`。其直接 `dependencies` 只可采用以下三个实验身份：`browser-use-chrome-devtools-mcp`、`browser-use-playwright-mcp` 和 `browser-use-runtime`；每个包都必须位于 `packages/experimental/` 下，并使用对应的精确 `@deepseek-ai/dsh-experimental-` 包名。两个提供方可以直接依赖该 runtime。这一采用声明不提升或重命名任何实验 API。

运行时源码导入限定为消费者的 `src/native.ts` 导入这三个包的根入口，以及各提供方的 `src/index.ts` 导入 runtime 的 `/mcp` 入口。同一个包内部的引用不增加另一项依赖。配置入口、其他导入方、替代源码文件、包子路径、别名、peer 和可选依赖不能主张采用资格。[随安装提供的可选组合包策略](2026-09-15-shipped-optional-bundles.zh.md)保持不变。

工作区依赖检查与默认产品源码遍历共享这份声明。遍历检查所采用包的全部出向依赖、运行时源码和声明配置树。已访问包的去重检查不得将未经许可的入向依赖变为可接受依赖。[安装图检查](../../../../scripts/release/installed-product-isolation.ts)对比每个直接依赖引用与解析后 manifest 的名称及 `repository.directory`，拒绝别名和本地路径范围，并检查所采用包的整个已安装运行时依赖图。其他实验身份仍被禁止。

聚焦的源码、manifest 和安装图夹具覆盖允许的依赖图，并拒绝身份伪造、其他消费者、其他入口、别名、依赖 section 变化及传递实验依赖扩张。现有运行时与发布检查继续承担独立职责；声明采用不代表浏览器连接已经成功。

## Alternatives considered

**使用旧 Edge 实现。** 这会违背产品采用 Harness 原生浏览器控制的决定，也缺少要求的原生 Chrome 路线。

**将提供方构造移动到私有 Desktop Host。** 私有应用仍是受检查的安装入口，Web 产品也需要这项组装。单独的可选组合包需要一起移动当前原生消费者及部署选择，无法表示产品已经选定的实现。

**允许所有实验浏览器包，或允许消费者的全部依赖。** 按前缀或仅按依赖方豁免会悄然接受新提供方、runtime 依赖和消费者。精确源码及解析后的安装身份保留了通用隔离策略的禁止保证。

## Consequences

小兢明确依赖这些预稳定原生 API，并须在上游变化时同步更新消费者。默认隔离规则在点名的采用点之外保持严格。此项组装变化时，源码与已安装包检查必须同时更新；无关产品及可选组合包不继承这项许可。
