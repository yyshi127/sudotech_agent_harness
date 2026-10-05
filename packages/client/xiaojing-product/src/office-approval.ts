/** Logged, office-only authorization for automatic approvals in one session family. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { z } from 'zod'

/** Identity is excluded from new-session defaults by its session-only registration. */
const NO_APPROVAL = 'xiaojing-no-approval'

/**
 * Restore explicit choices and project them into the approval service. Only
 * delegated children inherit their parent's grant; ordinary forks do not.
 * @param ctx - product context with approval available.
 */
export function installOfficeApproval(ctx: Context): void {
  ctx.inject(['sessions', 'sessionProjections', 'permissionPresets', 'agentPresets'], (scope) => {
    scope.sessionProjections.register({
      key: 'xiaojingOfficeApproval',
      stateVersion: 1,
      stateSchema: z.boolean(),
      init: () => false,
      apply: (state, event) => event.type === 'permission/preset'
        ? event.data.preset === NO_APPROVAL
        : event.type === 'session/end-seed' && event.data.inherited === true ? false : state,
    })
    const office = (session: Session): boolean => {
      const preset = scope.sessionProjections.stateOf(session, 'agentPreset')
      return typeof preset === 'string' && preset !== 'finance'
    }
    const authorized = (session: Session): boolean => {
      if (!office(session)) return false
      if (scope.sessionProjections.stateOf(session, 'xiaojingOfficeApproval') === true) return true
      if (session.header.origin !== 'subagent' || session.header.parentSession === undefined) return false
      const parent = scope.sessions.get(session.header.parentSession)
      return parent !== undefined && authorized(parent)
    }
    scope.permissionPresets.registerSessionPreset(NO_APPROVAL, {
      sandbox: 'danger-full-access', approval: 'ask',
    }, (session) => {
      if (!office(session)) throw new Error('No approvals is available only in office sessions')
    })
    const reconcile = (): void => {
      for (const session of scope.sessions.list()) {
        if (scope.sessionProjections.stateOf(session, 'permissions')?.preset === NO_APPROVAL
          && scope.sessionProjections.stateOf(session, 'xiaojingOfficeApproval') !== true) {
          scope.permissionPresets.set(session, 'danger-full-access')
        }
        scope.approval.setAutomaticApproval(session, authorized(session))
      }
    }
    scope.on('session/created', reconcile)
    scope.on('session/event', (_session, event) => {
      if (event.type === 'permission/preset' || event.type === 'agent-preset/selected'
        || event.type === 'session/end-seed') reconcile()
    })
    scope.effect(() => () => {
      for (const session of scope.sessions.list()) scope.approval.setAutomaticApproval(session, false)
    }, 'xiaojing: revoke automatic approvals on unload')
    reconcile()
  })
}
