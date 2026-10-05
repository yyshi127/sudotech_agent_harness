/**
 * Service Definition for the approval capability seam, covering requests, cancellation, audit, and per-session policy. Missing
 * answerers fail closed; trusted operation classifications support authorization within one session.
 * @module @deepseek-ai/dsh-user-approval
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'user-approval': { kind: 'user-approval' } & ContextFormed
  }
}

import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    approval: ApprovalService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's approval policy was switched — log-only, durable,
     * replayable, never in the model transcript (the model learns the policy
     * from the runtime-context snapshot and live switch notices). The LAST
     * such event is the session's override.
     * `source: 'delegation'` marks an override seeded into a child; an absent
     * source is a runtime switch.
     */
    'approval/policy': {
      policy: ApprovalPolicy
      /** Marks an override seeded into a child at delegation. */
      source?: 'delegation'
    }
  }
}

import { ApprovalRequestId } from './types.ts'
import type { ApprovalAnswer, ApprovalAuthorization, ApprovalOutcome, ApprovalRequestEvent, ApprovalReuse, ApprovalReuseAudit } from './types.ts'

export { ApprovalRequestId } from './types.ts'
export type { ApprovalAnswer, ApprovalAuthorization, ApprovalOutcome, ApprovalReuse, ApprovalReuseAudit } from './types.ts'

/** Accepted answerer choices; request consumers still receive ApprovalOutcome. */
const ANSWERS: readonly ApprovalAnswer[] = ['allowed-once', 'allowed-session', 'rejected', 'cancelled', 'unavailable']

/** Omit localized presentation from durable approval classification. */
function auditReuse(reusable: ApprovalReuse): ApprovalReuseAudit {
  return { category: reusable.category, scope: reusable.scope, label: reusable.label }
}

/** Await service-owned work until either request or service cancellation. */
async function cancellable<T>(pending: Promise<T>, signal: AbortSignal, cancelled: T): Promise<T> {
  if (signal.aborted) return cancelled
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); resolve(cancelled) }
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error('approval decision failed', { cause: error }))
      },
    )
  })
}

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
export type ApprovalPolicy = 'ask' | 'never'

/** Every {@link ApprovalPolicy}, for option advertisement and runtime validation of untrusted policy strings. */
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['ask', 'never']

/** Model-facing statement for the deterministic `'never'` policy. */
const NEVER_SENTENCE = 'Ordinary approval prompts are disabled in this session: actions that require ordinary approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`). Mandatory security confirmations, including deletion confirmation, still require the user to approve each action.'
/** Model-facing statement for an interactive policy that may still fail closed. */
const ASK_SENTENCE = 'Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.'
/** Model context changes only when this session has an effective reusable authorization. */
const AUTHORIZED_ASK_SENTENCE = 'Approval policy: ask. A user-approved operation class and target scope may reuse authorization only within this session. Other requests require a separate decision through the configured answerers and fail closed without an available answerer.'
/** Ordinary never remains deterministic; unclassified mandatory confirmations remain per action. */
const AUTHORIZED_NEVER_SENTENCE = 'Ordinary approval prompts are disabled in this session: actions that require ordinary approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`). Mandatory security confirmations still apply; only trusted operation classes and target scopes explicitly authorized in this session can reuse approval. Unclassified confirmations, including deletion confirmation, require approval for each action.'
/** Explicit user authorization supplied by the owning product from logged session intent. */
const AUTOMATIC_SENTENCE = 'The user enabled automatic approval for this session. Ordinary and mandatory tool approvals are granted automatically, including deletion, upload, and submission. Do not ask again for the same authorization. When an ordinary application confirmation is observed and can be operated through available tools, confirm it as needed to complete the authorized task. Browser connection permission and operating-system administrator privileges still require their own supported authorization; do not claim that this session mode grants them.'

/**
 * Whether the log currently sits inside an open turn (a `turn/start` not yet
 * closed by a `turn/end`) — the {@link ApprovalService.request} precondition.
 * The audit pair must be turn-enclosed so history identifies its live action
 * and whether that turn ended before restart. Persistence retains valid
 * interrupted history; only originally closed turns restore authorization.
 */
