# Agent Note：不依赖重解析点的 Profile 模块后备解析

Status: implemented

[English](2026-08-24-profile-module-fallback-without-reparse-points.md) | 中文

## 问题

Profile 启动器此前会在 `$DSH_HOME/profiles/node_modules` 中，为已安装应用依赖闭包中的每个包创建一个符号链接或 Windows 目录联接。Windows 终端安全策略可能以 `EPERM` 拒绝创建重解析点，导致桌面版和移动版都无法启动。之前尝试留下的普通包目录还会让后续每次启动继续失败，因为该路径已经存在，但不是受管理的链接。

后备解析仍必须允许 profile 安装的插件导入应用自有的 Harness 和 Cordis 包，同时不能让陈旧副本替换当前安装。它不能要求管理员权限或开发者模式，迁移也不能删除用户数据。

## 决策

`registerProfileModuleFallback()` 为父模块位于所选 harness home 的 `profiles` 目录下的导入安装同步 Node 解析钩子。解析会先遵循 Node 常规的 profile 本地规则。只有裸包说明符以 `ERR_MODULE_NOT_FOUND` 失败时，才会从已安装应用完整的 `dependencies` 和 `peerDependencies` 闭包中重试对应包。包导出和子路径错误仍然报错；依赖闭包之外的包不会因此变为可见。

启动器在挂载 profile 树之前注册钩子，并把可重复调用的 disposer 作为根 Cordis effect 管理。因此，内置包来自当前运行的安装，而正常安装在 `profiles/<name>/node_modules` 下的第三方包仍保持第一优先级。启动过程不再创建符号链接、目录联接或包副本。

Web 客户端模块注册表会在 Loader 的 Node ESM 解析器可用时通过它解析包清单。因此，插件导入和 `dsh.client` 元数据使用相同的 profile 优先和当前安装后备规则。如果不共享该解析器，全新 profile 可能已激活全部 Host 插件，但注册表独立使用的 `require.resolve` 无法看到安装后备，最终仍会输出空的浏览器启动图。

如果常规解析从旧版共享路径 `$DSH_HOME/profiles/node_modules` 找到应用自有包，钩子会拒绝该结果，改从当前安装解析。共享目录和各 profile 自己的 `node_modules` 目录保持逐字节不变，会话、凭据、设置、人格预设、附件、插件状态和工作区同样不会被移动或改写。

## 考虑过的替代方案

- **要求启用开发者模式或管理员权限。** 否决，因为普通安装版和 U 盘移动版必须能够在产品无法控制的终端策略下运行。
- **把安装依赖闭包复制到 harness home。** 否决，因为副本会在升级后漂移、重复运行时，并再次造成此次修复要消除的遮蔽问题。
- **继续使用 Windows 目录联接而不是符号链接。** 否决，因为失败的实现已经请求目录联接，而目标终端拒绝创建重解析点。
- **从应用全局解析所有缺失导入。** 否决，因为这会在 profile 执行之外掩盖未声明依赖，并可能改变无关模块的解析。

## 结果

桌面版和移动版启动不再依赖 Windows 重解析点权限。现有标准 profile 和插件保持原有解析顺序，未来覆盖升级会从新安装的应用选择应用自有包，而不是继续使用旧共享后备目录。依赖闭包之外的手工包仍可能从旧共享路径解析，但受支持的插件安装方式仍然是安装到具体 profile。已构建 bin 的测试覆盖随附 Web 和 headless profile、树外 profile 插件、间接应用依赖以及原地保留的有害普通后备目录；客户端模块测试覆盖 Node 22 和 Node 24 两种解析器接口，重定位移动版烟雾测试则验证无重解析点时仍存在完整的小兢会计浏览器图。单元测试覆盖不改写目录和钩子 disposer 的幂等性。
