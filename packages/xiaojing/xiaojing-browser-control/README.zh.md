# @deepseek-ai/dsh-xiaojing-browser-control

[English](README.md) | 中文

小兢会计的语义浏览器自动化插件。一个 Cordis 插件同时提供 `ctx.xiaojingBrowserControl`、注册 `browser_control` 工具，并使用独立持久化浏览器配置目录启动 Microsoft Edge。插件保留显式 Chromium 可执行文件供测试或受控部署使用，但小兢会计 Windows 安装包不包含 Chrome for Testing。

模型只能看到有界的页面文本和从可见交互元素生成的不透明目标 ID。目标会过期，执行动作或切换标签页后立即失效。工具不接受模型提供的 CSS 选择器、JavaScript、CDP 命令或浏览器配置目录。

访问内网、上传本地文件、使用 Enter/Delete/Backspace 等可能提交的按键、提交控件，以及名称涉及支付、删除、转账、发布或发送的控件，都必须先通过 `ctx.approval` 获得一次性授权。

Service Worker 流量的分类不假定请求关联页面 frame。公共目标正常放行；私有目标仅在 Worker 来源与一个已获得该主机授权的打开页面一致时放行。

取消或导航失败时，插件会关闭受影响的标签页；若它是浏览器最后一个页面，则先保留一个空白替代页。后续请求可以继续复用同一 Edge 进程，不会让工具卡住或关闭可见浏览器窗口。

## 配置

- `profileDir` 必填，必须是专用浏览器配置目录。
- `executablePath` 指向可选的部署受控 Chromium 可执行文件；插件仍会先尝试 Edge，小兢会计 Windows 应用保持该项为空。
- `headless`、超时、观察有效期，以及页面、目标和文本结果上限均为部署配置。
- `allowPrivateHosts` 只用于确定性的本地测试，产品配置必须保持关闭。

## 模型体验

### `browser_control` schema

#### 模型看到的内容

模型会看到 [`browser_control` schema](../../../docs/tool-catalog.md#deepseek-aidsh-xiaojing-browser-control)，其中要求先使用 `open`，再仅操作最新观察中的不透明 ID。每个页面动作都会返回新的 `observationId`、有界可见文本和语义 `targets`；后续目标动作必须使用同一份观察中的 ID。网站操作使用本工具，而不是 Windows 电脑操控。

#### Token 影响

每次请求都包含一个稳定的工具定义。结果只会在当前会话后缀中增加有界的页面、文本和目标元数据，配置的结果上限会限制这部分可变输出。

#### KV Cache 影响

schema 在插件生命周期内保持稳定，不会导致不同轮次之间缓存的请求前缀失效。浏览器观察以普通工具结果的形式出现在该前缀之后。

## 已知限制与后续工作

- 首版只使用 DOM 语义与可见文本；不识别像素、不破解验证码、不绕过反自动化机制、不接管用户日常浏览器配置，也不控制页面之外的浏览器外壳。
- 完全由 Canvas 绘制的网站需要未来的视觉能力。
- Windows 产品要求 Microsoft Edge；若 Edge 被移除或被设备策略阻止，浏览器自动化会返回明确诊断。
