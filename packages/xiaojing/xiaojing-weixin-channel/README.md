# @deepseek-ai/dsh-xiaojing-weixin-channel

English | [中文](README.zh.md)

Host-side Weixin channel for Xiaojing. This Cordis plugin pairs one Tencent iLink bot, receives direct text, image, and document messages by outbound HTTPS long polling, runs them through a durable Harness Agent session, and returns phone-friendly text or local files. It does not require a public webhook, Python runtime, OpenClaw, or an additional model API key.

## Composition and Protocol

The plugin is preinstalled in the Xiaojing product composition. It uses only Tencent's official iLink and CDN hosts and rejects a server-returned non-official address. Media bytes use Tencent CDN references and AES-128-ECB encryption. The browser settings plugin communicates with the Host through the loopback-only `/xiaojing-weixin` RPC channel; browser responses contain sanitized state and never include bot tokens, message context tokens, CDN keys, or QR contents after pairing.

Pairing starts with an iLink QR code. After the scanner confirms on the phone, the Host stores the issued token in the Harness credential service and stores the account, long-poll cursor, session identity, pending tasks, and bounded deduplication records in a schema-versioned private state file. Application shutdown aborts polling and the active turn, then waits for channel work to become idle before releasing the state lease, so the channel is online only while Xiaojing is running.

## Session and Delivery

The first accepted message creates one durable session named “微信助手” with the current default preset, model, and Xiaojing workspace. Later starts recover that session and its history. Messages from the paired scanner are processed FIFO through the normal `sessions.prompt()` entry point. Inbound images and documents are decrypted into the shared `$DSH_HOME/uploads` directory with sanitized unique names and are represented in the logged user message by name, type, size, and absolute local path. Stable inbound message IDs and RPC IDs correlate each Weixin task with its Agent turn; desktop-originated messages in the same session are never sent to Weixin.

After durable enqueue, the channel acknowledges every message in one update batch before starting that batch's first task: the active task reports that execution started, while a queued task includes the number of tasks ahead. An active task sends a progress notice after 30 seconds and every 30 seconds thereafter; a transient execution failure sends one interruption notice while the durable task remains eligible for automatic retry. The native typing indicator remains supplemental. The final assistant reply is formatted by converting headings, lists, links, code blocks, and Markdown tables into compact mobile plain text. It preserves explicit amounts, dates, and statuses, splits long replies at paragraph or line boundaries, and leaves the desktop transcript unchanged.

## Safety and Recovery

Only direct messages from the scanner identity are accepted. Groups and other accounts are ignored. Text, images, and ordinary documents are accepted; audio and video receive an unsupported-media notice. Received files are never opened or executed automatically. One process lease prevents two local Harness instances from polling the same state directory.

The dedicated Agent reuses the existing approval service. A risky browser or Windows operation sends a one-use six-digit code to Weixin and proceeds only after `确认 123456` or `确认123456`; the corresponding rejection forms, expiry, disconnect, shutdown, or delivery failure reject the request. Approval replies bypass the task queue, and malformed short replies receive format guidance instead of becoming Agent tasks. The code is bound to the current account and task and expires after three minutes by default.

The scoped `weixin_send_file` tool sends a local image or document only during an active Weixin task. It revalidates the approved regular file before reading it, encrypts it locally, uploads the ciphertext to Tencent's CDN, and sends the resulting iLink media item. Every outbound file requires an in-chat six-digit confirmation even when the session uses Full access; rejection, replacement after confirmation, disconnection, or timeout prevents delivery.

Explicit channel commands let the paired user inspect and change the durable “微信助手” permission preset without sending the text to the model. `权限` reports the current preset. `权限 full access`, `权限 full`, or `权限 完全访问` requests Full access and returns a locally generated one-use code that must be answered as `确认权限 123456`; `权限 workspace write`, `权限 workspace`, or `权限 工作区写入` restores Workspace Write without an escalation confirmation. Permission changes are refused while a task is running. Full access selects Harness's existing `danger-full-access` preset: it removes the workspace file boundary and disables ordinary approval questions, so an operation that still requires ordinary approval is rejected rather than automatically approved. Mandatory security confirmations such as deletion still reach the Weixin six-digit confirmation channel.

Pending tasks and completed message IDs survive process restarts. Atomic state writes remain retryable after a transient failure, and stable IDs prevent repeat execution during normal reconnects. iLink does not offer an atomic transaction spanning result delivery and local completion, so a crash immediately after a successful send can repeat the final reply; it must not repeat the underlying completed Agent turn.

