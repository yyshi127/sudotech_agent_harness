# apps/web 浏览器 e2e

[English](README.md) | 中文

这些测试在进程内启动真实的 web 组合，并用真实浏览器通过真实 HTTP 驱动它。Chromium 运行整个 lane；[模型与推理强度选择场景](declared-reasoning.e2e.ts) 还在 WebKit 中运行，以覆盖原生鼠标焦点行为。[会话回放恢复](session-replay-reload.e2e.ts)还在 WebKit 中运行，共用 `fresh-round-trip` 的录制和预期输出，不改写这些文件。该用例覆盖输出中刷新、完成后刷新和重新打开 Session。该 lane 的运行机制——模式、fixture（测试前置数据）、golden，以及与 `dsh web` 之间刻意保留的组合差异——记录在 [`scaffold.ts`](scaffold.ts) 和 [浏览器 e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.zh.md) 中。

安装工作区依赖后，在仓库根目录安装浏览器及其系统依赖：

```sh
pnpm --filter @deepseek-ai/dsh-web-frontend exec playwright install --with-deps chromium webkit
```

在 Linux 上，`--with-deps` 会通过系统包管理器安装依赖。持久化 CI VM 必须通过镜像维护提供这些依赖，CI 只安装浏览器程序，遵循[故障切换手册](../../../.agents/notes/implemented/process/2026-07-26-ci-failover-runbook.zh.md)的要求。

普通场景以没有已登记 Workspace 或 Session、但持久化标记记录默认 Workspace 已被删除的状态启动，使显式文件夹选择场景自行决定 cwd。`launchWebScaffold({ firstUse: true })` 保留初始化资格，供启动场景使用。

小兢生命周期回放持有独立的 [`xiaojing-lifecycle-native`](../../../snapshots/web/xiaojing-lifecycle-native/snapshot.yml)，当前 V4 会话记录包含原生 `browser_connect` 指令。前代 `xiaojing-lifecycle-chrome` 记录保持不变。无密钥刷新只向新场景写入 Session 数据；普通回放在验证欢迎区、首次发送和工作区时，比较完整的持久化会话。

[`session-approval-reuse.e2e.ts`](session-approval-reuse.e2e.ts) 通过 Host 应答器和真实 Agent Session 驱动正式审批面板。[编写式记录](../../../snapshots/web/session-approval-reuse/snapshot.yml) 拥有完整的主 Session 及提示词、工具 schema 固定输出。第三个选项在当前 Session 内授权可信操作类别和目标范围；其他范围、单次审批、拒绝及独立 Session 保持各自的决定。仅只读测试工具和模型响应采用编写式输入；审计事件、Client RPC 和自有文件读取均实际执行。面板预期输出保留在[应用本地](expected/session-approval-reuse/panel.expected.md)。[`xiaojing-approval-operations.e2e.ts`](xiaojing-approval-operations.e2e.ts) 使用实际产品 shell guard 与原生浏览器 guard，通过固定的自有文件删除和外部浏览器响应，验证本地化审批、会话授权复用、命令变更后的拒绝与持久化审计。

图片排队和实时对话快照分别保存小兢预期，并在回放目录中声明当前模型路由。小兢实时对话的独立场景还检查日志中的自动化上下文和 Windows 技能目录，不改写官方 Session 世代。连续对话执行当前平台的原生 Shell，并定位实际展开控件；小兢长历史 seed 归属办公工作区。两个长对话场景均为该路由声明测试用的上下文容量。共享 Session 录制和官方 profile 的预期保持只读。

子代理场景按连接的工作区选择父代理，不依赖根代理顺序，并在连接前等待小兢启动界面就绪。离线输入框有独立的小兢思考文案预期。插件取消场景为小兢两种主题的焦点和高亮颜色保留独立预期；取消、清单回滚、重试、减少动态效果及未知结果恢复使用相同行为断言。

模型和通用设置保留独立的小兢导航预期，字段、凭证、能力及持久化断言与官方 profile 共用。插件管理将所属 profile 目录的路径表示替换为固定符号，包括 Windows ARIA 转义，并按连接的工作区选择 Team 父代理。清除缺失插件、更新清单和即时启用仍使用精确的行为断言。

工作区场景使用当前 profile 的普通分类标签和目录列表。冷历史 seed 归属办公工作区，分页拦截按录制 Session 的地址选择。文件预览预期保留 Windows 原生路径表示。旧空白缓存检查显式打开录制 Session，等待空闲摘要就绪，再采集不含悬停操作的会话行。导航采集只替换所属目录、其 ARIA 转义形式及目录名，录制 seed 和预期保持不变。

