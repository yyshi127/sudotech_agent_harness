/** Harness-version adapter for Finance client context and Web discovery. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FinanceEvidenceSearch } from './engine.ts'

/**
 * Resolve the existing Harness Web search service.
 * @param ctx - Host context.
 * @returns Search capability used for official-source discovery.
 */
export function financeEvidenceSearch(ctx: Context): FinanceEvidenceSearch {
  return ctx.web
}

/**
 * Read the immutable client locality for one Finance agent.
 * @param ctx - Host context.
 * @param agent - Calling Finance agent.
 * @returns Registered region, or undefined for consultation sessions.
 */
export function financeEvidenceClientLocality(ctx: Context, agent: Agent): string | undefined {
  return ctx.xiaojingFinanceDomain.currentClientBinding(agent)?.client.registeredRegion
}
