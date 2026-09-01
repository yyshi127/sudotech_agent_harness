/** Harness-version adapter for Finance preset and blank-session checks. */

import type { Session } from '@deepseek-ai/dsh-session'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'

/** Stable Xiaojing Finance preset id. */
export const FINANCE_PRESET_ID = 'finance'

/**
 * Determine whether a session currently runs the Finance preset.
 * @param session - Live or restored session.
 * @returns Finance membership.
 */
export function isFinanceSession(session: Session): boolean {
  return resolveSessionPreset(session) === FINANCE_PRESET_ID
}

/**
 * Determine whether no execution turn has started.
 * @param session - Session to inspect.
 * @returns Whether context may still be staged.
 */
export function isBlankFinanceSession(session: Session): boolean {
  return !session.events.some(event => event.type === 'turn/start')
}
