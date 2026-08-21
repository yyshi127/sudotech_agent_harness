/** Package companion for Xiaojing browser control. @module @deepseek-ai/dsh-xiaojing-browser-control/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaojing-browser-control'

/** Cordis companion plugin name. */
export const name = 'xiaojing-browser-control-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

/**
 * Browser pages and observations are intentionally ephemeral and produce no package-owned session events or durable records,
 * so this package has no mutable cross-service relationship to validate.
 */
const install: InvariantInstaller = () => {
  // No runtime invariant: this plugin owns only ephemeral browser pages and observations.
}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
