# 小兢会计 Windows 桌面端

[English](README.md) | 中文

“小兢会计-您的AI办公搭子”的私有 Electron 部署应用。它通过 Windows 安装包而不是 npm 分发，启动随包提供的 Node 运行时和 Web profile，将 renderer 与 Node 隔离，并在一个 Windows 桌面窗口中呈现本地 Host。

## 永久安装器身份

`identity.json` 是身份源清单，`verify-desktop-identity.mjs` 固定以下兼容标识：

| 字段 | 值 |
|---|---|
| Package name | `@sudotech/xiaojing-accounting-desktop` |
| App ID / AppUserModelId | `com.sudotech.xiaojing-accounting` |
| NSIS GUID | `1f6e3c2a-13e7-5ab1-a2d7-10b68c1b911a` |
| 安装目录 | `xiaojing-agent-desktop` |
| 可执行文件 | `小兢会计.exe` |
| 产品名称 | `小兢会计-您的AI办公搭子` |
| 安装范围 | 当前 Windows 用户 |
| 快捷方式 | `小兢会计` |

全新安装使用两阶段品牌安装流程。欢迎页显示小兢标识、数豆绿色安装操作和可选的行内父目录选择器，并自动补齐 `xiaojing-agent-desktop`；安装页在真实 NSIS 文件进度上方显示小兢标识、下方显示紧凑的数豆 Logo，完成后直接启动应用，不再显示单独的完成页。欢迎页包含安装许可提示，内部使用说明、完整的上游许可和第三方声明仍随包保存在 `resources/legal`。全新安装到原本不存在的目标目录时，关闭进度窗口会显示品牌化确认卡片：“继续安装”恢复流程；“取消安装”启动外部清理程序并以 `1602` 退出，安装器进程停止后，清理程序校验固定安装目录名，只删除部分应用、当前用户安装记录和快捷方式。目标目录在安装前已存在时禁用取消。覆盖升级在开始替换文件前仍可从欢迎页退出；文件安装一旦开始，关闭确认卡片只允许继续，并说明为保护原版本不能取消。用户数据路径不参与任何清理。具有相同身份的新版安装器会沿用 `InstallLocation`、隐藏路径选择、替换应用文件，并刷新快捷方式和卸载信息。迁移安装位置仍需卸载后重装。

## 永久用户数据路径

Electron 在获取单实例锁之前，将 `userData` 固定为 `%APPDATA%\@sudotech\xiaojing-accounting-desktop`。随包 Host 使用其 `harness` 子目录作为 `DSH_HOME`，用户工作区位于 `%USERPROFILE%\Documents\小兢会计工作区`。

桌面端通过临时 loopback 端口和 `--no-open` 启动 Host，并固定 `DSH_CLIENT_BUILD_PROFILE=xiaojing`，因此只有 Electron 窗口会加载应用，Host 不会额外打开系统浏览器窗口，打包后的小兢专属 Host 插件也会保持启用。

`user-data-contract.json` 保护会话、设置、凭据、agent 预设、profile、storage、旧版上传文件、原生图片附件、用量统计、专用浏览器操控 profile、微信频道状态、桌面小兢偏好、Electron Local Storage 和“文档”工作区。安装器设置 `deleteAppDataOnUninstall: false`，且不会访问这些路径。`verify-user-data-contract.mjs` 使用合成的 0.1.9 数据集验证应用文件替换和 rc.2 reader；除精确移除 ModLens 的安装程序默认 Web profile 迁移外，所有受保护数据必须保持字节不变。它还会在私有副本上验证扁平凭据到 version 1 的原子迁移不会生成明文备份，并检查会话、凭据、预设、设置、上传、storage 和用量兼容。若发布版改变其他持久格式，必须先增加原子迁移和上一正式版 fixture，才能调整此检查。

## 开发预览隔离

仅源码 Electron 预览可以在启动桌面包之前，将 `DSH_DESKTOP_PREVIEW_ROOT` 指向一个空的临时目录。未打包运行会把 Electron 应用数据和“文档”工作区同时放到该目录下；打包后的应用忽略此变量，并继续使用上文固定的永久路径。这样可避免开发预览读取或写入已安装用户的数据。

## 桌面小兢与系统托盘生命周期

Electron 就绪后，桌面端会创建一个透明且不抢焦点的小兢宠物窗口和系统托盘。Host 侧桌面宠物插件把会话、审批和脱敏后的微信生命周期事件聚合为一份不含任务内容的全局状态；Electron 将该状态映射到随包提供的待机、思考、执行、等待确认、成功和失败素材，且不会向任一 renderer 暴露任务内容。

