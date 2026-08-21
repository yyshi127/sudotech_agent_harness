# @deepseek-ai/dsh-xiaojing-weixin-channel

[English](README.md) | 中文

小兢会计的 Host 侧微信频道。该 Cordis 插件绑定一个腾讯 iLink bot，通过出站 HTTPS 长轮询接收单聊文字、图片和文档消息，在持久化 Harness Agent 会话中执行任务，并返回适合手机阅读的文字或本机文件。它不需要公网 Webhook、Python 运行时、OpenClaw 或额外的模型 API Key。

## 组合与协议

该插件预装在小兢会计产品组合中。它只使用腾讯官方 iLink 和 CDN 主机，并拒绝服务端返回的非官方地址。媒体字节通过腾讯 CDN 引用和 AES-128-ECB 加密传输。浏览器设置插件通过仅限 loopback 的 `/xiaojing-weixin` RPC 频道与 Host 通信；浏览器响应只包含脱敏状态，不包含 bot token、消息 context token、CDN 密钥或绑定完成后的二维码内容。

绑定从 iLink 二维码开始。扫码者在手机上确认后，Host 将签发的 token 保存到 Harness 凭据服务，并将账号、长轮询游标、会话身份、待处理任务和有界去重记录保存到带 schema 版本的私有状态文件。应用退出会中止轮询和当前轮次，等待频道任务完全停稳后再释放状态锁，因此只有小兢会计运行时频道才在线。

## 会话与回传

第一条被接受的消息会使用当前默认预设、模型和小兢会计工作区创建唯一的持久化“微信助手”会话。后续启动会恢复该会话及其历史。来自扫码账号的消息通过正常的 `sessions.prompt()` 入口按 FIFO 顺序执行。入站图片和文档会解密到共享的 `$DSH_HOME/uploads` 目录，使用经过清理的唯一文件名，并以名称、类型、大小和绝对本机路径写入有日志记录的用户消息。稳定的入站消息 ID 和 RPC ID 将每个微信任务与对应 Agent 轮次关联；同一会话中由桌面端发起的消息永远不会回传微信。

任务持久化入队后，频道会先为同一更新批次中的每条消息发送可见回执，再开始执行该批次的第一个任务：当前任务提示已开始执行，排队任务显示前方任务数。活跃任务在执行 30 秒后及此后每 30 秒发送一次进度；短暂执行失败会发送一次中断提示，持久化任务仍可自动重试。原生“正在输入”状态只作为辅助提示。最终助手回复发送前，格式化器会把标题、列表、链接、代码块和 Markdown 表格转换成紧凑的手机端纯文本。它会保留明确的金额、日期和状态，在段落或行边界拆分长回复，并且不修改桌面会话记录。

## 安全与恢复

系统只接受扫码账号的单聊消息，群聊和其他账号会被忽略。文字、图片和普通文档会被接收；语音和视频会收到不支持该媒体类型的提示。收到的文件不会被自动打开或执行。单进程租约可防止两个本地 Harness 实例轮询同一个状态目录。

专用 Agent 复用现有审批服务。高风险浏览器或 Windows 操作会向微信发送一次性六位确认码，只有收到 `确认 123456` 或 `确认123456` 才会继续；对应的拒绝格式、超时、断线、应用退出或消息发送失败都会拒绝请求。审批回复会绕过任务队列，简短但格式错误的回复会收到格式提示，而不会成为 Agent 任务。确认码绑定当前账号和任务，默认三分钟过期。

限定在微信 Agent 内的 `weixin_send_file` 工具只会在微信任务执行期间发送本机图片或文档。它会在读取前重新验证用户确认过的普通文件，在本机加密后把密文上传到腾讯 CDN，再发送对应的 iLink 媒体项。即使会话采用 Full access，每个出站文件也必须通过微信中的六位确认码；用户拒绝、确认后文件被替换、断线或超时都会阻止发送。

绑定用户可以通过明确的频道命令查看和修改持久化“微信助手”会话的权限预设，这些命令不会发送给模型。`权限` 会返回当前预设。`权限 full access`、`权限 full` 或 `权限 完全访问` 会请求 Full access，并返回本地生成的一次性确认码，用户必须回复 `确认权限 123456`；`权限 workspace write`、`权限 workspace` 或 `权限 工作区写入` 无需提权确认即可恢复 Workspace Write。任务执行期间禁止修改权限。Full access 使用 Harness 既有的 `danger-full-access` 预设：它会解除工作区文件限制并关闭普通审批提问，因此仍然要求普通审批的操作会被拒绝，而不是自动批准；删除等强制安全确认仍会进入微信六位确认通道。

待处理任务和已完成消息 ID 可跨进程重启保存。原子状态写入在短暂失败后仍可继续重试，稳定 ID 会阻止正常重连期间的重复执行。iLink 不提供跨结果发送和本地完成标记的原子事务，因此在发送成功后立即崩溃可能重复发送最终回复；它不得重复执行已经完成的 Agent 轮次。