小兢上传场景拥有独立的 Session 录制和 UI 预期。回放前在测试所属临时主目录中实现预期附件路径，工具参数保留原生路径，读取结果保留正斜杠路径。实际事件和共享归一化器不变；结束阶段比较完整持久日志，即使比较失败也移除该临时主目录。

键盘场景检查所选 profile 的配色和原生路径标签。首轮分支检查按连接的工作区选择新 Session。Windows 审批快捷键拒绝用例为借用的 Bash 录制创建临时 PowerShell 回放覆盖；仍要求拒绝结果及目标文件未写入，借用录制保持只读。

断言模型标签的已结束 Markdown 场景通过仅含头记录、没有模型调用的 fixture 提供小兢当前模型目录。独立 UI 预期保留 Markdown 语义、可访问的复制链接控件与当前模型标签，原预期保持不变。图片测试比较 Markdown 编写的精确请求路径，包括相对路径的原生前缀与绝对路径的正斜杠后缀。Windows 文件预览预期保留原生分隔符。上下文详情保留 390、800、1280 像素下的几何检查。

长历史分页和引用输入场景提供当前小兢模型目录，不接受模型调用。引用建议保留全局会话列表，包括后台财务空白会话，仅标记测试持有的 cwd 及其原生 ARIA 写法。分页计数、引用插入、键盘导航和召回顺序保留原行为断言。

Windows 下的小兢审批和问题输入场景分别持有应用本地 V4 会话及 UI 预期。审批使用字面量 PowerShell 写入，保留原只读策略、单次批准、几何断言和完整最终工作区；两个场景均比较完整持久化会话。原已发布世代保持不变。

组合客户端场景通过 `xiaojing-assembled-fixture.client.ts` 显式提供小兢财务客户端和用量 RPC 响应；场景数据、行为断言及未匹配调用检查仍由各测试持有。严格控制台守卫拒绝渲染期间的更新和退出时的订阅错误，同时原样转发控制台消息。文件修改场景选择独立小兢 V4 会话和 UI 预期，保留读取 → pwsh → 编辑顺序，以及完整会话与工作区比较。

技能工具行直接载入已发布记录，不调用模型；小兢 aria 比较只替换该工作区持有的精确资源根目录。技能调用为响应流声明小兢当前的回放模型目录，流式代码围栏高亮保留可暂停的自定义适配器。独立小兢 aria 预期固定模型名称和思考文案；技能指令、引用重载、Token 树、DOM 保留及控制台检查仍须通过。

Windows 上的小兢网页搜索和 SVG 交付场景使用独立 V4 记录，比较整个持久化会话。网页搜索保留真实凭据服务、本地 Messages 端点、搜索辅助模型、来源数量上限及几何断言。SVG 交付回放工作区相对路径，要求原 SVG 字节、实际文件创建成功、显式交付、完整最终工作区和可用的改动审阅。链接图库保留全部链接操作；小兢预期只从可访问性树移除装饰性复制图标。原记录及预期保持不变。

Windows 小兢后台任务场景执行 PowerShell，并将历史种子放入显式展开的办公工作区。会话回放恢复使用独立小兢 V4 预期，验证 PowerShell 结果，并在 Chromium 和 WebKit 中实际执行流式过程中刷新、完成后刷新以及重开同一会话；退出比较整个持久日志。焦点环和滚动条场景保留几何及键盘行为，选择产品的主题颜色。补充焦点夹具在源码编译前规范原生路径分隔符，只解析其精确的内存入口。

小兢材质场景区分选中的预设卡片与普通插件卡片，在两种主题和两种平台 CSS 分支中验证菜单，不依赖账户入口。带前缀的挂载场景要求每个品牌资源留在挂载目录下，同时保留解析后的安装元数据、WebSocket 和导航检查。小兢安装元数据使用产品名和兢字 PNG，每次安装的标识由挂载目录确定。favicon 场景将构建后的兢字 PNG 及其声明尺寸与公开源文件比较；官方 manifest 和按主题切换的 SVG 检查保留在其所属 profile 分支。manifest 测试通过 Host scaffold 读取 profile，只归属 Host 类型程序。

Auto review 的 aria 比较只替换测试持有的 Windows 工作区目录名。小兢冷态预期在无目录元数据时使用持久化的 provider/model 名称；原种子记录、审批结果及模型调用行为不变。模型恢复与桌面语言选择独立小兢导航预期，保留异常提供者恢复、拒绝无效修改、系统语言存储、显式语言选择和刷新检查。权限策略回放持有独立小兢 V4 预期，要求完整的当前审批文案、原决策与工具调用、精确的最终文件，以及整个持久化会话。原已发布世代及 UI 预期保持不变。

