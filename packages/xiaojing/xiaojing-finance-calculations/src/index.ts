/** Xiaojing Finance deterministic trial-calculation service. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import { calculateFinanceTrial } from './calculator.ts'
import { financeCalculationClientContext } from './compat.ts'
import type { FinanceCalculationRequest, FinanceCalculationResult } from './types.ts'

export { calculateFinanceTrial } from './calculator.ts'
export * from './rules.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Versioned deterministic Finance trial calculations. */
    xiaojingFinanceCalculations: XiaojingFinanceCalculations
  }
}

/** Host service consumed only by the Finance preset's calculation tool. */
export class XiaojingFinanceCalculations extends Service {
  static inject = ['xiaojingFinanceDomain']

  /** @param ctx - Host context. */
  constructor(ctx: Context) {
    super(ctx, 'xiaojingFinanceCalculations')
  }

  /**
   * Calculate one Finance trial result using explicit inputs and immutable client assumptions.
   * @param agent - Calling Finance agent.
   * @param request - Explicit calculation request.
   * @returns Auditable deterministic result.
   */
  calculate(agent: Agent, request: FinanceCalculationRequest): FinanceCalculationResult {
    return calculateFinanceTrial(request, financeCalculationClientContext(this.ctx, agent))
  }
}

export default XiaojingFinanceCalculations
