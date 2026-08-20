# @deepseek-ai/dsh-client-ui-usage-accounting

[English](README.md) | 中文

本机用量 Remote 的浏览器展示插件。它在 `sidebar.footer.action` 增加当日摘要，在 `settings.section` 增加本月日历，但不拥有计费数据或凭据值。

## 组合

插件依赖通用侧边栏与设置 slot、locale、生成的 `remote.usageAccounting` 客户端以及 Host 转发事件。两个入口共享同一个可观察控制器。slot renderer 将该可观察源绑定为 `useUsage`；组件只接收框架生成的 hook、刷新回调和本地化文字。

控制器在 `usage-accounting/updated`、`credentials/updated` 和连接重置时刷新。响应乱序到达时，以较新的请求代次为准。

## 展示

展开的侧边栏显示 `今日已使用 <token> token · ¥<费用>`，其中 token 数量和费用加粗，收起后保留相同的无障碍标签。点击任一状态的控件会打开小型锚定浮层，准确展示缓存命中输入、缓存未命中输入和输出的 token 与费用，以及当日合计和未计价数量。设置导航增加“用量”，页面先在本机统计说明下方展示本月合计，再按周一开头的日历展示北京时间当前月份和每天的 token 与费用；开始统计前的日期显示“未统计”，保留但无法定价的 token 显示“未计价”。

界面使用整数运算将准确的纳元值四舍五入到分，并始终显示两位小数；保存的总额仍保留纳元精度。旧记录只有在 Host 用完全匹配的历史价格核验且重算总额一致后才恢复分类费用，否则显示“明细未统计”；浏览器自身不会套用今天的价格。token 缩写只影响展示，不改变保存的总数。

## Model Experience

None, as this browser-only plugin renders local accounting data and registers nothing model-facing.

#### KV Cache effect

No direct effect; opening or refreshing either view does not alter a model request.

## Known Limitations and Deferred Work

- 页面有意只公开当前月份和当前 API Key，不提供月份切换、图表、导出、余额或云同步。
- Remote 断开或失败时显示不可用状态，浏览器端不维护另一份独立计费账本。
