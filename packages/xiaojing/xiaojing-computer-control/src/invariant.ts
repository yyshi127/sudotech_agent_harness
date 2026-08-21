/** Package companion for Xiaojing computer control. @module @deepseek-ai/dsh-xiaojing-computer-control/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaojing-computer-control'

/** Cordis companion plugin name. */
export const name = 'xiaojing-computer-control-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

/**
 * UI Automation observations and process handles are ephemeral and produce no package-owned session events or durable records,
 * so this package has no mutable cross-service relationship to validate.
 */
const install: InvariantInstaller = () => {
  // No runtime invariant: this plugin owns only ephemeral UI Automation observations and process handles.
}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