桌面小兢可以跨显示器拖动，默认显示为原始角色尺寸的 50%，并在设置中提供 30%–100% 大小调节器。首次启动和“重置桌面位置”会把完整宠物窗口放在小兢会计主窗口内部右下角并保留固定内边距；用户明确拖动后保存的位置仍然优先。桌面版启动时，处于已唤醒状态的桌面小兢会等到主应用界面加载完成，再等待 3 秒，然后用两行显示“你好，我是小兢会计，”和“您的AI办公搭子！”，持续 5 秒；活动任务会立即取消或覆盖欢迎语，后续手动唤醒不会重复介绍。连续空闲 3 分钟后，它会从思考、展示和干劲姿势中随机选择两个不同姿势，每个保持 3 秒；两轮结束后恢复默认待机，并重新等待下一个空闲周期。这项巡游不会改变 Host 的真实任务状态，也不会显示任务状态气泡；任务开始时立即取消，Windows“减少动态效果”会将其关闭。大小和受限工作区位置保存到 `%APPDATA%\@sudotech\xiaojing-accounting-desktop\desktop-companion\preferences-v1.json`；状态提示会跟随缩放后的角色，不会固定在透明窗口顶部。已保存的显示器不可用时，它会恢复到主窗口所在显示器。收起桌面小兢只销毁其 BrowserWindow；Host、活动任务和微信频道继续运行，设置页或托盘可以再次唤醒它。

关闭主窗口只会将其隐藏到托盘，不会退出应用。最小化按钮仍保持正常任务栏行为；第二次启动应用会恢复现有主窗口；只有托盘中的“退出小兢会计”才会停止 Host 和整个应用。存在活动任务或微信在线等中断风险时，该命令会要求确认。renderer 只能使用 `preload.cjs` 声明的八个方法，其中包含只读应用版本查询；它不能访问 Node、文件系统、任意 IPC 或 BrowserWindow。

## 内置自动化运行环境

浏览器操控通过两条互相独立的 Microsoft Edge 路线工作。默认专用路线以可见方式启动 Edge，并使用 `harness/browser-control/profile`；可选个人路线通过单独配对的扩展，只附加用户日常 Edge 中明确选中的 HTTP(S) 标签页。桌面构建会把解压扩展复制到 `resources/xiaojing-edge-extension`，并将其绝对路径传给 Host；源码预览则使用插件包中的 `extension/` 目录。Windows 应用操控使用 Windows PowerShell 5.1 和操作系统自带的 `System.Windows.Automation` API。终端用户无需安装 Node、浏览器驱动、PowerShell 模块或独立自动化服务。

两项能力分别位于独立 Cordis 配置行中。开发 overlay 可以单独禁用任意一项，小兢产品组合则默认启用二者，并在每个新 agent 会话中说明当前可用能力。浏览器和 Windows 观察都使用会话独占的不透明 ID，并在状态变化后过期。访问内网、上传文件、提交、支付、删除、发送及同类原生操作需要一次性授权。

## 独立集成补丁

`integration-patches.json` 将桌面 API Key 环境隔离、profile 运行时遮蔽防护和附件上传输入区修复与品牌产品插件分开登记。可写凭据界面由 rc.2 提供；桌面补丁只在 Host 启动前清除继承的 `DEEPSEEK_API_KEY`。某个条目消失或所属路径不存在时，桌面身份检查会失败。这样可以聚焦上游冲突审查，同时不会把这些补丁冒充为 Harness 官方行为。

## 发布检查

准备随包运行时前，先运行身份、用户数据、产品层、桌面小兢、真实 Edge 和 Windows UI Automation 测试。正式发布还必须在默认路径与自定义路径分别完成全新 Windows 安装，以及从上一安装包覆盖升级。安装后确认会话、凭据、预设、插件、附件、工作区、用量数据、专用浏览器 profile、微信频道状态和桌面小兢偏好全部保留，才能发布安装器。

## 已知限制

- 更新方式是下载并运行新版安装包，目前没有应用内自动更新。
- 安装包尚未进行 Authenticode 数字签名，因此 Windows 可能显示未知发布者或 SmartScreen 提示。
- 覆盖升级只适用于同一 Windows 用户，且不能在升级过程中迁移安装目录。
- 浏览器操控依赖 Microsoft Edge；如果 Edge 未安装或被设备策略阻止，能力会返回明确的启动错误。
- 内置自动化依赖语义而不是视觉，不能操作纯像素控件、验证码、UAC、安全桌面或管理员权限应用。
