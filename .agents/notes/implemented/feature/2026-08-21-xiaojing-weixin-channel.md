# Agent Note: Xiaojing Weixin channel

Status: implemented

English | [中文](2026-08-21-xiaojing-weixin-channel.zh.md)

## Problem

Xiaojing users need to submit ordinary tasks and exchange working files from Weixin without exposing a public webhook, running a second Agent product, or installing a Python gateway. Tasks and attachment references must remain visible in the desktop transcript, remote high-risk actions and local-file disclosure must require in-chat consent, and phone replies must remain readable. Credentials, QR contents, message context tokens, CDN parameters, encryption keys, and polling state must not cross into the browser or model request.

## Decision

Two preinstalled Cordis plugins own the capability. `@deepseek-ai/dsh-xiaojing-weixin-channel` is the Host adapter for Tencent iLink pairing, long polling, durable queuing, Agent session bridging, approvals, and outbound formatting. `@deepseek-ai/dsh-client-ui-weixin-channel` registers the Xiaojing-only loopback settings section. Neither changes Agent Loop. The protocol implementation adapts the minimum required TypeScript from Tencent's MIT-licensed `openclaw-weixin` commit `cef0bfc390393f716903e16d50408118047f87e0`; it does not include OpenClaw or the Hermes Python adapter.

The Host fixes requests to Tencent's official iLink and CDN addresses. The bot token belongs to the Harness credential service. Account identity, owner identity, poll cursor, session ID, pending tasks with local attachment metadata, and completed message IDs belong to a schema-versioned private state file below `DSH_HOME`. Schema 1 text tasks migrate atomically to schema 2 with an empty attachment list. A state-directory lease allows one poller. Application teardown aborts pairing, polling, the current turn, and pending approvals, waits for channel work to become idle, then releases the lease, so the channel executes tasks only while Xiaojing is open.

## Protocol and state

Pairing exposes a Host-generated QR data image and sanitized lifecycle status over a loopback-only `/xiaojing-weixin` RPC channel. The browser can start, verify, cancel, disconnect, and inspect pairing without receiving token or context values. After phone confirmation, the scanner becomes the only accepted direct-message owner. Group traffic and other accounts are ignored; audio and video receive a fixed unsupported-media response.

Inbound images and documents use iLink media references and Tencent CDN AES-128-ECB transfer. The Host validates Tencent CDN authorities, bounds ciphertext before buffering, validates the AES key, decrypts locally, sanitizes the untrusted filename, and publishes a private regular file atomically under the same `$DSH_HOME/uploads` directory and 100 MiB per-file plus 1 GiB aggregate defaults as the upload manager. The durable task records only the local name, path, MIME type, size, and kind. The logged user message contains those references, not the media bytes or transport secrets; images are not converted into model image blocks because the active DeepSeek route is text-only.

Inbound tasks carry stable iLink or derived digest IDs. The queue persists `received` and `submitted` phases and runs FIFO. After the enqueue write succeeds, the channel acknowledges every message in one update batch before starting that batch's first task. Active work sends a progress heartbeat after 30 seconds and every 30 seconds thereafter; a transient execution failure sends one interruption notice while retaining the task for retry. Approval replies accept the spaced and unspaced six-digit forms and bypass FIFO so a task cannot block the reply that releases its approval. The native typing state is supplemental because clients may not render it. Completed IDs are bounded and suppress normal reconnect duplicates. State writes are atomic, and a transient failed write does not poison later writes. A crash after iLink accepts a final reply but before the local completion write can resend that reply because the remote protocol supplies no transaction covering both operations; the already completed Agent turn is not submitted again.

## Remote execution and approval

The first task creates one durable session titled “微信助手” with the deployment's current default preset, model, and workspace. Every later task uses normal `sessions.prompt()` and stable RPC correlation through `agent/inbox/claimed`, `assistant/message`, and `turn/end`. Only replies from Weixin-originated turns are sent remotely, so desktop messages in the same session remain desktop-only.

The Weixin Agent denies `ask_user_question` and asks for missing information in its final reply. It otherwise uses the same tools and risk classifiers as desktop sessions. The existing approval waterfall receives a higher-priority handler only for that Agent. A risky action sends a random six-digit code bound to the account and task; confirmation permits one action, while rejection, timeout, disconnect, shutdown, wrong account, or delivery failure rejects it.

