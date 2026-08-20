# @deepseek-ai/dsh-client-xiaojing-product

[English](README.md) | 中文

构建在 DeepSeek Harness 之上的小兢会计产品层。Host 半侧提供默认部署人格；浏览器半侧通过通用 slot 提供品牌、主题、首页标语与初次使用说明。未加载本插件时，官方 UI 包仍显示默认 DeepSeek 界面。

## 产品贡献

浏览器插件注册 `sidebar.brand`、`conversation.hero.brand` 和 `onboarding.content`。产品文案、配色覆盖和默认人格位于本包。静态 Web 应用通过通用启动元数据为插件加载前页面选择已登记的 SUDO Logo；缺少该元数据时，shell 仍显示 `HARNESS` 默认内容。`product.json` 记录官方 rc.5 基线、通用 slot、浏览器资源路径和桌面产品清单。`scripts/verify-xiaojing-product-layer.mjs` 会拒绝把小兢会计品牌标记重新写入官方 UI 源码目录。

产品将自己称为“小兢会计，您的AI办公搭子”，并准确说明技术来源是基于 DeepSeek Harness 进行内部品牌与配置，不声称底层框架由数豆科技开发。

## 上游升级约定

上游升级从稳定 `main` 创建 `codex/upgrade-rcX` 分支，并合并经核对的官方 tag 或 commit。产品代码、品牌资源、桌面身份和计费逻辑保持不动。冲突只在通用 slot、rc 专属计费适配器、`apps/desktop/integration-patches.json` 列出的独立集成补丁，以及必要的原子数据迁移中处理。

只有产品层检查、聚焦行为测试、构建后 Web 回放、全新 Windows 安装和上一正式版覆盖升级检查全部通过，升级分支才能合并。无法读取或迁移上一版本数据的版本不得发布。

## Model Experience

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

## Known Limitations and Deferred Work

- 产品层依赖 rc.5 集成基线引入的三个通用 UI slot；未来官方版本若改变这些 owner，必须先更新适配再合并。
- 浏览器图片仍是由 `product.json` 登记的应用级 public 资源；检查脚本验证其存在，但不会将其嵌入客户端 bundle。
