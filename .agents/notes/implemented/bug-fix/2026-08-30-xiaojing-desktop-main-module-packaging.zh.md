# Agent Note: 小兢会计桌面主进程模块打包

Status: implemented

[English](2026-08-30-xiaojing-desktop-main-module-packaging.md) | 中文

## Problem

Electron-builder 会独立应用 `build.files`，不沿用 npm 顶层的 `files` 清单。因此，本地模块即使通过源码测试，也可能没有进入 `app.asar`，导致安装后的桌面应用在主进程启动前失败。

## Decision

Electron 主进程导入的每个相对路径模块都必须列入 `build.files`。桌面身份验证从 `main.mjs` 提取这些导入；任何导入文件未进入打包配置时，验证都会拒绝继续构建。

Windows 发布流程还会在发布安装包前检查实际生成的 `app.asar`。仅通过源码测试不能替代打包文件检查。

## Alternatives considered

**依赖 npm 顶层 `files` 清单。** Electron-builder 在应用打包时采用显式的 `build.files` 清单，因此 npm 清单无法证明安装后的应用包含该模块。

**删除本地模块并将逻辑内联到 `main.mjs`。** 这种做法会通过削弱模块隔离来掩盖打包缺陷，无法验证实际 Electron 配置。

## Consequences

新增主进程相对路径模块时，必须同步增加一条 `build.files` 配置。遗漏配置会在打包前被身份检查拦截，发布验证还会确认生成的归档确实包含该模块。
