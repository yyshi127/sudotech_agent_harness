# Agent Note: 在桌面应用中锚定 pi-ai 运行时依赖闭包

Status: implemented

[English](2026-08-15-desktop-pi-ai-runtime-closure.md) | 中文

## 问题

Electron 打包依赖收集器通过工作区组合包链路找到 `@earendil-works/pi-ai` 时，会把 pi-ai 本身收进生成的 Windows 应用，却遗漏它的 npm 依赖。安装后的后端因此会在加载 `@deepseek-ai/dsh-llm-pi-ai` 时退出，首先报告无法解析 `typebox`。源码启动不会复现，因为工作区的 pnpm 依赖图会从打包应用之外提供这些包。

## 决策

桌面应用把 `@earendil-works/pi-ai` 的 `0.82.1` 版本声明为直接运行时依赖。该依赖边用于锚定打包闭包，对应的仍是 `@deepseek-ai/dsh-llm-pi-ai` 已选择的同一 pi-ai 实现；应用代码继续使用 DSH 适配器，不会直接导入 pi-ai。只有在内置 Node.js 运行时能够导入成品中的 pi-ai 入口，并且成品 CLI 能从临时 Harness home 进入 web 监听状态后，Windows 发行版才算通过验收。

## 验证

失败的 `0.1.4` 应用包含 pi-ai 本身，却缺少 `typebox`、`partial-json`、`openai` 和各提供方 SDK 包。其后端日志记录了 `llm-pi-ai` Loader 条目中的 `ERR_MODULE_NOT_FOUND`，缺失包为 `typebox`。替代构建会检查 `win-unpacked` 内的直接依赖闭包，使用内置 Node.js 可执行文件导入 pi-ai，并在把安装程序复制到发行目录前启动成品的 `dsh web --port 0` 命令。

## 考虑过的替代方案

**只把 `typebox` 添加到桌面应用。** `typebox` 只是第一个缺失的导入；同一成品依赖图还遗漏其他 pi-ai 依赖，因此只修一个包会继续暴露下一个启动期或提供方特定故障。

**通过 `extraResources` 复制 pi-ai 依赖。** 手工维护的复制清单会重复上游 manifest，pi-ai 发生变化时还可能静默漏包。直接包依赖可以让 pnpm 与打包依赖收集器共同维护该闭包。

**依赖工作区安装布局。** 该布局只存在于源码开发环境，并不是安装后应用的一部分，因此不能充当发行版依赖来源。

## 后果

桌面 manifest 会包含一个用作打包锚点、而不是供代码直接导入的依赖。它的固定版本必须与 `@deepseek-ai/dsh-llm-pi-ai` 选择的版本同步升级；成品运行时冒烟检查会在发布前暴露版本偏离或其他遗漏的运行时依赖。
