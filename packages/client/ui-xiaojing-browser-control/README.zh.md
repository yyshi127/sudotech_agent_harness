# @deepseek-ai/dsh-client-ui-xiaojing-browser-control

[English](README.md) | 中文

小兢会计浏览器操控能力的界面展示插件。它注册名为“浏览器控制”的独立 `settings.section`，不会向“通用设置”添加条目，也不拥有浏览器进程或持久数据。

插件仅在 `xiaojing` Client 构建 profile 且来源为回环地址时启用。它将 Microsoft Edge 显示为固定的自动化浏览器，并说明 Edge 采用可见方式启动、最小化后继续执行协议级 DOM 操作，而且使用独立的持久登录 profile。

从产品组合移除本包即可删除设置入口，不需要修改 Harness UI 代码；同时移除 Host 浏览器操控插件即可删除工具。专用 profile 会保留在用户数据中，除非用户明确删除。

## 模型体验

无，因为这个纯浏览器设置插件只展示静态产品说明，不注册任何模型可见内容。

#### KV Cache 影响

无直接影响；打开这个设置页面不会改变模型请求。

## 已知限制与后续工作

- Edge 最小化后仍可继续执行协议级 DOM 自动化，但浏览器原生对话框和系统对话框仍需使用独立的电脑操控能力。
