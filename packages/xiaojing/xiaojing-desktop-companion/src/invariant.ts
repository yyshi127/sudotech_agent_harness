/** Package companion for Xiaojing desktop companion state. @module @deepseek-ai/dsh-xiaojing-desktop-companion/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaojing-desktop-companion'

/** Cordis companion plugin name. */
export const name = 'xiaojing-desktop-companion-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

/** The tracker publishes derived ephemeral state and owns no durable cross-service relationship. */
const install: InvariantInstaller = () => {
  // No runtime invariant: session events remain authoritative and the projection is disposable.
}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
