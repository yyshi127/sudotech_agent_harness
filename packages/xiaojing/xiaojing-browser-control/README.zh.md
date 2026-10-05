---
description: "Xiaojing native Edge and Chrome browser control and the optional legacy Edge adapter"
kind: "package-reference"
---

# @deepseek-ai/dsh-xiaojing-browser-control

[English](README.md) | 中文

## 概述

小兢会计的 `./native` 入口通过 Harness 浏览器 MCP 提供方连接 Edge 或 Chrome。`./native-settings` 服务为产品设置 Client 提供持久化的用户权限。产品禁用旧 `browser_control` Host；包根入口保留该适配器供显式部署。这些入口均不修改 `agent-loop` 或浏览器企业策略。


## 目录

- [功能说明](#capabilities)
- [开发备注](#dev-note)

<a id="capabilities"></a>
## 功能说明

<a id="native-browser-connections"></a>
## 原生浏览器连接

`browser_connect` 默认使用 `browser: "edge"`。省略 `surface` 时，若用户在浏览器控制设置中启用了该浏览器，则使用现有标签页；否则使用 `managed`。产品提示词仅在用户指定 Chrome 或谷歌浏览器时选择 Chrome；操作已打开的标签页时选择 `surface: "existing"`。普通聊天不会启动浏览器或 MCP 进程。连接成功会记录原生标签页列表并返回工具前缀。

专用浏览器、已配置的 CDP 端点和原生 profile 发现使用 [Harness Chrome DevTools 提供方](../../experimental/browser-use-chrome-devtools-mcp/README.zh.md)。显式部署也可选择 [Harness Playwright 提供方](../../experimental/browser-use-playwright-mcp/README.zh.md)的官方扩展模式。所选上游 schema 提供快照、脚本、截图、表单、标签页等原生操作。

专用 Edge 使用自有临时 profile 和 loopback CDP 端点，以可见方式启动本机已安装浏览器，保留浏览器沙箱。所有网页操作由原生 DevTools 通过该端点完成。`managedBrowserTimeoutMs` 限制可执行文件发现、策略查询、专用 Edge 启动及清理时间，默认 30000 毫秒；清理失败会保留 profile 及其归属，不会在进程退出前删除文件。Windows Chrome 策略若强制指定 `UserDataDir`，则拒绝专用启动，应使用 `existing` 连接该个人浏览器。

<a id="connecting-already-open-tabs"></a>
### 连接已打开的标签页

在小兢的浏览器控制设置中启用指定浏览器。“管理”显示说明及固定的 `chrome://inspect/#remote-debugging` 或 `edge://inspect/#remote-debugging` 地址。Windows 的“打开设置页”按钮在新的普通浏览器窗口打开并验证该页面；用户仍须勾选远程调试并批准连接。通过 Windows UI Automation 验证安装、唯一的新窗口、进程身份、空白地址栏、固定导航和已经加载的 inspect 文档，不导航已有窗口。Chromium 拒绝内部地址作为命令行启动 URL，因此启动参数只传 `about:blank`。验证失败明确报错，保留复制按钮，不关闭浏览器窗口；其他系统采用手动地址。原生自动连接发现现有 profile。Chrome 要求 144 或更高版本；Edge 须支持远程调试权限页。无需扩展、端口或 Token 输入。新连接可能再次要求批准；产品开关不承诺永久授权。关闭开关会断开现有标签页控制，不会关闭个人浏览器。

Profile 发现只读取 Windows 的 `UserDataDir` 和 `RemoteDebuggingAllowed` 策略元数据。显式绝对目录优先于策略，其次为 stable LocalAppData 目录。策略禁止调试、读取失败或返回无效时拒绝连接。应用不读取 Preferences 或凭据、不改变策略、不自动开启调试，也不绕过浏览器批准。含变量的策略目录需要显式绝对目录覆盖。

显式部署可配置已开启的 `existingEndpoint`，或选择 `existingConnection: "extension"` 并安装 [Playwright 官方浏览器扩展](https://github.com/microsoft/playwright-mcp#browser-extension)。该方式需要批准连接和选择标签页。旧小兢 Edge 扩展及其配对码不能建立此连接。

连接失败会撤销会话的当前选择，不会改用其他浏览器、另开替代窗口或重放已完成操作。诊断文案标明所选浏览器；原生 HTTP 403 只说明连接被拒绝，不推断拒绝原因。再次使用浏览器工具前必须显式重新连接。专用连接属于一个存活的 Agent；现有浏览器连接在释放前只允许一个拥有者。调用按连接排队，并在执行前复查所选路线。资源释放会等待正在执行的操作，关闭自有专用浏览器；对于现有浏览器只断开连接，保留其标签页。

### 原生配置与审批

产品按[精确源码及安装依赖策略](../../../.agents/notes/implemented/process/2026-10-03-xiaojing-native-browser-adoption.zh.md)明确采用三个上游实验原生浏览器包；它们的 API 状态及对其他消费者的隔离保持不变。

本包发布三个独立的 Host 包：`lib/index.js`、`lib/native.js` 和 `lib/native-settings.js`，以及对应声明。导入原生入口不会启动浏览器进程或挂载旧适配器；连接由 `browser_connect` 发起。导入设置入口不会建立浏览器连接。

`NativeBrowser` 标识 `edge` 或 `chrome`。Host 专属的 `NativeBrowserSettingsRuntime` 注册向设置服务提供安装检查、已观察连接状态和撤销回调；其 disposer 仅移除该 runtime 的注册。这些声明由 `src/native-settings-types.ts` 维护，不属于通用子系统类型目录。

`edge`、`chrome` 设置各自支持可选的 `executablePath`、`existingEndpoint`、`existingConnection`、绝对 `userDataDir` 和保密的 `extensionToken`。省略 `existingConnection` 时保留显式扩展部署；小兢设置为 `auto-connect`。其 `requireUserSettings` 在权限服务不可用或浏览器禁用时拒绝现有标签页访问。`./native-settings` 在 profile 中保存 live `edge`、`chrome` 布尔值，初值均为 false。其 `openSettingsTimeoutMs` 默认为 30000 毫秒，限制固定设置页导航；拒绝重叠的打开请求，释放服务时取消并等待正在执行的操作。状态新增必填 `canOpenSettings` 布尔值，仅 Windows 为 true；匹配的 Host 和 Client 应一起发布。经过认证的 `open-settings` RPC 只接受浏览器品牌，不建立原生连接或授予许可。设置页区分安装、调试准备状态及原生连接成功；读取状态不获取浏览器资源。安装检查失败显示无法识别，不阻塞另一浏览器或关闭权限。关闭先保存权限再释放连接；重复关闭不重复释放。启用只保存权限意图，不启动浏览器或开启调试权限。

`connectTimeoutMs` 为连接探测提供默认 600000 毫秒的等待时间，包括浏览器授权；`toolCallTimeoutMs` 为后续原生调用提供默认 60000 毫秒的执行时间。产品组装接受 `XIAOJING_NATIVE_EDGE_EXECUTABLE`、`XIAOJING_CHROME_EXECUTABLE`、`XIAOJING_EDGE_CDP_ENDPOINT`、`XIAOJING_CHROME_CDP_ENDPOINT`，以及对应的 `XIAOJING_EDGE_PLAYWRIGHT_EXTENSION_TOKEN` / `XIAOJING_CHROME_PLAYWRIGHT_EXTENSION_TOKEN`。生产中的 `allowPrivateHosts` 保持 false。

操作依据原生观察结果分类，而非模型填写的元素描述。上传、浏览器代码、坐标操作、未经观察验证的目标，以及有外部影响或删除含义的控件需要强制审批。密码仍由用户手动输入。访问私有地址需要审批；该应用级检查不能隔离脚本或重定向发起的每个网络请求。浏览器策略限制和过期引用会报告失败，不会转为桌面点击。

只有当前原生快照能唯一识别每个控件，且已观察页面具有 HTTP(S) 来源时，控件强制审批才提供会话授权。授权限定同一浏览器、专用或现有路线、来源、完整控件标签与操作类别；刷新后的原生引用保留这一分类。脚本和坐标工具也提供“始终允许”，显示的范围覆盖已连接的整个浏览器中该类操作，不限单个网站。浏览器品牌、专用或现有路线、脚本或坐标类别以及 Session 分别区分。每个受保护调用仍经过审批服务与精确执行令牌检查。上传、未验证的目的地或目标、重复标签和未验证焦点的键盘操作仍逐次授权。审批说明跟随界面语言，不改变记录给模型的原因。

## 旧 Edge 入口

以下章节描述可选的包根入口，当前产品组装禁用该入口。

个人 Edge 设置 RPC 通过 Connection 注册 Web 路由，因此 Host 插件启动时同时需要 `connection` 和 `webServer`。

## Edge 路线

专用路线是默认且无需设置的路线。它使用配置的 `profileDir` 持久 profile，以可见方式启动本机已安装的 Microsoft Edge。用户可以登录并最小化窗口；Playwright 仍能继续普通 DOM 操作，不移动物理鼠标，也不通过物理键盘输入。只有 `disposition: "new_window"` 才会创建另一个顶层窗口。

可选个人路线可以操作用户在日常 Edge 中手动打开的普通 HTTP(S) 标签页。Manifest V3 扩展随包放在 [`extension/`](extension/) 解压目录中。用户只需开启 Edge 开发人员模式、加载一次该目录，并使用小兢设置中的八位配对码完成配对。扩展只在目标标签租约期间附加 `chrome.debugger`，并在轮次结束、失败、取消或插件关闭时解除附加。Edge 显示扩展调试提示属于正常行为。InPrivate、`edge://`、扩展页、本地文件页和其他受保护页面会被拒绝。

`open` 在两个适配器之间执行固定选择顺序：

1. 当前请求会话中已经激活且目标匹配的页面。
2. 当前激活且目标匹配的个人 Edge 页面。
3. 其他精确 URL 匹配页面。
4. 请求网站首页时的现有同源页面。
5. 专用 Edge 中的同源页面或空白页面。
6. 新启动的专用 Edge 页面。

显式 `surface: "managed"` 或 `surface: "personal"` 会把发现范围限制到对应路线。产品提示词只允许在用户明确指定路线时使用该覆盖。自动路线不会导航无关的个人标签，不会在部分执行后静默切换浏览器路线，也不会在可选扩展离线时反复打开窗口。

## 语义执行

每次观察对每个 frame 只执行一次扫描，同时覆盖 iframe 和开放 Shadow DOM。有界投影记录可访问角色、名称、状态、输入类型，以及所属对话框、表格行、表单或区域上下文。原生控件和 ARIA 控件直接进入投影；具有 pointer 交互语义的紧凑可见 `div`、`span` 和 `li` 控件会投影为按钮，并去除继承样式产生的子元素重复目标。不透明目标 ID 始终限制在发起请求的 Agent 会话内。React 或 SPA 重新渲染后，语义描述可以重新定位相同控件；控件缺失、歧义或上下文变化时会停止动作，不会改为点击相同屏幕坐标。

`act` 可以按顺序执行有界的点击、填写、追加输入、选择、勾选、取消勾选、悬停、按键、滚动、上传和事件驱动等待。Playwright 或固定扩展协议负责动作可用性等待。每个字段值、选择值、勾选状态、预期 URL 或预期文字都会在进入下一步前验证。首个失败会停止序列并返回 `completedSteps` 和 `failedStep`；已经完成的步骤永远不会自动重放。单步动作继续保留。

普通动作只返回精简结果；`open`、`observe`、`show` 和批量动作结束时会返回新鲜的有界观察。文件选择器、JavaScript 对话框、弹窗和新标签页都进入同一动作生命周期。插件不接受模型提供的 JavaScript、CSS 选择器、CDP 命令、profile 路径、密码值、截图坐标或 UI Automation 命令。`computer_control` 不会成为网页失败后的自动 fallback。

页面注册表在进程内全局可见，因此新会话可以发现旧会话留下的页面。页面租约只属于一个 Agent 轮次，并会在 `turn/end`、取消、失败、关闭或 dispose 时释放。桌面任务和微信任务不能同时操作同一标签。虽然页面发现是全局的，但页面和窗口 ID 仍是每个会话独立的别名。

## 审批与网络策略

办公会话明确启用“不需要审批”后，审批服务自动授予下述工具审批，包括强制确认；浏览器自己的连接许可和 Windows 管理员授权仍由对应平台决定。

读取、打开公共网页、普通菜单点击和普通字段编辑不需要审批。上传本地文件，以及名称涉及保存、审批、发送、发布、支付、转账、购买、签署或提交的动作，必须在执行前获得一次审批，即使会话使用 `never` 审批策略也不能跳过。批量动作会在第一个受保护步骤之前统一审批一次。Delete 键以及名称涉及删除、移除、卸载、擦除或清空的控件始终强制确认，即使处于 Full access 或 `never` 策略也不能跳过。直接调用 Host 服务的受保护请求会关闭式失败，只有注册的 `browser_control` 工具能够完成审批流程。

访问私有地址和 loopback 需要审批，只有确定性测试可以启用 `allowPrivateHosts`。Service Worker 流量分类不会假设请求一定带有 frame；只有对应来源属于已经获准访问该私有主机的开放页面时，Service Worker 才能访问该主机。

## 个人 Edge 桥接安全

扩展只探测 `127.0.0.1:53170–53179`。配对码两分钟后过期，连续五次输入错误后立即失效。配对成功会生成随机长期密钥，分别保存到 Harness 凭据服务和 `chrome.storage.local`；设置 Client 只能获得脱敏状态、扩展 ID、版本和配对有效期。密钥、CDP 载荷、网页内容和目标数据不会进入浏览器设置 Client 或日志。

Host 会验证固定扩展 ID 和协议版本，然后双方通过与随机 nonce 绑定的 HMAC 证明持有已保存密钥；完成证明之前不会接受任何浏览器命令，日常重连也不会发送密钥本身。扩展只在握手通过后接受请求，而且只接受包内定义的语义动作词汇，不接受任意 JavaScript、选择器或 CDP 方法。移除 Host Cordis 插件和 Client 设置插件即可移除整项能力，不需要修改 Harness 核心。

## 配置

- `profileDir` 必填，用于标识专用 Edge profile。
- `executablePath` 只为测试或受控部署提供可选的 Edge 兼容可执行文件；小兢 Windows 应用保持未设置。
- `headless`、动作和导航超时、观察有效期、结果上限及最大批量步骤数都是部署可调项。
- `allowPrivateHosts` 只用于确定性本地测试，在产品组合中必须保持 false。

## 模型体验

### 原生浏览器工具发现

#### 模型看到什么

连接前模型看到 `browser_connect`。获取连接后，其原生 MCP 工具目录和说明加入拥有该连接的 Agent；连接结果记录标签页列表。未选中的路线不注入 MCP 说明，也不能执行工具。结果与审批事件使用常规工具和会话记录路径。 原生工具呈现排除未选中路线的 schema。PTC 生成的 SDK 可能保留以前获取的路线名称，但调用仍会被所选路线检查拒绝。

#### Token 影响

连接后加入所选上游工具 schema 和说明。快照将上游内容加入对话。

#### KV Cache 影响

切换连接会改变 MCP 说明和可用 schema，可能改变请求前缀。

### `browser_control` 工具定义

#### 模型看到什么

`browser_control` schema 要求模型创建页面前先复用匹配页面，通过 `act` 批量完成表单和菜单，并让网页工作始终使用 DOM 语义。结果会标明 `managed` 或 `personal` 路线、会话独立的不透明页面和窗口 ID，以及有界语义观察。模型不能安装扩展或绕过其配对状态。 生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-xiaojing-browser-control)记录该定义。

#### Token 影响

每次请求只包含一个稳定工具定义。普通动作返回精简状态；显式观察和批量动作最终结果只在当前会话后缀增加有界文本与目标元数据。

#### KV Cache 影响

工具 schema 在插件生命周期内保持稳定。页面观察以普通工具结果出现在已缓存请求前缀之后。

## 已知限制与延期工作

- 财务报表不属于浏览器控制能力。D01–D06须等待供应商提供受支持的接口；已否决的浏览器路线记录在[浏览器报表决策](../../../.agents/notes/rejected/architecture/2026-09-14-native-finance-reports.zh.md)中。

- Microsoft Edge 必须已经安装且未被设备策略禁用；应用不会捆绑浏览器运行时。
- 原生现有标签页控制需要浏览器的远程调试权限与连接批准；显式部署也可使用已开启的 CDP 端点或官方扩展。旧适配器需要另行安装其解压扩展并配对。
- 关闭的 Shadow DOM、仅 Canvas 页面、验证码、UKey 和证书提示、安全浏览器界面及操作系统对话框需要用户处理。
- 浏览器或其他 DevTools 客户端可能拒绝 `chrome.debugger` 附加；插件会报告失败，不会切换路线或重复已经完成的动作。
- 旧适配器不包含像素交互。原生坐标和浏览器代码工具仍可在强制审批后使用。

<a id="dev-note"></a>
### 开发备注

无。

不发布运行时不变量伴随插件：注册表和所属服务直接维护这些关系，本包没有需要交叉核对的独立观测。
