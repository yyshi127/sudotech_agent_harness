# 用户审批

[English](approval.md) | 中文

[dsh-user-approval](../../packages/interaction/user-approval) 的用户审批 seam 回答一个问题：这个具体操作是否可以继续？它拥有共享的请求/结果词汇、`ctx.approval` 分发服务、`approval/request` 应答者 waterfall（瀑布式事件）、仅记录日志的审计事件对，以及按会话的 `ask`/`never` 策略。UI 通道可以提供人类应答者；[ACP（Agent Client Protocol）自动化桥接层](../../packages/acp/acp)为其拥有的 agent（智能体）提供一次性机器决策。调用方如 [dsh-tools](../../packages/core/tools) 和 [dsh-tool-bash](../../packages/shell/tool-bash) 消费闭合的结果，除非结果为 `allowed-once`，否则一律拒绝。

源码：[`packages/interaction/user-approval/src/index.ts`](../../packages/interaction/user-approval/src/index.ts)

## 标识与结果

每个请求都会获得一个全新的 `ApprovalRequestId`。该品牌类型将 `approval/asked` 与 `approval/decided` 审计事件配对，同时不会让审批 id 与工具调用 id 或 agent/会话 id 互换。

```ts type-equiv
/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome` 是闭合的，且失败时拒绝。`allowed-once` 仅授权所询问的那一个操作；调用方对 `rejected`、`cancelled` 和 `unavailable` 均执行拒绝。缺失、不负责该请求、抛异常或不合规的应答者会产生 `unavailable`，而非放行。

```ts type-equiv
/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

`ApprovalAnswer` 为应答者增加同会话选项，不扩展消费方结果。只有可信请求方代码可提供 `ApprovalReuse`；操作类别与精确目标范围标识授权，标签仅用于解释。`ApprovalAuthorization` 记录创建或复用及所属 Session，复制历史不会授予其他 Session 权限。

```ts type-equiv
/** Answerer choice; session authorization is normalized to an allowed-once outcome. */
type ApprovalAnswer = ApprovalOutcome | 'allowed-session'
```

```ts type-equiv
/** Host-defined operation class and target scope eligible for session authorization. */
interface ApprovalReuse {
  /** Namespaced operation category assigned by trusted requester code. */
  readonly category: string
  /** Exact target scope assigned by trusted requester code; never supplied by the model. */
  readonly scope: string
  /** Human-readable operation and target scope. */
  readonly label: string
  /** Localized presentation only; not part of authorization identity or audit. */
  readonly displayLabel?: { readonly en: string; readonly [locale: string]: string }
}
```

```ts type-equiv
/** Durable authorization identity; localized presentation is omitted. */
type ApprovalReuseAudit = Pick<ApprovalReuse, 'category' | 'scope' | 'label'>
```

```ts type-equiv
/** Records creation or reuse of an authorization owned by one session. */
interface ApprovalAuthorization extends ApprovalReuseAudit {
  /** Owning session; copied history cannot authorize a different session. */
  readonly sessionId: SessionId
  /** A human or machine selected session authorization, or an existing grant was reused. */
  readonly kind: 'session' | 'reuse'
}
```

创建与复用是已有审计事件的可选字段，结果保留原有四种值。同类并发请求等待首个决定提交；当前对象的授权在决定追加成功后可复用。重开只恢复原本已关闭轮次的授权，排除合成的 `interrupted` 与 `forked` 关闭标记。普通 `never` 在复用前拒绝；强制确认的消费方必须显式提供分类，未分类请求始终逐次决定。

## 按会话策略

`ApprovalPolicy` 决定在交互式应答者运行之前发生什么。`ask` 委托给组合的应答者链，链的无应答默认值为 `unavailable`；`never` 确定性地返回 `rejected`，不分发任何应答者。生效值为会话日志中最后一条 `approval/policy` 事件，回退到服务配置。消费方通过 `ctx.approval.effectivePolicy(session)` 读取；`setApprovalPolicy(session, policy)` 是唯一的写入路径，因此回放能重建覆盖值。

```ts type-equiv
/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone for an ordinary request: every ordinary
 *   ask resolves `'rejected'` deterministically. Mandatory security
 *   confirmations use {@link ApprovalService.requestMandatory} instead.
 * Explicit product-owned automatic authorization overrides either policy;
 * products must derive it from a logged user choice, never from this config.
 */
