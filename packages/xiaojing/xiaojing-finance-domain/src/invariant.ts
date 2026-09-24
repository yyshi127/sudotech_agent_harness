/** Package-owned invariant for immutable Finance client binding streams. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyFinanceClientEvent, EMPTY_FINANCE_CLIENT_STATE } from './fold.ts'
import type { FinanceClientProjectionState } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaojing-finance-domain'

/** Cordis companion plugin name. */
export const name = 'xiaojing-finance-domain-invariant'
/** Services required before installing the independent stream fold. */
export const inject = ['invariants']

function applyChecked(
  state: FinanceClientProjectionState,
  event: SessionEvent,
  fail: InvariantFailure,
): FinanceClientProjectionState {
  try {
    return applyFinanceClientEvent(state, event)
  } catch (error) {
    fail(`session event ${event.seq} violates the Finance client binding stream: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Validate a single immutable binding before publication and across restored logs. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, FinanceClientProjectionState>()
  const staged = new WeakMap<SessionEvent, { session: Session; state: FinanceClientProjectionState }>()
  const seed = (session: Session): FinanceClientProjectionState => {
    let state = EMPTY_FINANCE_CLIENT_STATE
    for (const event of session.snapshotEvents()) state = applyChecked(state, event, fail)
    states.set(session, state)
    return state
  }
  const stateFor = (session: Session): FinanceClientProjectionState => states.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    staged.set(event, { session, state: applyChecked(stateFor(session), event, fail) })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching Finance binding validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the Finance binding invariant. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
