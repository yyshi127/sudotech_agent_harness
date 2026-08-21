/** Runtime invariant companion for the Xiaojing Weixin channel. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaojing-weixin-channel'

/** Cordis companion plugin name. */
export const name = 'xiaojing-weixin-channel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The channel owns private state and external I/O; its live relations are verified at those boundaries. */
const install: InvariantInstaller = () => {
  // No runtime invariant: no authoritative in-process event stream exposes the private iLink lifecycle.
}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