type ApprovalPolicy = 'ask' | 'never'
```

两种策略都会将各自完整的当前含义贡献给缓存安全的运行时上下文快照。带来源的 `user/message` 是持久化且模型可见的输入；审批状态变化时，会在保留的历史后追加一份新的完整快照，而不触碰承载渲染后系统提示词的 `system/message` 节点。

产品可从已记录的用户选择中派生明确的自动授权，并调用 `setAutomaticApproval(session, enabled)`。启用后，普通和强制请求不再弹出审批，仍提交 `allowed-once` 审计决定；启用时也会处理当前待审批请求。提交前撤销授权会拒绝自动决定，取消请求始终优先。该授权不会改变 `ApprovalPolicy`、创建可复用的操作分类授权，或授予浏览器与操作系统权限。

## 审批请求

`ApprovalRequest` 以足够精确的方式标识 agent 和工具操作，以便路由和审计该问题。它有意省略工具参数：应答者通过 `callId` 将提示附加到已流式输出的工具调用上，而非渲染另一份可能漂移的副本。可选的 `displayReason` 向界面传递请求方提供的本地化字符串；`reason` 仍是审计文本。

```ts type-equiv
/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
interface ApprovalRequest extends ApprovalRequestEvent {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: ToolCallId
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}
```

## 分发与审计

`ctx.approval.request(req)` 要求发起请求的会话处于一个尚未结束的轮次内。它追加 `approval/asked`，获取一个结果，追加对应的 `approval/decided`，然后以该结果完成。`never` 策略在服务内部、waterfall 分发之前强制执行，因此即使后来以 `prepend` 注册的应答者也无法绕过它。应答者在负责处理该请求时返回结果，否则调用 `next()` 委托；第一个应答占据唯一的决策槽位。

审计事件仅写入日志，不进入模型 transcript（文本记录）。模型可见的行为是调用方派生的工具结果与当前运行时上下文快照，只有存在有效授权时才陈述会话复用。服务 dispose（资源释放）时取消并等待活跃及排队问题结算，再移除上下文贡献；应答者监听器独立地通过 effect 绑定到其所属插件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxapproval--approvalservice"></a>

### `ctx.approval` — `ApprovalService`

Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session. It exposes deterministic policy changes to the model through the runtime-context snapshot and switch notices.

```ts cordis-catalog
/**
 * Switch one live agent's policy and queue the transition for its next model
 * step. Session initialization uses {@link setApprovalPolicy} directly
 * because there is no previously visible policy to change.
 * @param agent - the live agent whose policy is changing.
 * @param policy - the new effective policy.
 */
setPolicy(agent: Agent, policy: ApprovalPolicy): void

/**
 * Project explicit, logged user authorization into this service. The owning
 * product must restore and revoke this value from its session history;
 * calling this method alone does not persist authorization. Enabling settles
 * pending questions and overrides both ordinary `never` and mandatory asks.
 * Cancellation and failed audit commits still prevent execution.
 * @param session - the exact session authorized by the product.
 * @param enabled - whether its explicit automatic authorization is effective.
 */
setAutomaticApproval(session: Session, enabled: boolean): void

/**
 * Ask the composed answerers to decide one readonly same-process request.
 * The service borrows the agent, session, and readonly request data. Answerers
 * receive a request projection with cancellation combined with service disposal.
 * The request requires an open turn because the audit pair must identify
 * its action's turn; an idle ask rejects before
 * appending anything. The answerer phase always produces an outcome: an
 * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
 * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
 * normalized to `'unavailable'`. A failure that prevents either audit append
 * from committing still rejects because returning an unlogged decision would
 * violate the pair. Session contains post-commit observer failures, so an
 * authoritative append cannot reject the request or suppress its matching
 * audit event.
 * Trusted requester classifications may reuse an explicitly authorized
 * operation class and target scope within this session, including after a
 * restart. Unclassified requests remain one-shot. Creation and reuse are
 * audited; cancellation, disposal, and failed audit commits cannot create
 * authorization. Session policy is checked before reuse and after an answer.
 * @param req - the pending decision (agent, tool identity, reason, signal, optional classification).
 * @returns the closed outcome; `'allowed-once'` is the only grant.
 * @throws when no turn is open or either audit event fails before the session
 *   append commit point.
 */
async request(req: ApprovalRequest): Promise<ApprovalOutcome>

/**
 * Ask for a security confirmation that the session's ordinary approval
 * policy cannot suppress. Explicit product-owned automatic authorization
 * applies to these requests too. This method is reserved for product security
 * invariants such as deletion confirmation; it does not grant the action
 * and still fails closed when no answerer is available, the user rejects,
 * or the request is cancelled. Audit and turn-enclosure behavior are the
 * same as {@link request}. A trusted classification explicitly supplied by
 * the security consumer may reuse session authorization; omission requires
 * a separate answer for each action.
 * @param req - the mandatory decision (agent, tool identity, reason, signal).
 * @returns the closed outcome; `'allowed-once'` is the only grant.
 * @throws when no turn is open or either audit event fails before the session
 *   append commit point.
 */
async requestMandatory(req: ApprovalRequest): Promise<ApprovalOutcome>

/**
 * Read the session override without applying the configured default.
 * @param session - session whose log supplies the override.
 * @returns the last logged policy, or `undefined` without one.
 */
overrideOf(session: Session): ApprovalPolicy | undefined
```

Types: [Agent](core.zh.md) · [Session](session.zh.md)

Source: [`packages/interaction/user-approval/src/index.ts`](../../packages/interaction/user-approval/src/index.ts)

<a id="approval-events"></a>

### `approval/*` events

<a id="approvalrequest--waterfall"></a>

#### `approval/request` — waterfall

Ask composed answerers for one decision. Return an outcome to claim the request or call `next()` to delegate. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Ask composed answerers for one decision. Return an outcome to claim the
 * request or call `next()` to delegate. Scope-filtered dispatch
 * (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param req - pending approval request.
 * @mode waterfall
 */
'approval/request'( this: Scoped<Agent>, req: ApprovalRequestEvent, next: () => Promise<ApprovalAnswer>, ): Promise<ApprovalAnswer>
```

Types: [Agent](core.zh.md) · [Scoped](scope.zh.md)

Source: [`packages/interaction/user-approval/src/types.ts`](../../packages/interaction/user-approval/src/types.ts)
<!-- END GENERATED cordis-surface -->
