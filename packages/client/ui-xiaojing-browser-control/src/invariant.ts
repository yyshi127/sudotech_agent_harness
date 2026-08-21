/** Runtime invariant companion for the Xiaojing browser-control settings page. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-xiaojing-browser-control'

/** Cordis companion plugin name. */
export const name = 'client-ui-xiaojing-browser-control-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The Host settings namespace and slot registry own the observable relationships. */
const install: InvariantInstaller = () => {
  // No runtime invariant: this package only projects a Host-owned settings namespace.
}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