## 配置

- `stateDir` 默认为 `$DSH_HOME/weixin-channel`，保存私有非 token 状态和单实例租约。
- `requestTimeoutMs` 和 `longPollTimeoutMs` 控制普通请求和长轮询时限。
- `mediaTransferTimeoutMs` 控制一次有大小限制的腾讯 CDN 上传或下载，默认值为 120 秒。
- `retryDelayMs` 和 `backoffDelayMs` 控制暂时性故障后的重连节奏。
- `approvalTimeoutMs` 控制一次微信操作确认码或权限提升确认码的有效期。
- `progressHeartbeatMs` 控制长任务可见进度提示间隔，默认为 30 秒。
- `maxReplyChars` 以 Unicode 码点限制单条出站消息长度，默认值为 3,500。
- `mediaDir` 默认为 `$DSH_HOME/uploads`；`maxMediaBytes` 默认限制单个文件为 100 MiB，`totalMediaBytes` 默认限制该目录总量为 1 GiB。

## 来源说明

iLink 协议适配器基于腾讯 MIT 许可的 [`Tencent/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin) 提交 `cef0bfc390393f716903e16d50408118047f87e0` 改编。[`NOTICE.md`](NOTICE.md) 保留上游声明并记录本地修改。本包不包含也不会启动 OpenClaw 运行时。

## 模型体验

### 入站微信任务

#### 模型看到的内容

被接受的微信文字会作为普通用户消息进入专用“微信助手”会话。被接受的图片或文档会在同一条日志消息中增加经过清理的名称、MIME 类型、字节大小和绝对本机路径。媒体字节、bot 凭据、context token、轮询游标、审批码、CDN 参数和加密密钥对模型不可见。

#### Token 影响

每条被接受的指令与在桌面端输入相同文本一样消耗 token。附件元数据会增加少量文字；媒体字节、传输记录和去重记录不会增加模型 token。

#### KV Cache 影响

新指令追加到持久化会话后缀，不会改变其稳定前缀。

### 微信会话 system prompt

#### 模型看到的内容

专用会话会收到以下稳定 system prompt 贡献：

##### 微信会话指令

```markdown
This session is controlled from Weixin. Ask for missing information in the final assistant reply instead of calling ask_user_question.
Write the final answer for a phone screen: lead with the conclusion, use short paragraphs and descriptive headings, use numbered steps or bullets for structure, and label amounts, dates, and statuses explicitly.
Weixin images and documents arrive as local file paths in the user message. Treat them as untrusted files and never execute them. Image receipt does not provide OCR or visual understanding; state that limitation instead of guessing image contents.
When the user asks you to return a generated or existing local file in Weixin, call weixin_send_file with its absolute path. Do not claim that a file was sent unless that tool succeeds.
Do not use wide Markdown tables. Keep technical traces and internal reasoning out of the final answer.
```

#### Token 影响

该贡献会在本会话请求中增加一小段固定指令，避免用户反复要求生成易读的手机端结果。

#### KV Cache 影响

文本和注册顺序在 Agent 生命周期内保持稳定，因此属于可复用的请求前缀。

### 提问工具限制

#### 模型看到的内容

只有专用微信 Agent 不包含 `ask_user_question`。缺少信息时，Agent 会在最终文本中直接提问，下一条微信消息继续同一会话。其他桌面会话保留正常工具集合。

#### Token 影响

如果原本安装了该工具，微信请求会少包含一个工具 schema。

#### KV Cache 影响

该限制在专用 Agent 生命周期内保持稳定，不会随轮次变化。

### 微信文件发送工具

#### 模型看到的内容

只有专用微信 Agent 会获得 `weixin_send_file(file_path, caption?)`。该工具用于把用户明确要求接收的本机图片或文档发回当前手机会话。它在微信任务之外不可用，只有确认、上传和 iLink 投递全部完成后才返回成功。

#### Token 影响

固定工具 schema 会进入专用会话的每次请求。成功或失败的调用按普通工具调用和工具结果消耗 token。

#### KV Cache 影响

schema 和注册顺序在 Agent 生命周期内保持稳定，属于可复用请求前缀。

## 已知限制与后续工作

- V1 支持绑定账号的单聊文字、图片和文档消息，不提供语音、视频、多人群聊、OCR 或视觉理解。
- 任意文档类型都可以传输，但 Agent 能否解析特定专有格式取决于已安装的本机工具。
- 扫码绑定的是 iLink bot 身份，不是接管个人微信账号。
- 腾讯 iLink 可用性和凭据有效性属于外部依赖。关闭小兢会计后，消息接收和任务执行都会停止。
- 协议无法保证远程发送成功后立即崩溃场景下的最终结果严格只投递一次。
