/** Runtime invariant companion for committed usage revisions. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-usage-accounting'

/** Cordis companion plugin name. */
export const name = 'usage-accounting-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Assert that every pushed revision names the service state already committed. */
const install: InvariantInstaller = (ctx, fail) => {
  let last = 0
  ctx.on('usage-accounting/updated', (revision) => {
    const service = ctx.get('usageAccounting')
    if (service === undefined || revision !== service.revision || revision <= last) {
      fail(`usage-accounting/updated revision ${revision} does not match a new committed ledger revision`)
    }
    last = revision
  })
}

/** Register the package invariant. */
export const apply = (ctx: Context): () => void => ctx.invariants.register(PACKAGE_NAME, install)