The Agent-scoped `weixin_send_file` tool is available only during an active Weixin turn. It inspects an absolute regular-file path, sends the path, filename, and size in a one-use Weixin confirmation, and revalidates file identity after approval. It then encrypts the plaintext locally, requests an iLink upload destination, uploads only ciphertext to Tencent's CDN, and sends an image or document item with the active context token. This confirmation is channel-owned and remains mandatory under Full access, so the permission preset cannot silently authorize local-file disclosure.

Channel-owned permission commands are intercepted before model submission. `权限` reports the session preset, explicit Full access aliases create a local one-use `确认权限 123456` challenge, and explicit Workspace Write aliases downgrade immediately. Mutations are refused while an Agent task is active. The switch executes the existing `/permission` command, preserving its session events and live policy notification instead of adding a second permission writer. Full access therefore retains the upstream `danger-full-access` semantics: unrestricted file scope plus disabled ordinary approval questions, with ordinary approval-requiring actions rejected rather than implicitly granted. Mandatory security requests such as deletion continue through the same one-use Weixin confirmation answerer.

## Mobile text presentation

The dedicated system-prompt contribution requests a conclusion-first answer, short paragraphs, descriptive headings, lists, and explicit labels for amounts, dates, and statuses. It prohibits wide tables, internal reasoning, and technical traces in the final reply, identifies inbound paths as untrusted, forbids guessing image contents without OCR or vision, and directs requested file delivery through `weixin_send_file`. A deterministic outbound formatter then converts headings, bullets, numbered steps, quotes, links, code blocks, and Markdown tables into compact plain text. Long results split on paragraph and line boundaries with part numbers. The original Markdown remains unchanged in the desktop transcript.

## Alternatives considered

- **Automate a personal Weixin Web session.** This relies on unofficial page behavior, exposes personal-account state, and is substantially less stable than the available iLink bot API.
- **Embed OpenClaw or the Hermes Python gateway.** This adds another runtime, Agent process, configuration surface, and session store even though Harness already owns those responsibilities.
- **Use a webhook.** A webhook requires public ingress, certificates, and deployment configuration. iLink long polling uses outbound HTTPS and fits the desktop lifecycle.
- **Keep approvals on the desktop only.** A remote task would stall without a person at the computer and could not fail closed after disconnection. Reusing the approval request with a one-use Weixin code preserves the existing risk decision while moving only the response channel.
- **Return raw model Markdown.** Weixin plain text makes wide tables, nested Markdown, and long answers difficult to read. A stable prompt plus deterministic conversion gives predictable mobile output without a second renderer or rich-message protocol.
- **Send local paths as text and let the phone retrieve them.** Phone Weixin cannot access desktop-local paths, and exposing an HTTP file server would add inbound network access. Encrypted iLink CDN upload keeps the desktop outbound-only and uses the existing conversation.
- **Convert inbound images into model image blocks.** The current DeepSeek route accepts text content only and rejects `image_url`. Saving a path without claiming visual understanding preserves transport now and leaves OCR or a future multimodal route as a separate capability.

## Verification

Protocol and media tests cover QR pairing, verification, official-host enforcement, long polling, bounded CDN downloads, AES key variants, decryption, sanitized unique storage, quotas, encrypted upload, image and document items, file replacement, sending, typing, timeouts, and retry classification. State tests cover atomic persistence, schema-1 migration, schema rejection, lease ownership, and recovery. Formatter tests cover headings, lists, tables, links, code, Unicode-safe chunking, and size limits. Assembled fake-iLink tests cover visible receipts, progress heartbeat, FIFO tasks, duplicate suppression, Agent-turn correlation, risky approvals, permission changes, inbound document prompts, outbound-file confirmation before upload, formatted replies, and durable completion without real network access or model charges. Client tests cover profile and loopback gating, lifecycle rendering, countdowns, verification, action serialization, and sensitive-field exclusion.

## Consequences

One Xiaojing installation can bind one iLink bot and expose a durable text, image, and document task channel while the application is running. Users see the same task and attachment-reference history on desktop and receive structured text or confirmed local files on the phone. The feature depends on Tencent iLink availability and does not take over a personal account, process ordinary groups, perform OCR or visual understanding, support audio or video, or guarantee exactly-once reply delivery across the remote-send crash window. Host protocol, media storage, Agent bridging, presentation, and product composition remain independently replaceable from Harness core.
