/** Runtime invariant companion for the pure presentation plugin. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-usage-accounting'

/** Cordis companion plugin name. */
export const name = 'client-ui-usage-accounting-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: slot registration conflicts and Host accounting own the observable relations. */
const install: InvariantInstaller = () => {}

/** Register the package invariant. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