反馈场景使用本地收集器及独立小兢预期，保留回复、用量、确认、事件收集和数据字段检查；新记录中仅三个计时字段固定为零。反馈命令场景比较整个持久化会话，发布场景保留收集器和刷新隔离检查。它们不向外部端点发送反馈。

右侧栏场景在操作及刷新后持续使用属于已连接工作区及其已完成会话的 Agent。输入卡片页签场景保留聊天／轨迹的几何与补偿控件检查。Windows 小兢 PTC 权限升级持有独立 V4 记录，声明当前模型目录及两处原生沙箱部分执行限制提示；原程序、策略切换、审批事件、回复流、用量、最终工作区字节和完整持久化会话比较均保留。

真实 Host smoke 保留官方 Web 上下文检查，小兢 profile 使用小兢身份和首次引导页。每次 CLI 启动均固定页内目录选择器。原生 Shell 验证要求唯一的精确命令及其对应成功结果，完整 stdout 与原生输出一致后才展开工具行。框架缩放选择应用唯一的 frame；页签切换、主题、标题持久化、刷新及控制台错误检查均保留。

[微信会话恢复用例](weixin-session-restore.e2e.ts) 通过真实 Web Loader 挂载产品频道，仅替换本地 iLink 和模型服务。它在恢复原工作目录时保留已发布的 V3 日志，将两条排队问候的回复与精确 golden 比较，并验证两轮完成事件及持久化队列清空。它不请求外部 HTTP。临时工作区必须位于已有 Git 仓库之外，防止轮次结束时的变更收集扫描开发者的工作树。

## 完成状态观察

依赖状态的用例使用 Workspace、接纳、附件和模型流屏障，区分可见中间状态与已完成操作。模型选择器的持久化断言等待默认设置保存完成，不以菜单关闭作为完成信号。详情关闭等待框架过渡结束；归档验证为 seed Session 设置显式标题，并跨重载跟踪该身份。[CI 测试可靠性工作流](../../../.agents/skills/dsh-ci-test-reliability/SKILL.md#synchronize-on-state)负责这些同步规则。

[空闲提交交接](idle-submission-handoff.e2e.ts)对 Host 帧和浏览器中的消息归位的等待使用 scaffold 的 30 秒 Turn 完成预算。Vitest 负责 scaffold 清理，使 replay 消耗检查错误不会覆盖场景中失败的断言。

插件管理器的开关为 Host 的 profile 写入与 store 随后的 inventory 读取预留 `PLUGIN_TOGGLE_SETTLE_MS`（10 秒），这两步完成后才会重新发布 `aria-checked`；链路的实测值记录在该常量的 JSDoc 中。

显式滚动使用 `support.ts` 的 `scrollIntoView`：旧元素脱离 DOM 时重新解析 locator，并在同一个浏览器任务中检查连接状态、执行原生滚动。各场景保留滚动后的可见性与几何断言。

## 这些是 Host 面的测试

它们在根 `tsconfig.host.json` 中做类型检查，而不在 Client aggregate 中，因为它们直接读取 Host 服务：`ctx.connection`、Host 侧 `SessionStore` 与 `ctx.sessionProjectionCache`。运行时驱动浏览器并不使一个文件成为 Client 程序的一部分——两个 face 在相同的键上以不同服务合并 Cordis `Context`，因此单个程序无法同时看见两者。把这些文件挪进 Client aggregate 会让每一处 Host 服务访问都无法编译。

## 不要在此 import `@deepseek-ai/dsh-client-*`

import 一个 Client 包——无论值还是类型——都会把它整个 TypeScript 工程、以及它引用的每个工程拉进 **Host 构建图**。这已经坑过本 lane 一次：四个 Client 消费方包引用了 `api/remotes` 的 Client face，而该 face 必须等 Host tsdown 生成 `@deepseek-ai/dsh-goal/remote` 之后才能编译，于是 Host 构建阶段变成在等一个由它自己产出的产物。

当某个场景需要 Client 持有的常量或纯函数时，改为在此处镜像一份，并紧挨着一条注释掉的 import 点明源模块。这样漂移会表现为选择器未命中或镜像值陈旧——是响亮的失败，绝不会是静默通过。`scaffold.ts` 按此规则镜像 welcome-notice 的 namespace、确认字段、版本和被断言的中文文案。

built-client harness 是例外。`assembled-boot.ts` import `AppWebEntry`、boot manifest（元数据清单）类型与 `RemoteMock`；`assembled-remote.ts` import Client test runtime 的默认响应与 `RemoteMock`。这些包是显式的工程引用，用于通过测试持有的 carrier 启动真实 shell。chat 场景仍在 `support.ts` 中镜像 `conversationContextKey`，而不 import 其 Client owner。

没有任何机制强制这条规则；靠 review 守住它。
