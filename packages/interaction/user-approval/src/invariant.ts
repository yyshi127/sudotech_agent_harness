/** Package-owned approval audit-stream invariants. @module @deepseek-ai/dsh-user-approval/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ApprovalAuthorization, ApprovalRequestId, ApprovalReuseAudit } from './index.ts'
import { APPROVAL_POLICIES } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-user-approval'
const APPROVAL_OUTCOMES = ['allowed-once', 'rejected', 'cancelled', 'unavailable'] as const
const AUTHORIZATION_KINDS: readonly string[] = ['session', 'reuse']

/** Cordis companion plugin name. */
export const name = 'user-approval-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

type ApprovalTransition =
  | { kind: 'asked'; id: ApprovalRequestId; reusable?: ApprovalReuseAudit }
  | { kind: 'decided'; id: ApprovalRequestId; authorization?: ApprovalAuthorization }

interface ApprovalTrace {
  openTurn: number | null
  pending: Map<ApprovalRequestId, ApprovalReuseAudit | undefined>
  grants: Set<string>
}

/** Session identity is part of the durable authorization key. */
function authorizationKey(authorization: ApprovalAuthorization): string {
  return JSON.stringify([authorization.sessionId, authorization.category, authorization.scope])
}

/** Validate one approval event against committed unmatched questions. */
function validateApprovalEvent(
  trace: ApprovalTrace,
  event: SessionEvent,
  fail: InvariantFailure,
  session?: Session,
): ApprovalTransition | undefined {
  if (event.type === 'approval/asked') {
    if (trace.openTurn === null) fail('approval/asked appended outside any open turn')
    if (event.data.toolName.length === 0) fail('approval/asked toolName must be non-empty')
    if (trace.pending.has(event.data.id)) fail(`approval/asked repeated open id ${JSON.stringify(event.data.id)}`)
    const reusable = event.data.reusable
    if (reusable !== undefined && (reusable.category.length === 0 || reusable.scope.length === 0 || reusable.label.length === 0)) {
      fail('approval/asked reusable category, scope, and label must be non-empty')
    }
    return { kind: 'asked', id: event.data.id, ...reusable !== undefined ? { reusable } : {} }
  }
  if (event.type === 'approval/decided') {
    if (trace.openTurn === null) fail('approval/decided appended outside any open turn')
    if (!trace.pending.has(event.data.id)) fail(`approval/decided has no matching approval/asked for id ${JSON.stringify(event.data.id)}`)
    if (!APPROVAL_OUTCOMES.includes(event.data.outcome)) {
      fail(`approval/decided carries unknown outcome ${JSON.stringify(event.data.outcome)}`)
    }
    const authorization = event.data.authorization
    if (authorization !== undefined) {
      const reusable = trace.pending.get(event.data.id)
      if (event.data.outcome !== 'allowed-once') fail('approval authorization requires allowed-once outcome')
      if (reusable === undefined || reusable.category !== authorization.category || reusable.scope !== authorization.scope
        || reusable.label !== authorization.label) fail('approval authorization must match the asked reusable classification')
      if (session !== undefined && authorization.sessionId !== session.id) fail('approval authorization belongs to a different session')
      if (!AUTHORIZATION_KINDS.includes(authorization.kind)) fail('approval authorization carries unknown kind')
      if (authorization.kind === 'reuse' && !trace.grants.has(authorizationKey(authorization))) {
        fail('approval authorization reuse has no committed session grant')
      }
    }
    return { kind: 'decided', id: event.data.id, ...authorization !== undefined ? { authorization } : {} }
  }
  if (event.type === 'approval/policy' && !APPROVAL_POLICIES.includes(event.data.policy)) {
    fail(`approval/policy carries unknown policy ${JSON.stringify(event.data.policy)}`)
  }
  return undefined
}

/** Apply one accepted approval-pair transition. */
function applyApprovalTransition(trace: ApprovalTrace, transition: ApprovalTransition): void {
  if (transition.kind === 'asked') trace.pending.set(transition.id, transition.reusable)
  else {
    trace.pending.delete(transition.id)
    if (transition.authorization?.kind === 'session') trace.grants.add(authorizationKey(transition.authorization))
  }
}

/** Install audit pairing and closed-vocabulary checks. */
// Event owners keep precommit staging local so their vocabularies never move into a central helper.
/* jscpd:ignore-start */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, ApprovalTrace>()
  const staged = new WeakMap<SessionEvent, { session: Session; transition: ApprovalTransition }>()
  const seed = (session: Session): ApprovalTrace => {
    const trace: ApprovalTrace = { openTurn: null, pending: new Map(), grants: new Set() }
    traces.set(session, trace)
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    for (const event of session.snapshotEvents()) {
      if (event.type === 'turn/start') trace.openTurn = event.data.turn
      else if (event.type === 'turn/end') trace.openTurn = null
      const transition = validateApprovalEvent(trace, event, fail)
      if (transition !== undefined) applyApprovalTransition(trace, transition)
    }
    return trace
  }
  const traceFor = (session: Session): ApprovalTrace => traces.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    const trace = traceFor(session)
    if (event.type === 'turn/start') {
      trace.openTurn = event.data.turn
      return
    }
    if (event.type === 'turn/end') {
      trace.openTurn = null
      return
    }
    if (event.type !== 'approval/asked' && event.type !== 'approval/decided') return
    const candidate = staged.get(event)
    /* v8 ignore next -- internal/dispatch stages every package-owned pair event */
    if (candidate === undefined || candidate.session !== session) return fail('approval audit event published without pre-commit validation')
    staged.delete(event)
    applyApprovalTransition(trace, candidate.transition)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const transition = validateApprovalEvent(traceFor(session), event, fail, session)
    if (transition !== undefined) staged.set(event, { session, transition })
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the approval invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