function hasOpenTurn(session: Session): boolean {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const type = session.eventAt(SessionSeq(seq))?.type
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

/**
 * Append the sole durable representation of a session policy override. Invalid
 * values throw before the log changes; consumers fold the new value on each read.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void {
  if (!APPROVAL_POLICIES.includes(policy)) {
    throw new TypeError('approval policy must be one of "ask" or "never"')
  }
  session.append('approval/policy', { policy })
}

/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
export interface ApprovalRequest extends ApprovalRequestEvent {
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

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default {@link ApprovalPolicy} for sessions without an
   * `approval/policy` override — `'ask'` delegates to the composed answerers
   * (fail-closed with none); `'never'` auto-rejects every ask without
   * prompting (the deterministic CI/unattended stance).
   */
  readonly policy?: ApprovalPolicy
}

/**
 * Approval service that applies session policy before answerers and logs every
 * ask/outcome pair to the requesting session. It exposes deterministic policy
 * changes to the model through the runtime-context snapshot and switch notices.
 */
export class ApprovalService extends Service {
  private readonly stopped = new AbortController()
  private readonly pending = new Set<Promise<ApprovalOutcome>>()
  private readonly queues = new WeakMap<Session, Map<string, Promise<void>>>()
  private readonly liveGrants = new WeakMap<Session, Set<string>>()
  private readonly automatic = new WeakSet<Session>()
  private readonly waiting = new WeakMap<Session, Set<() => void>>()
  static Config: z<Config> = z.object({
    policy: z.union(['ask', 'never'] as const).default('ask'),
  })

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'approval')

    ctx.effect(() => async () => {
      this.stopped.abort()
      await Promise.allSettled(this.pending)
    })

    const effective = (agent: Agent): ApprovalPolicy => this.effectivePolicy(agent.session)

    // The complete current value travels after retained history, so switching
    // policy does not rewrite the stable system-prompt cache prefix.
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'approval:policy',
        order: scope.systemPrompt.getContextOrder('APPROVAL_POLICY'),
        text: (context) => {
          const agent = context.agent
          // A bare assemble() (tests, diagnostics) has no session to state.
          if (agent === undefined) return ''
          if (this.automatic.has(agent.session)) return AUTOMATIC_SENTENCE
          const policy = effective(agent)
          if (this.hasAuthorization(agent.session)) return policy === 'never' ? AUTHORIZED_NEVER_SENTENCE : AUTHORIZED_ASK_SENTENCE
          return policy === 'never' ? NEVER_SENTENCE : ASK_SENTENCE
        },
      })
    })
  }

  /**
   * Switch one live agent's policy and queue the transition for its next model
   * step. Session initialization uses {@link setApprovalPolicy} directly
   * because there is no previously visible policy to change.
   * @param agent - the live agent whose policy is changing.
   * @param policy - the new effective policy.
   */
  setPolicy(agent: Agent, policy: ApprovalPolicy): void {
    const previous = this.effectivePolicy(agent.session)
    if (previous === policy) return
    setApprovalPolicy(agent.session, policy)
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `The approval policy changed from "${previous}" to "${policy}" (changed by the user).`,
      }],
      source: { kind: 'user-approval' },
    }))
  }

  /**
   * Project explicit, logged user authorization into this service. The owning
   * product must restore and revoke this value from its session history;
   * calling this method alone does not persist authorization. Enabling settles
   * pending questions and overrides both ordinary `never` and mandatory asks.
   * Cancellation and failed audit commits still prevent execution.
   * @param session - the exact session authorized by the product.
   * @param enabled - whether its explicit automatic authorization is effective.
   */
  setAutomaticApproval(session: Session, enabled: boolean): void {
    if (!enabled) { this.automatic.delete(session); return }
    this.automatic.add(session)
    for (const allow of this.waiting.get(session) ?? []) allow()
  }

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
  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    return await this.track(req, true)
  }

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
  async requestMandatory(req: ApprovalRequest): Promise<ApprovalOutcome> {
    return await this.track(req, false)
  }

  /** Track audited requests so service disposal waits for cancellation decisions to commit. */
  private track(req: ApprovalRequest, respectSessionPolicy: boolean): Promise<ApprovalOutcome> {
    const pending = this.requestWithPolicy(req, respectSessionPolicy)
    this.pending.add(pending)
    void pending.then(() => { this.pending.delete(pending) }, () => { this.pending.delete(pending) })
    return pending
  }

  /** Run one audited request with or without the ordinary session-policy gate. */
  private async requestWithPolicy(req: ApprovalRequest, respectSessionPolicy: boolean): Promise<ApprovalOutcome> {
    if (this.stopped.signal.aborted) throw new Error('approval service is disposed')
    const session = req.agent.session
    if (!hasOpenTurn(session)) {
      throw new Error(
        'approval request outside an open turn: the approval/asked + approval/decided audit pair '
        + 'must be turn-enclosed so authorization can be restored only from an originally closed turn. '
        + 'Ask from inside the turn that needs the decision.',
      )
    }
    const id = ApprovalRequestId(randomUUID())
    session.append('approval/asked', {
      id,
      toolName: req.toolName,
      ...req.callId !== undefined ? { callId: req.callId } : {},
      ...req.reason !== undefined ? { reason: req.reason } : {},
      ...req.reusable !== undefined ? { reusable: auditReuse(req.reusable) } : {},
    })
    const signal = AbortSignal.any([this.stopped.signal, ...req.signal !== undefined ? [req.signal] : []])
    const reusable = req.reusable
    if (reusable === undefined) return await this.commitDecision(req, id, signal, respectSessionPolicy)
    const key = JSON.stringify([reusable.category, reusable.scope])
    const queue = this.queues.get(session) ?? new Map<string, Promise<void>>()
    this.queues.set(session, queue)
    const previous = queue.get(key) ?? Promise.resolve()
    const pending = this.commitDecision(req, id, signal, respectSessionPolicy, previous)
    // A cancelled waiter must not let later requests overtake the active question.
    const tail = Promise.allSettled([previous, pending]).then(() => {})
    queue.set(key, tail)
    void tail.then(() => { if (queue.get(key) === tail) queue.delete(key) })
    return await pending
  }

  /** Resolve and commit one decision before its classification queue is released. */
  private async commitDecision(
    req: ApprovalRequest,
    id: ApprovalRequestId,
    signal: AbortSignal,
    respectSessionPolicy: boolean,
    previous?: Promise<void>,
  ): Promise<ApprovalOutcome> {
    const session = req.agent.session
    if (previous !== undefined) await cancellable(previous, signal, undefined)
    let authorization: ApprovalAuthorization | undefined
    let automatic = false
    let answer: ApprovalAnswer
    if (signal.aborted) answer = 'cancelled'
    else if (this.automatic.has(session)) { answer = 'allowed-once'; automatic = true }
    else if (respectSessionPolicy && this.effectivePolicy(session) === 'never') answer = 'rejected'
    else if (req.reusable !== undefined && this.hasAuthorization(session, req.reusable)) {
      answer = 'allowed-once'
      authorization = { ...auditReuse(req.reusable), sessionId: session.id, kind: 'reuse' }
    } else {
      const decision = await this.decide(req, signal)
      answer = decision.answer
      automatic = decision.automatic
      if (answer === 'allowed-session' && req.reusable !== undefined) {
        authorization = { ...auditReuse(req.reusable), sessionId: session.id, kind: 'session' }
      }
    }
    if (signal.aborted) { answer = 'cancelled'; authorization = undefined }
    else if ((automatic && !this.automatic.has(session))
      || (respectSessionPolicy && this.effectivePolicy(session) === 'never' && !this.automatic.has(session))) {
      answer = 'rejected'
      authorization = undefined
    }
    const outcome: ApprovalOutcome = answer === 'allowed-session'
      ? authorization === undefined ? 'unavailable' : 'allowed-once'
      : answer
    session.append('approval/decided', { id, outcome, ...authorization !== undefined ? { authorization } : {} })
    if (authorization?.kind === 'session') {
      const grants = this.liveGrants.get(session) ?? new Set<string>()
      grants.add(JSON.stringify([authorization.category, authorization.scope]))
      this.liveGrants.set(session, grants)
    }
    return outcome
  }

  /** Fold committed grants belonging to this exact session, including after reopening. */
  private hasAuthorization(session: Session, reusable?: ApprovalReuse): boolean {
    const live = this.liveGrants.get(session)
    if (reusable === undefined ? (live?.size ?? 0) > 0 : live?.has(JSON.stringify([reusable.category, reusable.scope]))) return true
    let originallyClosed = false
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
      // oxlint-disable-next-line typescript/no-deprecated -- Approval authorization is reconstructed from committed history.
      const event = session.eventAt(SessionSeq(seq))
      if (event?.type === 'turn/end') originallyClosed = event.data.reason.kind !== 'interrupted' && event.data.reason.kind !== 'forked'
      else if (event?.type === 'turn/start') originallyClosed = false
      if (event?.type !== 'approval/decided' || event.data.outcome !== 'allowed-once') continue
      const authorization = event.data.authorization
      if (originallyClosed && authorization?.kind === 'session' && authorization.sessionId === session.id
        && (reusable === undefined || (authorization.category === reusable.category && authorization.scope === reusable.scope))) return true
    }
    return false
  }

  /**
   * The session's effective policy: its own `approval/policy` fold, else the
   * configured default (the schema already defaulted an omitted policy to
   * `'ask'`; the `??` only narrows the optional-input TYPE).
   * @param session - the exact accepted session whose policy applies.
   * @returns the policy every ask for this session resolves under right now.
   */
  private effectivePolicy(session: Session): ApprovalPolicy {
    return this.overrideOf(session) ?? this.config.policy ?? 'ask'
  }

  /**
   * Read the session override without applying the configured default.
   * @param session - session whose log supplies the override.
   * @returns the last logged policy, or `undefined` without one.
   */
  overrideOf(session: Session): ApprovalPolicy | undefined {
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(SessionSeq(seq))
      if (event?.type === 'approval/policy') return event.data.policy
    }
    return undefined
  }

  /**
   * Dispatch the waterfall, contained and raced against the request signal.
   * @param req - the borrowed public request.
   * @param signal - request cancellation combined with service disposal.
   * @returns the normalized choice and whether automatic authorization supplied it.
   */
  private async decide(
    req: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<{ answer: ApprovalAnswer; automatic: boolean }> {
    if (signal.aborted) return { answer: 'cancelled', automatic: false }
    const automatic = Promise.withResolvers<ApprovalAnswer>()
    const allow = (): void => { automatic.resolve('allowed-once') }
    const session = req.agent.session
    const waiting = this.waiting.get(session) ?? new Set<() => void>()
    this.waiting.set(session, waiting)
    waiting.add(allow)
    const question = new AbortController()
    const questionSignal = AbortSignal.any([signal, question.signal])
    // Enter the promise chain BEFORE dispatching: a listener that throws
    // SYNCHRONOUSLY (before its first await) must land in the same rejection
    // path as an async one — `Promise.resolve(call())` would let it escape
    // the containment into the caller.
    const answer: Promise<ApprovalAnswer> = Promise.resolve().then(
      () => this.ctx.waterfall(
        scopeTarget(req.agent, req.agent), 'approval/request', { ...req, signal: questionSignal },
        () => Promise.resolve<ApprovalAnswer>('unavailable'),
      ),
    ).then(
      // Normalize a rogue (non-vocabulary) answerer return to the fail-closed
      // outcome instead of leaking it into callers' closed-union switches.
      outcome => ANSWERS.includes(outcome) ? outcome : 'unavailable',
      // A throwing answerer must fail the QUESTION closed, not the caller's
      // tool call open — the seam contains its callbacks.
      () => 'unavailable',
    )
    try {
      const decision = await cancellable<{ answer: ApprovalAnswer; automatic: boolean }>(Promise.race([
        answer.then(answer => ({ answer, automatic: false })),
        automatic.promise.then(answer => ({ answer, automatic: true })),
      ]), signal, { answer: 'cancelled', automatic: false })
      if (decision.automatic) question.abort()
      return decision
    } finally {
      waiting.delete(allow)
    }
  }
}

export default ApprovalService
