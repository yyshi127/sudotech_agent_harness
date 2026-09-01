/** Runtime invariant companion for the Xiaojing Finance client UI. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-xiaojing-finance-clients'

/** Cordis companion plugin name. */
export const name = 'client-ui-xiaojing-finance-clients-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The Remote and slot registries own this package's mutable relationships. */
const install: InvariantInstaller = () => {
  // No runtime invariant: the Remote mount and effect-owned slots already expose registration loss.
}

/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
