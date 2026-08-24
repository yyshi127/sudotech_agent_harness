# @deepseek-ai/dsh-xiaojing-browser-control

[English](README.md) | 中文

小兢会计的 Microsoft Edge 语义自动化插件。一个可移除的 Cordis 插件同时提供 `ctx.xiaojingBrowserControl`、注册 `browser_control` 工具，并使用专用持久 profile 启动 Edge。插件不会接管或修改用户日常使用的 Edge profile。

`open` 会发现受控 Edge 上下文中已经存在的页面，包括用户在该窗口中打开的标签页。它依次复用目标完全相同的页面、同源页面和空白页面，清理多余空白标签页，并且只有不存在合适页面时才创建新标签页。后续语义动作继续操作该会话的活动页面。

模型只能看到有界的页面文本和从可见交互元素生成的不透明目标 ID。每个目标都保留被观察到的准确 DOM 节点，因此节点被替换或脱离文档时会失败并要求重新观察，不会让位置型定位器误点另一个控件。目标会在执行动作或切换标签页后失效。工具不接受模型提供的 CSS 选择器、JavaScript、CDP 命令、浏览器配置目录或密码值。

访问内网、上传本地文件、使用 Enter/Delete/Backspace 等可能提交的按键、提交控件，以及名称涉及支付、删除、转账、发布或发送的控件，都必须先通过 `ctx.approval` 获得一次性授权。Delete 键以及标为删除、移除或卸载的控件使用强制确认，因此会话的 `never` 策略不能抑制该问题。

Service Worker 流量的分类不假定请求关联页面 frame。公共目标正常放行；私有目标仅在 Worker 来源与一个已获得该主机授权的打开页面一致时放行。

取消或导航失败时，插件会关闭受影响的标签页；若它是 Edge 最后一个页面，则先保留一个空白替代页。关闭浏览器操控时，插件会取消正在运行及排队的操作，并等待它们全部结束，之后的新请求才可重新启动 Edge。Edge 意外退出会使该实例的排队操作失效；插件卸载后会永久拒绝新的操作。Edge 以可见方式启动；用户可以登录后将其最小化，普通 DOM 操作仍通过 Playwright 继续执行，不移动物理鼠标，也不通过物理键盘输入。

## 配置

- `profileDir` 必填，用于专用 Edge profile。
- `executablePath` 指向测试或受控部署使用的可选 Edge 兼容可执行文件；小兢会计 Windows 应用保持该项为空。
- `headless`、超时、观察有效期，以及页面、目标和文本结果上限均为部署配置。
- `allowPrivateHosts` 只用于确定性的本地测试，产品配置必须保持关闭。

## 模型体验

### `browser_control` schema

#### 模型看到的内容

[`browser_control` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-xiaojing-browser-control) 会说明该能力拥有专用 Microsoft Edge profile，创建标签页前必须复用合适的现有页面，并且只能操作最新观察中的不透明 ID。每个页面动作都会返回新的 `observationId`、有界可见文本和语义 `targets`。网站操作使用本工具，而不是 Windows 电脑操控。

#### Token 影响

每次请求都包含一个稳定的工具定义。结果只会在当前会话后缀中增加有界的页面、文本和目标元数据，因此观察结果不会导致不同轮次之间缓存的请求前缀失效。

#### KV Cache 影响

schema 在插件生命周期内保持稳定。页面观察以普通工具结果的形式出现在缓存的请求前缀之后。

## 已知限制与后续工作

- 当前实现只使用 DOM 语义与可见文本；不识别像素、不破解验证码、不绕过反自动化机制、不接管用户日常浏览器配置，也不控制页面之外的浏览器外壳。
- 完全由 Canvas 绘制的网站需要独立视觉能力。
- 本机必须安装 Microsoft Edge，且设备策略必须允许其运行。
- 原生身份验证、证书、UKey、下载和操作系统对话框不属于 DOM 自动化，可能需要用户恢复 Edge 窗口或使用 `computer_control`。
