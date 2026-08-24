# @deepseek-ai/dsh-client-ui-xiaojing-browser-control

[English](README.md) | 中文

小兢会计的可移除 Microsoft Edge 自动化 Client 设置插件。只有 `DSH_CLIENT_BUILD_PROFILE=xiaojing` 且 Client 连接属于 loopback 时，插件才会注册一个 `settings.section`。删除 Web 组合中的配置项即可移除该页面，不需要修改 Host 工具或官方设置 owner。

页面展示两条路线：

- 小兢专用 Edge 无需扩展设置即可使用，并显示延迟启动的 Playwright 运行时处于待命还是运行状态。
- 个人 Edge 属于可选增强，页面提供解压扩展安装步骤、扩展 ID 与版本、短期配对、连接状态和撤销授权。

`BrowserControlController` 只能调用 `/xiaojing-browser-control` loopback RPC，并会在更新可观察视图前验证每个状态响应。浏览器不会获得长期密钥、CDP 载荷、网页内容、profile 路径、文件路径或浏览器目标。按钮只能通过固定 Host 动作打开本地 Edge 扩展管理页和随包扩展目录，不能提交任意命令或路径。

页面只使用宿主语义主题 token，不会修改产品全局样式。页面生命周期负责状态轮询和配对倒计时，设置分区卸载时会清理二者。

## 验证

聚焦 Client 测试覆盖小兢与 loopback 注册限制、专用路线展示、个人路线设置控件、配对码展示、已连接元数据、撤销授权、无效协议响应和 slot dispose。Host 协议和真实 Playwright 行为由 `@deepseek-ai/dsh-xiaojing-browser-control` 测试负责。

## 模型体验

无，因为本 Client 包只配置独立的 Host 能力，不提供任何模型可见的提示词、工具或结果。

#### KV Cache 影响

无；模型侧语义协议以及由此进入提供方请求的内容均由 Host `browser_control` 包负责。

## 已知限制与延后工作

- 个人 Edge 需要用户手动加载一次解压扩展并完成配对；普通未受管理的 Windows 安装不能静默安装该扩展。
- 设置页不能代替用户在真实网站上执行验收。连接状态只证明本地桥接已完成认证，任务执行过程仍在所属会话中展示。
- Edge Add-ons 或企业策略分发延后处理。移除 Client 包只会移除本设置分区，不会自动撤销 Host 已保存的凭据。
