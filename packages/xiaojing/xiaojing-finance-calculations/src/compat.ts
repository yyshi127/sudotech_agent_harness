/** Harness-version adapter for immutable Finance client assumptions. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FinanceCalculationClientContext } from './types.ts'

/**
 * Read non-sensitive assumptions from the current immutable client binding.
 * @param ctx - Host context.
 * @param agent - Calling Finance agent.
 * @returns Client assumptions, or an empty object for consultation sessions.
 */
export function financeCalculationClientContext(
  ctx: Context,
  agent: Agent,
): FinanceCalculationClientContext {
  const binding = ctx.xiaojingFinanceDomain.currentClientBinding(agent)
  if (!binding) return {}
  return {
    taxpayerType: binding.client.taxpayerType,
    registeredRegion: binding.client.registeredRegion,
  }
}
