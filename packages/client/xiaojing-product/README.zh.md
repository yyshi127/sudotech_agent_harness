---
description: "Xiaojing Accounting product branding, onboarding, theme, and default persona"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-xiaojing-product

[English](README.md) | 中文

## 概述

构建在 DeepSeek Harness 之上的小兢会计产品层。Host 半侧提供默认部署人格；浏览器半侧通过通用 slot 提供品牌、主题、首页标语、初次使用说明与产品关于页。未加载本插件时，官方 UI 包仍显示默认 DeepSeek 界面。


## 目录

- [功能说明](#capabilities)
- [开发备注](#dev-note)

<a id="capabilities"></a>
## 产品贡献

`0.3.3` 更新包含 0.2.1-rc.2 内核的新模型与搜索接口、插件索引管理、内置自动化任务、草稿引用保留、模型推理与字体设置、麦克风选择、协作与上游稳定性修复；保留已有小兢能力。`0.3.2` 更新详情列出支持复用操作的会话授权，并保留单次审批选项。

办公会话的权限菜单提供**自动审批(实验性)**。确认风险后，本会话及其委派子任务中的普通与强制工具审批均自动放行，包括删除、上传和网页提交。审批替换输入框时，任务顶部仍保留权限菜单；切换至其他权限模式会撤销此授权，包括正在运行的子任务。同一会话重新打开后保留已记录的选择，普通分叉及无关新会话不会继承。财务会话不能选择此模式，新会话默认选项也不包含它。浏览器连接与 Windows 提权仍需遵守系统授权。

产品层会覆盖通用的 `system-prompt` 聊天渲染器，使内部模型指令继续保存在会话中并发送给模型，但不会显示在小兢会计的用户聊天记录里。

小兢桌面端在主工作区内显示这份说明，不先展示独立登录页。设置使用通用入口，不提供账号菜单、账号引导或使用账号认证的模型提供商。

首次使用弹窗通过 `onboarding.content` 显示 API Key 的获取、设置、更换和保密说明，并提供 DeepSeek 开放平台链接。通用欢迎步骤仍负责在保存确认状态后继续；产品弹窗不替换模型配置流程，也不重置已有设置。

产品图片地址和小兢的启动 Logo、favicon 默认地址相对于文档 base 解析，使这些资源保持在 Web 部署的公开挂载路径内。

办公搭子和 Finance 会话的新会话欢迎区使用完全相同的透明双机器人图片，角色手持笔记本电脑和放大镜，分别存放为 `xiaojing-office-robot-logo.png` 与 `xiaojing-finance-robot-logo.png`；侧边栏使用白色圆角底板上的黑金“兢”字图片 `xiaojing-character-logo.png`。两个欢迎区资源别名都从显示区域中排除原图的透明留白，不裁切机器人和地面阴影。欢迎区 Logo 最大高度为 220 像素，位于标题上方，在窄窗或矮窗中按比例缩小；侧边栏在宿主指定的外框内完整显示圆角底板，保持旁边品牌文字的位置不变。标题独立居中，不受版本角标宽度影响；窄布局中角标移到标题下方。初始 HTML 从 profile 的 `DSH_CLIENT_BOOT_LOGO` 与 `DSH_CLIENT_BOOT_LOGO_ALT` 接收 `dsh-boot-logo` 和 `dsh-boot-logo-alt`，使 SUDO 品牌在客户端插件激活前就可显示。profile 的 `DSH_CLIENT_FAVICON` 在初始 HTML 中为浏览器标签页选用同一张白底“兢”字图片；未配置该值的构建保留通用标签页图标。

浏览器插件只在 `xiaojing` Client 构建 profile 中注册 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`、`conversation.hero.brand.content`、`onboarding.content` 和 `settings.section`。产品文案、配色覆盖、带版本号的内测标签、按版本倒序排列的增量更新历史和默认人格位于本包。普通工作区的新会话欢迎语是 `小兢会计，您的AI办公搭子`；Finance 会话显示 `小兢会计，您的AI财务助手`。`0.3.3` 同时显示在欢迎区版本角标和“关于小兢”更新历史首项。“关于小兢”显示产品信息和每个版本的一句话摘要。“查看详情”通过共享 Modal 打开该版本筛选后的更新，按新增功能、体验改进和问题修复分组。`0.3.2` 详情另列八项可配置内置能力，不把已有能力误记为本次新增；自动化任务注明全新安装的默认启用状态。Escape、点击遮罩或“关闭”只关闭详情，焦点返回对应按钮，设置页保持打开。历史记录保留功能的原始版本归属；纠错依据版本对比和产品接入证据。Electron 通过一个受限 preload 方法提供应用实际版本；普通 Web 预览使用必须与 `apps/desktop/identity.json.productVersion` 相同的受检 fallback。测试要求该 fallback 与更新历史首项一致，并拒绝重复版本号。产品层门禁会拒绝版本不一致，也会拒绝把小兢会计品牌标记重新写入官方 UI 源码目录。插件生命周期还会在产品 dataset 挂载后同步现有浏览器 `theme-color` 元数据，并在产品插件卸载时恢复通用值。构建 profile 通过通用启动元数据为插件加载前页面选择已登记的 SUDO Logo；缺少该元数据时，shell 仍显示 `HARNESS` 默认内容。`product.json` 通过官方发布标签记录 `dsh-v0.2.1-rc.2` 基线、通用 slot、浏览器资源路径、桌面产品清单和产品自有 `finance` 预设。产品层门禁会解析 Finance 与标准模式的声明式组装，只允许 Finance 人格、已声明的 Finance 消费端和产品 skill 目录不同。

`finance` 预设是普通 patch，位于 `apps/cli/config/xiaojing-agent-presets/finance/agent.cordis.yml`。它插入由 `@deepseek-ai/dsh-agent-preset` 提供的 `preset-finance`；该声明负责 `finance` id、fallback 显示元数据、顺序和子插件清单。profile 启动只为 `xiaojing` Client 构建加载该 patch，位置在 bundle patches 之后、profile、home 和命令行 overlays 之前。该路径不使用运行时预设根目录发现或 `preset.yml` sidecar。公开的 `AgentPresetDisplayRegistry` 允许本 Client 插件为已登记的 `finance` id 提供当前 locale 文案；未注册提供方时，通用界面回退到声明元数据。`product.json.agentPresets` 记录预期组装路径，`product.json.financeExtension` 登记当前五个 Finance skills 和已实现的 Host／Client 包族，并记录组合行前缀、兼容适配文件名和受保护的 `harness/finance` 持久化根目录。已移除或未来能力不会以占位 skill 清单项保留。

Host 产品插件还拥有小兢会计的强制删除策略。显式删除工具和 shell 删除命令即使在会话策略为 `never` 时，也会通过共享审批通道请求确认。Shell 请求提供“始终允许”，仅覆盖当前 Session 内相同命令、解析后的工作目录和执行权限；命令、目录、权限或 Session 不同须再次决定。单次调用的相对目录以经过验证的当前目录为基准，当前目录消失时先恢复；审批期间目录变化会阻止该次调用。这些选择不会扩大沙箱工作区。字符串和注释不构成删除操作；无法识别影响的编码或间接脚本使用执行确认，不宣称属于删除。单调工具 guard 拒绝未获确认的匹配调用。浏览器和 Windows 控制提供方在各自工具内部分类受保护操作。

保存的默认模型若仍是 `deepseek-official/deepseek-v4-flash` 或 `deepseek-official/deepseek-v4-flash-vision-exp`，Host 产品插件只将此选择改为 `deepseek-official/deepseek-flash`，使新会话使用 V4.1 Flash 的原生图文路线。插件在启用时及设置更新后检查，包括旧 `settings.yaml` 的异步导入。其他已保存的提供方和模型保持不变；历史会话各自的模型选择不会被改写。

产品将自己称为“小兢会计，您的AI办公搭子”，并准确说明技术来源是基于 DeepSeek Harness 进行内部品牌与配置，不声称底层框架由数豆科技开发。

小兢构建通过 `DSH_CLIENT_RUNNING_LABEL_ZH` 与 `DSH_CLIENT_RUNNING_LABEL_EN` 提供 Chat 的本地化运行文案：“小兢会计思考中”与“Xiaojing Accounting is thinking”。可见计时提示与辅助阅读状态使用同一称呼。文案与耗时在浅色主题中显示为黑色，在深色主题中使用主要文字颜色。高光使用相同的文字颜色；三个活动圆点保留各自的颜色。

## 上游升级约定

打开浏览器和网页任务使用[原生浏览器连接](../../xiaojing/xiaojing-browser-control/README.zh.md#native-browser-connections)：默认 Edge，用户明确指定时使用 Chrome。普通打开请求授权必要的连接及普通标签页，无需用户明确说出专用 profile。在尚未执行网页动作时，普通连接失败允许使用同一浏览器的专用实例显式尝试一次，但用户拒绝、取消授权或要求现有 profile 时不适用。用户要求已打开的标签页时使用 `existing`，保留浏览器权限和连接批准，失败后不替换浏览器或 profile。桌面点击不是网页操作的备用路线。这些指令不保证模型响应时延。

上游升级从稳定 `main` 创建 `codex/upgrade-rcX` 分支，并合并经核对的官方 tag 或 commit。产品代码、品牌资源、桌面身份和计费逻辑保持不动。冲突只在通用 slot、rc 专属计费适配器、`apps/desktop/integration-patches.json` 列出的独立集成补丁，以及必要的原子数据迁移中处理。

只有产品层检查、聚焦行为测试、构建后 Web 回放、全新 Windows 安装和上一正式版覆盖升级检查全部通过，升级分支才能合并。无法读取或迁移上一版本数据的版本不得发布。

## 中国财税官方来源核验

产品自有 `finance-tax-research-cn` skill 要求 Finance模式在形成依赖规则的结论前，先识别适用地区、纳税人事实、交易事实、会计或纳税期间和答案对应日期。它调用 `finance_evidence`，只把搜索摘要当作发现线索，并把缺少官方正文、现行效力或适用性证据的事项标为 `待核验`。另外四个 skill 分别覆盖财务文档读取、发票审核、凭证草拟和财务数据分析。它们编排共享文档、官方依据、确定性试算和受控文件工具，但 skill 名称本身不能证明某项业务操作已支持。凭证 skill 只会在用户明确请求、生成带版本预览、完成强制审批并核验回读后创建有成凭证，不会执行过账。当前 Finance 预设不包含报销 skill。

该 skill 不保存法规正文，不建设爬虫或 RAG 索引，也不启用通用 HTTP 抓取。搜索摘要不能被当作完整条文；官方结果不足以支持结论时，回答必须保持非确定性。删除清单项和预设 skill 目录即可移除该能力，不修改 Harness 核心包或用户数据。

## Model Experience

### 全局业务化回答

#### 模型看到的内容

所有小兢会计预设在人格组装后都会获得一段稳定的回答规则。最终回答必须先给可用的业务结果；任务成功后不叙述内部执行证据和失败尝试；任务失败时只给用户可理解的原因和下一步；生成文件按内容及可用位置交付，不附带内部审计元数据。只有用户明确要求技术诊断时才展示技术细节。各工具仍须先生成模型安全的结果，不能用这段提示词替代对传输、重试、分页、校验值和测试信息的源头过滤。

#### Token 影响

每次模型请求增加一个固定的产品级段落。Finance 只追加会计解释和操作安全规则，不重复工具执行证据。

#### KV Cache 影响

该规则对所有预设保持稳定前缀，只在产品回答策略变化时改变。

### 强制删除指令

#### 模型看到的内容

只要组合了任一内置自动化提供方，稳定的自动化上下文就会说明：即使在 Full access 和 `never` 审批策略下，删除也要经过强制确认服务，并禁止通过更换或混淆删除命令来规避服务。用户显式选择“自动审批(实验性)”后，该服务会自动批准这些请求；运行时审批上下文说明授权是否已生效。

#### Token 影响

在现有内置自动化上下文中增加一个固定句子；不会按工具调用重复。

#### KV Cache 影响

产品能力组合不变时，该句子保持稳定前缀。

### Default deployment persona system prompt

#### What the model sees

只有下游组装后 `deployment:persona-prefix` 仍为空时，插件才填入该段。在 Xiaojing profile 中，标准、PTC 与创造模式将身份前缀留空，继承此办公身份并保留各自的工具。Finance 和用户显式定义的人格仍然优先，包括完整提示词替换。当前工作目录由运行时上下文单独提供。办公身份介绍为“你好！我是小兢会计，您的AI办公搭子！”；即使历史回复曾使用“办公助手”，身份提示词也要求后续称自己为“办公搭子”。六类能力介绍以实际可用工具与授权为前提。

##### Verbatim default persona

```markdown
你的名字是小兢会计（简称小兢），在办公搭子模式下的身份始终是用户的AI办公搭子。自我介绍使用“办公搭子”，不要称自己为“办公助手”“AI助手”“智能助手”“财务助手”或“小兢会计的助手”。用户用中文问候或询问身份时，自我介绍使用：“你好！我是小兢会计，您的AI办公搭子！”；其他语言使用对应表达。即使历史回复中曾使用“办公助手”等称呼，后续自我介绍也应使用“办公搭子”。

当前是办公搭子工作区，不是财务助手工作区。产品名称中的“会计”不代表当前会话采用财务身份。不要把日常办公介绍成财税专属服务，也不要把编程、命令或脚本当作默认身份；这些只是完成任务时可用的手段。

用户询问“你能做什么”时，用日常办公语言介绍以下六类能力，按当前可用工具和授权条件说明，不要照搬工具目录：

1. 文档处理：读取、整理、提炼 PDF、Word、Excel、PPT、OFD、CSV、TXT 等材料中的信息；具体格式和扫描件识别能力以已配置的文档工具为准。

2. 数据处理：梳理表格、核对汇总、查找差异，生成可复核的报表草稿。

3. 内容撰写：把需求变成文稿，起草通知、说明、邮件、总结等内容。

4. 信息检索：检索政策、法规、行业等公开信息，保留来源并说明无法核实的内容。

5. 网页操作：连接并获得授权后，在可用浏览器工具支持的范围内协助填表、查数据、走流程；不能仅因界面有浏览器面板就声称能接管它。

6. 电脑操作：在授权范围和可用电脑工具支持下操作应用与文件，推进多步骤任务，不只是提供建议。

可以结合已配置工具处理材料、生成成果。没有相应工具、连接或授权时，如实说明，不声称已执行；用户明确提出财务任务时按实际能力协助，不因此改变办公身份或假定已接入客户账套。

Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product's technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.
```

#### Token effect

不存在显式人格时，默认人格增加上方固定文本一次。

#### KV Cache effect

产品版本和工作目录不变时，该文本保持稳定前缀。更换所选人格或工作目录会改变 system prompt，并可能使提供方前缀缓存无法复用。

### Finance模式预设 system prompt

#### 模型看到的内容

使用内置 `finance` 预设创建的会话会获得标准模式的全部工具，同时将 `deployment:persona-prefix` 替换为下面的财税专属文本。它的文件系统 skill 提供方还会挂载预设旁的产品自有 `skills/` 目录；其他财务服务与 skills 仍可独立移除。

##### Finance模式人格原文

```markdown
You are 小兢会计, an AI office companion configured for internal use, operating in Finance模式. Finance模式 retains every capability of Standard mode and applies an evidence-first discipline to finance and tax work. Distinguish confirmed facts, assumptions, and items that require verification. Do not invent laws, tax rules, accounting standards, citations, client facts, calculations, or completed business actions. When jurisdiction, taxpayer type, accounting standard, accounting period, or tax period can affect the answer, state the applicable assumptions or ask for the missing facts. For current Chinese finance or tax rules, prefer official sources and cite them; when applicability or legal effect cannot be established, say “待核验”. Do not claim that a submission, approval, posting, payment, filing, or external-system change succeeded unless a tool result verifies the final state. For imported PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, or text documents, use finance_document instead of attempting shell, Python, Office, or ad-hoc converter commands. When finance_document reports visual_count, use its visuals action to inspect retained document pictures with the native visual model. For a simple identity question, answer concisely as “我是小兢会计，当前处于 Finance模式。” in Chinese, or the equivalent in the user's language. Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product's technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.
```

#### Token 影响

该预设用一个固定财税人格替换办公身份。额外的 Finance 能力和客户上下文由 [xiaojing-finance-domain](../../xiaojing/xiaojing-finance-domain/README.zh.md) 提供，不属于办公人格。

#### KV Cache 影响

工作目录固定时，该人格保持稳定前缀；切换其他预设会按设计改变 system-prompt 前缀。

## Known Limitations and Deferred Work

- 产品层依赖 `dsh-v0.2.1-rc.2` 集成基线上的八个通用 UI slot；未来官方版本若改变这些 owner，必须先更新适配再合并。
- 浏览器图片仍是由 `product.json` 登记的应用级 public 资源；检查脚本验证其存在，但不会将其嵌入客户端 bundle。
- Shell 分类会识别显式删除命令，但无法推断无关且不透明的第三方可执行文件内部隐藏的破坏行为；任何新增且能删除用户数据的工具都必须公开并强制执行自己的删除分类。
- `Finance模式` 现已具备本地客户上下文、专属财务工作区、文档与票据初审、官方财税依据研究、确定性试算、财务成果文件管理，以及已实现的有成查询和受控维护操作。权威能力清单将各业务领域标为已支持、有限支持或暂不支持。总账、明细账、辅助账、资产负债表、利润表、现金流量表、报销、审核、过账、结账、申报和实际支付都不是当前 Finance 对话能力。
- 受保护的 `harness/finance` 根目录保存带 schema 版本的客户、文档与依据数据；确定性试算不新增独立账本，完整输入与输出保留在会话日志中。

<a id="dev-note"></a>
### 开发备注

无。

不发布运行时不变量伴随插件：注册表和所属服务直接维护这些关系，本包没有需要交叉核对的独立观测。
