# Agent Note: Client 业务代码使用构建期公开环境变量

Status: implemented

[English](2026-08-18-client-build-environment.md) | 中文

## Problem

浏览器业务包需要按部署构建选择静态行为，但 Web client 有两条互不包含的产物路径：Vite 构建静态壳，共享 tsdown preset 构建运行时加载的动态插件。只在一条路径替换环境变量会使相同业务表达式因所在包类型不同而产生不同结果。

浏览器没有 Node `process`，而把构建进程的完整环境对象放入产物会泄露与前端无关的值。运行时配置也不能准确表达构建变体，因为产物发布后不应再改变这类选择。

## Decision

`DSH_CLIENT_*` 是可公开给浏览器业务代码的构建期命名空间。业务代码可用静态点访问 `process.env.DSH_CLIENT_NAME` 选择行为；值只取自构建进程环境，不读取 Vite `.env*` 文件。设置的值在构建时内联为字符串，未设置的值为 `undefined`。

Vite 配置与动态 client bundle 的共享 tsdown preset 使用同一 define 生成器。生成器只为 `DSH_CLIENT_*` 创建精确替换，并把其余 `process.env` 读取收敛到空对象；浏览器不获得全局 `process`、动态键读取或环境枚举能力。

`DSH_CLIENT_*` 的名称本身表示公开性。凭据、路径和其他仅供 Host 或 CI 使用的值不得使用该前缀。

根构建包装脚本向两个 bundler 提供同一份精确的公开环境。每次完整构建都会把源码 Git HEAD 的七位前缀派生为 `DSH_CLIENT_COMMIT_HASH`；没有仓库元数据的构建环境可显式提供该值。在小兢产品仓库中，`pnpm run build` 默认选择小兢 profile，只有 `--profile` 或 CI 使用的非公开选择器才会显式选择其他 profile。`pnpm run build:official` 不依赖特定 shell 的环境变量语法，直接选择仓库的官方产物 profile，并设置 `DSH_CLIENT_BUILD_PROFILE=official` 供部署专属业务注册使用。完整构建成功后会写入精确的公开环境，以及覆盖 Vite 输出和所有动态 client bundle 的摘要；局部构建命令不会替换该记录。

直接编译 Client 前会检查已有的完整构建记录。构建进程必须精确复现记录中的公开环境，否则会在改写产物前停止，并提示应使用的完整 profile 构建命令。完整构建会在调用同一编译器前移除旧记录，只有两条产物路径都成功后才写入新记录。

每个具名 profile 由一个产品插件负责在其构建期 profile 条件通过后发布激活标记。React 挂载前，静态 Web 外壳要求该标记与自身编译得到的 `DSH_CLIENT_BUILD_PROFILE` 完全一致。静态外壳与动态插件混用时，启动过程会显示明确错误，不再静默进入错误产品界面。未打包的小兢 Electron 预览还会在创建窗口前检查完整构建记录；记录缺失或不是小兢产物时直接拒绝启动。

## Alternatives considered

**只在 Vite 中替换。** 动态插件的 `lib/client.js` 作为独立脚本由浏览器加载，不进入 Vite 模块图，表达式会残留到无 `process` 的浏览器。

**公开全部 `DSH_*`。** 仓库中的 Host、测试和 CI 变量使用该前缀，其中可能包含凭据或本地路径；更窄的 `DSH_CLIENT_*` 让公开意图可审计。

**在浏览器提供完整 `process.env` 对象。** 这会允许枚举构建环境并把 Node 兼容垫片变成运行时 API；静态精确替换足以承载构建选择。

**统一改用 `import.meta.env`。** 动态插件输出为独立 CJS factory，不能保留 `import.meta`；业务代码仍会因产物路径不同而使用两套接口。

## Consequences

Vite 静态壳和共享 tsdown 动态 bundle 对同一 `DSH_CLIENT_*` 构建进程变量产生相同字符串值。未设置的静态点访问得到 `undefined`，非 `DSH_CLIENT_*` 值不会通过该机制进入浏览器产物，业务代码也无法枚举构建进程环境。每次完整构建都携带可公开展示的短源码 revision。普通产品开发会保持小兢产物处于激活状态；CI 构建门禁和上游对照工作显式选择官方 profile。npm 打包与 built Web 测试会校验记录中的环境及当前产物摘要，因此不兼容的打包请求、局部重建或修改输出都会在消费产物前失败。

与 profile 不兼容的直接 Client 重建会在修改生成文件前失败。其他路径如果产生混合产物，浏览器启动会拒绝挂载并保留不依赖框架的错误页。Bundle 传输会对一次失败重试一次；插件名册持续不稳定时会在有限时间后显示失败，不再无限转圈。

任何被业务代码引用的 `DSH_CLIENT_*` 值都会成为公开产物内容，命名错误可能泄露信息。构建选择在产物生成时固定；需要部署后变化的设置必须使用拥有校验、传输和文档的运行时配置机制。
