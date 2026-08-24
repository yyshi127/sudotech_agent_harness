/** Runtime invariant companion for the Xiaojing browser-control settings page. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-xiaojing-browser-control'

/** Cordis companion plugin name. */
export const name = 'client-ui-xiaojing-browser-control-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The slot registry owns the page contribution; the page has no mutable cross-service relationship. */
const install: InvariantInstaller = () => {
  // No runtime invariant: this package contributes only static Edge guidance to a generic settings slot.
}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
