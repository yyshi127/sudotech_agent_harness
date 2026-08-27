# @deepseek-ai/dsh-client-xiaojing-product

[English](README.md) | 中文

构建在 DeepSeek Harness 之上的小兢会计产品层。Host 半侧提供默认部署人格；浏览器半侧通过通用 slot 提供品牌、主题、首页标语、初次使用说明与产品关于页。未加载本插件时，官方 UI 包仍显示默认 DeepSeek 界面。

## 产品贡献

浏览器插件只在 `xiaojing` Client 构建 profile 中注册 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`、`conversation.hero.brand.content`、`onboarding.content` 和 `settings.section`。产品文案、配色覆盖、带版本号的内测标签、版本功能清单和默认人格位于本包。Electron 通过一个受限 preload 方法提供应用实际版本；普通 Web 预览使用必须与 `apps/desktop/package.json` 相同的受检 fallback。产品层门禁会拒绝版本不一致，也会拒绝把小兢会计品牌标记重新写入官方 UI 源码目录。插件生命周期还会在产品 dataset 挂载后同步现有浏览器 `theme-color` 元数据，并在插件卸载时恢复通用值。构建 profile 通过通用启动元数据为插件加载前页面选择已登记的 SUDO Logo；缺少该元数据时，shell 仍显示 `HARNESS` 默认内容。`product.json` 记录官方 `dsh-v0.1.1-rc.2` 基线、通用 slot、浏览器资源路径、桌面产品清单，以及显示为 `Finance模式` 的产品自有 `finance` 预设。产品层门禁会解析 Finance 与标准模式组装，只允许 Finance 人格和清单登记的产品 skill 根目录不同。

`finance` 预设位于 `apps/cli/config/xiaojing-agent-presets/`，profile 启动只为 `xiaojing` Client profile 增加该根目录，官方预设根目录保持不变。本 Client 插件通过通用 `AgentPresetDisplayRegistry` 提供 Finance 的本地化显示文案，因此官方预设界面不包含产品 id 或产品文字。`product.json.financeExtension` 登记 Finance skills，并负责未来 Finance 包名前缀、组合行前缀、兼容适配文件名和受保护的 `harness/finance` 持久化根目录。Host 与 Client 包清单在出现服务型财务能力前保持为空；纯指令 skill 不需要空的占位包。

Host 产品插件还拥有小兢会计的强制删除策略。显式删除工具和 shell 删除命令即使在会话策略为 `never` 时，也会通过共享审批通道请求一次性确认。单调工具 guard 会拒绝任何未通过该次确认的匹配调用。浏览器和 Windows 控制提供方在各自工具内部，将删除／移除／卸载目标以及 Delete 键归类为强制确认。

产品将自己称为“小兢会计，您的AI办公搭子”，并准确说明技术来源是基于 DeepSeek Harness 进行内部品牌与配置，不声称底层框架由数豆科技开发。

## 上游升级约定

上游升级从稳定 `main` 创建 `codex/upgrade-rcX` 分支，并合并经核对的官方 tag 或 commit。产品代码、品牌资源、桌面身份和计费逻辑保持不动。冲突只在通用 slot、rc 专属计费适配器、`apps/desktop/integration-patches.json` 列出的独立集成补丁，以及必要的原子数据迁移中处理。

只有产品层检查、聚焦行为测试、构建后 Web 回放、全新 Windows 安装和上一正式版覆盖升级检查全部通过，升级分支才能合并。无法读取或迁移上一版本数据的版本不得发布。

## 中国财税官方来源核验

产品自有 `china-tax-official-research` skill 要求 Finance模式在形成依赖规则的结论前，先识别适用地区、纳税人事实、交易事实、会计或纳税期间和答案对应日期。它复用现有 `web_search` 工具，依次优先使用国家法律法规数据库、中国政府网、国家税务总局政策法规库、财政部及经核验的适用地方机关来源。它会区分法律效力、时效状态和与问题的关联程度，要求给出官方直达链接和文件元数据，并把缺少官方正文、现行效力或适用性证据的事项标为 `待核验`。

该 skill 不保存法规正文，不建设爬虫或 RAG 索引，也不启用通用 HTTP 抓取。搜索摘要不能被当作完整条文；官方结果不足以支持结论时，回答必须保持非确定性。删除清单项、预设 skill 目录和自定义根即可移除该能力，不修改 Harness 核心包或用户数据。

## Model Experience

### 强制删除指令

#### 模型看到的内容

只要组合了任一内置自动化提供方，稳定的自动化上下文就会说明：即使在 Full access 和 `never` 审批策略下，删除也始终需要确认，并禁止通过更换或混淆删除命令来规避确认。

#### Token 影响

在现有内置自动化上下文中增加一个固定句子；不会按工具调用重复。

#### KV Cache 影响

产品能力组合不变时，该句子保持稳定前缀。

### Default deployment persona system prompt

#### What the model sees

只有下游 system-prompt 组装后 `deployment:persona` 仍为空时，插件才填入该段；显式选择或用户创建的 agent 人格始终优先。填入后，模型会看到下面的默认产品身份与来源说明，其中 `{{cwd}}` 由 system-prompt 服务解析。

##### Verbatim default persona

```markdown
You are 小兢会计, an AI office companion configured for internal use. Your working directory is {{cwd}}. For a simple identity question, answer concisely as “我是小兢会计，您的 AI 办公搭子。” in Chinese, or the equivalent in the user's language. Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product's technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.
```

#### Token effect

仅在不存在其他部署人格时，默认人格才增加一个固定的 system-prompt 段。

#### KV Cache effect

产品版本和工作目录不变时，该文本保持稳定前缀。更换所选人格或工作目录会改变 system prompt，并可能使提供方前缀缓存无法复用。

### Finance模式预设 system prompt

#### 模型看到的内容

使用内置 `finance` 预设创建的会话会获得标准模式的全部工具，同时将 `deployment:persona` 替换为下面的财税专属文本。它的文件系统 skill 提供方还会挂载预设旁的产品自有 `skills/` 目录；其他财务服务与 skills 仍可独立移除。

##### Finance模式人格原文

```markdown
You are 小兢会计, an AI office companion configured for internal use, operating in Finance模式. Your working directory is {{cwd}}. Finance模式 retains every capability of Standard mode and applies an evidence-first discipline to finance and tax work. Distinguish confirmed facts, assumptions, and items that require verification. Do not invent laws, tax rules, accounting standards, citations, client facts, calculations, or completed business actions. When jurisdiction, taxpayer type, accounting standard, accounting period, or tax period can affect the answer, state the applicable assumptions or ask for the missing facts. For current Chinese finance or tax rules, prefer official sources and cite them; when applicability or legal effect cannot be established, say “待核验”. Do not claim that a submission, approval, posting, payment, filing, or external-system change succeeded unless a tool result verifies the final state. For a simple identity question, answer concisely as “我是小兢会计，当前处于 Finance模式。” in Chinese, or the equivalent in the user's language. Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product's technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.
```

#### Token 影响

该预设用一个固定财税人格替换标准模式人格，不会按请求注入财税目录、客户档案或法规全文。

#### KV Cache 影响

工作目录固定时，该人格保持稳定前缀；切换其他预设会按设计改变 system-prompt 前缀。

## Known Limitations and Deferred Work

- 产品层依赖 `dsh-v0.1.1-rc.2` 集成基线上的六个通用 UI slot；未来官方版本若改变这些 owner，必须先更新适配再合并。
- 浏览器图片仍是由 `product.json` 登记的应用级 public 资源；检查脚本验证其存在，但不会将其嵌入客户端 bundle。
- Shell 分类会识别显式删除命令，但无法推断无关且不透明的第三方可执行文件内部隐藏的破坏行为；任何新增且能删除用户数据的工具都必须公开并强制执行自己的删除分类。
- `Finance模式` 提供标准模式工具、财税核验行为和中国财税官方来源研究，尚未提供客户上下文、本地法规库、文档提取、确定性计算器、有成工作流、SDOO 集成或合规风险发现。
- 受保护的 `harness/finance` 根目录预留给带 schema 版本的 Finance 插件数据；当前基础层不会创建或写入该目录。