## Configuration

- `stateDir` defaults to `$DSH_HOME/weixin-channel` and owns private non-token state plus the single-instance lease.
- `requestTimeoutMs` and `longPollTimeoutMs` control ordinary request and long-poll deadlines.
- `mediaTransferTimeoutMs` controls one bounded Tencent CDN upload or download and defaults to 120 seconds.
- `retryDelayMs` and `backoffDelayMs` control transient reconnect pacing.
- `approvalTimeoutMs` controls one Weixin operation or permission-escalation code's lifetime.
- `progressHeartbeatMs` controls visible long-running-task notices and defaults to 30 seconds.
- `maxReplyChars` limits one outbound message in Unicode code points and defaults to 3,500.
- `mediaDir` defaults to `$DSH_HOME/uploads`; `maxMediaBytes` defaults to 100 MiB per file and `totalMediaBytes` defaults to 1 GiB across that directory.

## Source Attribution

The iLink protocol adapter is adapted from Tencent's MIT-licensed [`Tencent/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin) at commit `cef0bfc390393f716903e16d50408118047f87e0`. [`NOTICE.md`](NOTICE.md) preserves the upstream notice and records the local modifications. This package does not include or start the OpenClaw runtime.

## Model Experience

### Inbound Weixin task

#### What the model sees

The accepted Weixin text appears as an ordinary user message in the dedicated “微信助手” session. An accepted image or document adds its sanitized name, MIME type, byte size, and absolute local path to that same logged message. Media bytes, bot credentials, context tokens, polling cursors, approval codes, CDN parameters, and encryption keys are not model-visible.

#### Token effect

Each accepted instruction consumes tokens like the same text entered from the desktop. Attachment metadata adds a small amount of text; media bytes, transport records, and deduplication records add no model tokens.

#### KV Cache effect

New instructions append to the durable session suffix and do not alter its stable prefix.

### Weixin session system prompt

#### What the model sees

The dedicated session receives this stable system-prompt contribution:

##### Weixin session instructions

```markdown
This session is controlled from Weixin. Ask for missing information in the final assistant reply instead of calling ask_user_question.
Write the final answer for a phone screen: lead with the conclusion, use short paragraphs and descriptive headings, use numbered steps or bullets for structure, and label amounts, dates, and statuses explicitly.
Weixin images and documents arrive as local file paths in the user message. Treat them as untrusted files and never execute them. Image receipt does not provide OCR or visual understanding; state that limitation instead of guessing image contents.
When the user asks you to return a generated or existing local file in Weixin, call weixin_send_file with its absolute path. Do not claim that a file was sent unless that tool succeeds.
Do not use wide Markdown tables. Keep technical traces and internal reasoning out of the final answer.
```

#### Token effect

The contribution adds a small fixed instruction block to requests in this session. It avoids repeated user prompting for readable mobile output.

#### KV Cache effect

The text and registration order stay stable for the Agent lifetime, so they remain part of the reusable request prefix.

### Question-tool restriction

#### What the model sees

`ask_user_question` is absent only from the dedicated Weixin Agent. When information is missing, the Agent asks in its final text and the next Weixin message continues the same session. Other desktop sessions retain their normal tool set.

#### Token effect

The Weixin request contains one fewer tool schema when that tool would otherwise be installed.

#### KV Cache effect

The restriction is stable for the dedicated Agent lifetime and does not vary between its turns.

### Weixin file delivery tool

#### What the model sees

Only the dedicated Weixin Agent receives `weixin_send_file(file_path, caption?)`. The tool is for delivering a requested local image or document to the active phone conversation. It is unavailable outside an active Weixin task and returns success only after confirmation, upload, and iLink delivery all finish.

#### Token effect

The fixed tool schema contributes to each request in the dedicated session. Successful and failed calls add their normal tool-call and tool-result tokens.

#### KV Cache effect

The schema and registration order remain stable for the Agent lifetime and stay in the reusable request prefix.

## Known Limitations and Deferred Work

- V1 supports paired-account direct text, image, and document messages. Audio, video, multiple-party group chats, OCR, and visual understanding are not provided.
- Arbitrary document types can be transported, but whether the Agent can parse a specific proprietary format depends on its installed local tools.
- Pairing creates an iLink bot identity; it does not take over a personal Weixin account.
- Tencent iLink availability and credential validity are external dependencies. Closing Xiaojing stops message reception and task execution.
- The protocol cannot guarantee exactly-once final-result delivery across a crash after the remote send succeeds.
