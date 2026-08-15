# Agent Note: 拒绝 profile 本地运行时遮蔽并回滚插件变更

Status: implemented

[English](2026-08-15-profile-runtime-shadow-rollback.md) | 中文

## 问题

profile 组合包 manifest 会优先从 dsh 安装目录解析，但这些组合包插入的裸插件行仍从 profile 目录解析。第三方插件如果把 `@deepseek-ai/dsh` 或应用内置的 DSH／Cordis 包声明为普通依赖，就能在 profile 的 `node_modules` 中安装另一套运行时；Loader 随后会导入这些距离更近的后端与浏览器包，而不是应用随附的副本。即使 profile 仍列出安装自有的 `dsh-base` 与 `dsh-web-app` 组合包，运行中的 UI 和核心服务也可能被替换。[profile 插件组合包决策](../architecture/2026-08-05-profile-plugin-bundles.md)负责组合包合成与安装回退机制；本 note 负责防止 profile 依赖遮蔽该回退机制。

## 决策

安装依赖闭包定义受保护包集合，并筛选出 `@deepseek-ai/dsh*` 与 `@deepseek-ai/cordis*` 包族。`findProfileRuntimeShadows` 会检查 profile 顶层 `node_modules` 中的每个受保护包，将其真实路径与安装副本比较，并报告不同的副本。结果非空时，`assertNoProfileRuntimeShadows` 会拒绝该 profile；每次 profile 启动都会在挂载配置树前执行该检查。

`dsh plugin` 在把操作转发给 pnpm 前，会记录 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 以及已有的遮蔽包集合。pnpm 成功后，只要出现新增的受保护副本，命令就会在调和组合包列表前失败。命令会恢复已记录的文件，运行 `pnpm install --ignore-scripts` 重新物化原依赖图，再次恢复已记录文件，确保原先不存在的锁文件仍保持不存在；只有 pnpm 成功且新增遮蔽包已清除时才报告回滚成功。已有遮蔽包不算本次新增，因此仍可使用 `dsh plugin remove` 修复受污染的 profile；在所有遮蔽包清除前，启动检查会继续阻止该 profile。

外部插件把 DSH 与 Cordis 包声明为 `peerDependencies`，并通过安装回退机制解析它们。该检查不会禁止有意扩展 UI 的插件，也不会沙箱化包代码：已启用插件和经明确允许的生命周期脚本仍会以用户权限执行。

## 验证

profile 单元测试会在一个无关库旁布置安装自有的 DSH 与 Cordis 包，并证明系统只报告和拒绝不同的运行时副本。构建后 bin 测试会安装一个传递依赖伪造 `@deepseek-ai/dsh-app-boot` 的本地组合包，证明命令以非零状态退出并恢复 profile 的确切依赖状态；另一项测试证明直接放入同一遮蔽包后，profile 启动会以非零状态退出。无密钥 CLI 快照会通过同一本地组合包运行源码启动器，并固定用户可见的拒绝与回滚确认、已恢复的 manifest、不存在的锁文件和不存在的运行时副本。

## 考虑过的替代方案

**阻止已知的不兼容插件名称。** 黑名单只能修复一个包，并会漏掉改名、alias、Git 托管或新发布但犯下同一依赖错误的包；被破坏的不变量不是插件身份。

**通过 pnpm 固定或覆盖传递 DSH 版本。** override 可能让不兼容插件看似安装成功，却违反其声明的版本要求；它也无法阻止插件通过另一条依赖路径携带第二个 Cordis 实例。

**所有裸插件行都从安装目录解析。** 这样能防止运行时遮蔽，但也会让 profile 中的树外插件行无法解析。分流解析器虽然能保护根导入，却仍会留下不兼容的依赖图并让第三方代码访问，因此安装拒绝仍然不可缺少。

**每次命令前复制或重命名完整的 `node_modules` 树。** 恢复目录快照比重建原依赖图更强，但复制数百 MB 会让每次正常的 `why`、`add` 或 `update` 都变慢；Windows 上运行中进程监视插件文件时，该操作还可能失败。

## 后果

兼容插件操作继续保留 pnpm 的普通行为和组合包调和。不兼容操作可能在安装后检查拒绝前完成依赖解析、下载和获准执行的生命周期工作；回滚能阻止该依赖图成为应用下次使用的运行时，但无法撤销在 profile 依赖文件之外执行的任意副作用。绕过 `dsh plugin` 修改的 profile 会在启动时失败，而不是静默加载另一套后端或浏览器 UI；诊断会列出必须移除的每个遮蔽包。
