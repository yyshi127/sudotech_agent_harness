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

产品层会覆盖通用的 `system-prompt` 聊天渲染器，使内部模型指令继续保存在会话中并发送给模型，但不会显示在小兢会计的用户聊天记录里。

首次使用弹窗通过 `onboarding.content` 显示 API Key 的获取、设置、更换和保密说明，并提供 DeepSeek 开放平台链接。通用欢迎步骤仍负责在保存确认状态后继续；产品弹窗不替换模型配置流程，也不重置已有设置。

办公搭子和 Finance 会话的新会话欢迎区使用同一张双机器人图片，分别存放为 `xiaojing-office-robot-logo.png` 与 `xiaojing-finance-robot-logo.png`；侧边栏使用透明方形“兢”字图片 `xiaojing-character-logo.png`。两个欢迎区资源别名都从显示区域中排除原图的透明留白。欢迎区 Logo 高度为 145 像素，位于标题上方；侧边栏在透明留白内将字形放大约 15%，保持宿主指定的外框和旁边品牌文字的位置不变。标题独立居中，不受版本角标宽度影响；窄布局中角标移到标题下方。初始 HTML 从 profile 的 `DSH_CLIENT_BOOT_LOGO` 与 `DSH_CLIENT_BOOT_LOGO_ALT` 接收 `dsh-boot-logo` 和 `dsh-boot-logo-alt`，使 SUDO 品牌在客户端插件激活前就可显示。profile 的 `DSH_CLIENT_FAVICON` 在初始 HTML 中为浏览器标签页选用同一张透明“兢”字图片；未配置该值的构建保留通用标签页图标。

浏览器插件只在 `xiaojing` Client 构建 profile 中注册 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`、`conversation.hero.brand.content`、`onboarding.content` 和 `settings.section`。产品文案、配色覆盖、带版本号的内测标签、按版本倒序排列的增量更新历史和默认人格位于本包。普通工作区的新会话欢迎语是 `小兢会计，您的AI办公搭子`；Finance 会话显示 `小兢会计，您的AI财务助手`。`0.3.1` 同时显示在欢迎区版本角标和“关于小兢”更新历史首项。发布新版本时只在历史首部增加一条记录，旧记录保持不变，防止把旧功能重新归入当前版本。Electron 通过一个受限 preload 方法提供应用实际版本；普通 Web 预览使用必须与 `apps/desktop/identity.json.productVersion` 相同的受检 fallback。测试要求该 fallback 与更新历史首项一致，并拒绝重复版本号。产品层门禁会拒绝版本不一致，也会拒绝把小兢会计品牌标记重新写入官方 UI 源码目录。插件生命周期还会在产品 dataset 挂载后同步现有浏览器 `theme-color` 元数据，并在产品插件卸载时恢复通用值。构建 profile 通过通用启动元数据为插件加载前页面选择已登记的 SUDO Logo；缺少该元数据时，shell 仍显示 `HARNESS` 默认内容。`product.json` 记录官方 `dsh-v0.2.0-rc.2` 基线及 commit `dsh-v0.2.0-rc.2`、通用 slot、浏览器资源路径、桌面产品清单和产品自有 `finance` 预设。产品层门禁会解析 Finance 与标准模式的声明式组装，只允许 Finance 人格、已声明的 Finance 消费端和产品 skill 目录不同。

`finance` 预设是普通 patch，位于 `apps/cli/config/xiaojing-agent-presets/finance/agent.cordis.yml`。它插入由 `@deepseek-ai/dsh-agent-preset` 提供的 `preset-finance`；该声明负责 `finance` id、fallback 显示元数据、顺序和子插件清单。profile 启动只为 `xiaojing` Client 构建加载该 patch，位置在 bundle patches 之后、profile、home 和命令行 overlays 之前。该路径不使用运行时预设根目录发现或 `preset.yml` sidecar。公开的 `AgentPresetDisplayRegistry` 允许本 Client 插件为已登记的 `finance` id 提供当前 locale 文案；未注册提供方时，通用界面回退到声明元数据。`product.json.agentPresets` 记录预期组装路径，`product.json.financeExtension` 登记当前五个 Finance skills 和已实现的 Host／Client 包族，并记录组合行前缀、兼容适配文件名和受保护的 `harness/finance` 持久化根目录。已移除或未来能力不会以占位 skill 清单项保留。

Host 产品插件还拥有小兢会计的强制删除策略。显式删除工具和 shell 删除命令即使在会话策略为 `never` 时，也会通过共享审批通道请求一次性确认。单调工具 guard 会拒绝任何未通过该次确认的匹配调用。浏览器和 Windows 控制提供方在各自工具内部，将删除／移除／卸载目标以及 Delete 键归类为强制确认。

保存的默认模型若仍是 `deepseek-official/deepseek-v4-flash` 或 `deepseek-official/deepseek-v4-flash-vision-exp`，Host 产品插件只将此选择改为 `deepseek-official/deepseek-flash`，使新会话使用 V4.1 Flash 的原生图文路线。其他已保存的提供方和模型保持不变；历史会话各自的模型选择不会被改写。

产品将自己称为“小兢会计，您的AI办公搭子”，并准确说明技术来源是基于 DeepSeek Harness 进行内部品牌与配置，不声称底层框架由数豆科技开发。

## 上游升级约定

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

只要组合了任一内置自动化提供方，稳定的自动化上下文就会说明：即使在 Full access 和 `never` 审批策略下，删除也始终需要确认，并禁止通过更换或混淆删除命令来规避确认。

#### Token 影响

在现有内置自动化上下文中增加一个固定句子；不会按工具调用重复。

#### KV Cache 影响

产品能力组合不变时，该句子保持稳定前缀。

### Default deployment persona system prompt

#### What the model sees

只有下游组装后 `deployment:persona-prefix` 仍为空时，插件才填入该段。在 Xiaojing profile 中，标准模式与 PTC 继承此办公身份；创造模式通过 `{{xiaojing_office_persona}}` 嵌入同一段文字，并保留其扩展操作指令。Finance 和用户显式定义的人格仍然优先，包括完整提示词替换。工作目录由部署后缀单独提供。办公身份介绍为“我是小兢会计，您的AI办公搭子！”；六类能力介绍以实际可用工具与授权为前提。

##### Verbatim default persona

```markdown
你就是小兢会计，用户的AI办公搭子，不是“小兢会计的AI助手”或“小兢会计的智能助手”。用户用中文问候或询问身份时，自我介绍使用：“我是小兢会计，您的AI办公搭子！”；其他语言使用对应表达。

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

