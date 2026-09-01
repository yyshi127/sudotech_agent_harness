# Agent Note: 小兢会计打包 Host 启动验证

Status: implemented

[English](2026-08-30-xiaojing-desktop-packaged-host-boot.md) | 中文

## Problem

工作区开发链接可能会满足插件的 peer 依赖，即使组装后的 Electron 应用并未提供对应软件包。仅检查 Electron 主进程归档无法发现这种缺口，因此安装包可能通过源码和归档验证，但打包 Host 会在加载插件时退出。

## Decision

Web 应用 bundle 提供小兢会计财税依据插件作为 HTTP 提供方导入的 `@deepseek-ai/dsh-web-fetch-http`。

Windows 发布验证器使用小兢会计 profile、隔离的临时 `DSH_HOME`、无 DeepSeek API Key 和 `--no-open`，启动打包内置的 Node 运行时及 `dsh` CLI。只有完整插件树加载成功且 Host 输出本机回环地址时，验证才通过。验证器随后终止这个临时进程树并删除临时数据。

## Alternatives considered

**只检查软件包清单而不启动 Host。** 静态依赖检查无法证明 Electron-builder 已复制解析后的完整软件包树，也无法证明原生模块和条件导入能在目标平台加载。

**只在桌面应用软件包中增加缺失的提供方。** 这种做法只能修复一个安装包，其他启用同一 Finance 插件的 Web 应用组装仍然不完整。

## Consequences

Windows 打包步骤增加一次无 Key 的 Host 启动，因此耗时会略有增加。当打包后的小兢会计插件树缺少运行时软件包或无法进入就绪状态时，发布会在生成结果交付前失败，并且验证不会读取或修改用户数据。
