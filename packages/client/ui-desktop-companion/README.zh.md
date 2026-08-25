# @deepseek-ai/dsh-client-ui-desktop-companion

[English](README.md) | 中文

小兢会计 Windows 桌面宠物的专属设置界面。Client 插件注册“桌面小兢”设置栏目，并将原生操作委托给受限的 Electron preload bridge。它不创建原生窗口、不读取文件，也不拥有宠物任务状态。

## 组合与界面

该插件仅在 `xiaojing` 构建 profile 中注册 id 为 `desktop-companion`、order 为 `1000` 的 `settings.section`，使其位于设置导航最下方。页面显示角色预览、当前脱敏状态、活动任务数量、30%–100% 大小调节器，以及唤醒、收起和重置桌面位置的控制按钮。持久化偏好没有大小字段时，角色默认显示为原始尺寸的 50%。

唤醒会创建或显示宠物窗口。收起只销毁该窗口，应用、Host、活动任务和微信频道继续运行。重置会把宠物移到主显示器工作区右下角，并在必要时自动唤醒。页面通过与托盘和宠物窗口相同的 preload 订阅立即更新。

preload bridge 不存在时，页面只显示“桌面小兢仅在 Windows 桌面版中可用”，不渲染无效的原生操作按钮。这样普通浏览器预览能够准确表达能力范围，而不会模拟桌面行为。

## Electron Bridge

renderer 只能调用 `getCompanionState()`、`wakeCompanion()`、`tuckCompanion()`、`resetCompanionPosition()`、`setCompanionScale()`、`showMainWindow()` 和 `subscribeCompanionState()`。Client 会校验每一份返回快照，且不会获得 Node、文件系统、任意 IPC、BrowserWindow、会话内容或凭据访问能力。

## 模型体验

无。这个纯浏览器设置插件只渲染脱敏后的桌面状态，不注册任何面向模型的内容。

#### KV Cache 影响

没有直接影响；打开设置栏目或控制桌面宠物都不会改变模型请求。

## 已知限制与延期工作

- 原生控制必须通过小兢会计 Windows Electron preload bridge 才能使用。
- 设置页不提供动画、声音、角色定制、开机自启动或输入框。
- 整个应用退出后设置页也不再运行；必须重新启动应用，才能再次唤醒桌面宠物。
