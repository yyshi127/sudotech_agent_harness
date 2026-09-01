/** Finance-preset consumer that materializes the logged client context into each model request. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Required Host service for Finance prompt context. */
export const inject = ['xiaojingFinanceDomain']

/** Register the Finance-only prompt context listener. @param ctx - Finance agent scope. */
export function apply(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context.agent
    if (agent !== undefined && ctx.xiaojingFinanceDomain.isFinanceAgent(agent)) {
      assembly.contexts.push({
        name: 'xiaojing:finance-client',
        text: await ctx.xiaojingFinanceDomain.promptContext(agent),
      })
    }
    return next()
  })
}