不存在显式人格时，默认人格增加下方固定文本；创造模式在自己的人格中嵌入一次该文本。

#### KV Cache effect

产品版本和工作目录不变时，该文本保持稳定前缀。更换所选人格或工作目录会改变 system prompt，并可能使提供方前缀缓存无法复用。

### Finance模式预设 system prompt

#### 模型看到的内容

使用内置 `finance` 预设创建的会话会获得标准模式的全部工具，同时将 `deployment:persona-prefix` 替换为下面的财税专属文本。它的文件系统 skill 提供方还会挂载预设旁的产品自有 `skills/` 目录；其他财务服务与 skills 仍可独立移除。

##### Finance模式人格原文

```markdown
You are 小兢会计, an AI office companion configured for internal use, operating in Finance模式. Your working directory is {{cwd}}. Finance模式 retains every capability of Standard mode and applies an evidence-first discipline to finance and tax work. Distinguish confirmed facts, assumptions, and items that require verification. Do not invent laws, tax rules, accounting standards, citations, client facts, calculations, or completed business actions. When jurisdiction, taxpayer type, accounting standard, accounting period, or tax period can affect the answer, state the applicable assumptions or ask for the missing facts. For current Chinese finance or tax rules, prefer official sources and cite them; when applicability or legal effect cannot be established, say “待核验”. Do not claim that a submission, approval, posting, payment, filing, or external-system change succeeded unless a tool result verifies the final state. For imported PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, or text documents, use finance_document instead of attempting shell, Python, Office, or ad-hoc converter commands. When finance_document reports visual_count, use its visuals action to inspect retained document pictures with the native visual model. For a simple identity question, answer concisely as “我是小兢会计，当前处于 Finance模式。” in Chinese, or the equivalent in the user's language. Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product's technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.
```

#### Token 影响

该预设用一个固定财税人格替换办公身份。额外的 Finance 能力和客户上下文由 [xiaojing-finance-domain](../../xiaojing/xiaojing-finance-domain/README.zh.md) 提供，不属于办公人格。

#### KV Cache 影响

工作目录固定时，该人格保持稳定前缀；切换其他预设会按设计改变 system-prompt 前缀。

## Known Limitations and Deferred Work

- 产品层依赖 `dsh-v0.2.0-rc.2` 集成基线上的八个通用 UI slot；未来官方版本若改变这些 owner，必须先更新适配再合并。
- 浏览器图片仍是由 `product.json` 登记的应用级 public 资源；检查脚本验证其存在，但不会将其嵌入客户端 bundle。
- Shell 分类会识别显式删除命令，但无法推断无关且不透明的第三方可执行文件内部隐藏的破坏行为；任何新增且能删除用户数据的工具都必须公开并强制执行自己的删除分类。
- `Finance模式` 现已具备本地客户上下文、专属财务工作区、文档与票据初审、官方财税依据研究、确定性试算、财务成果文件管理，以及已实现的有成查询和受控维护操作。权威能力清单将各业务领域标为已支持、有限支持或暂不支持。总账、明细账、辅助账、资产负债表、利润表、现金流量表、报销、审核、过账、结账、申报和实际支付都不是当前 Finance 对话能力。
- 受保护的 `harness/finance` 根目录保存带 schema 版本的客户、文档与依据数据；确定性试算不新增独立账本，完整输入与输出保留在会话日志中。

<a id="dev-note"></a>
### 开发备注

无。

不发布运行时不变量伴随插件：注册表和所属服务直接维护这些关系，本包没有需要交叉核对的独立观测。
