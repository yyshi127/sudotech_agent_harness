/** Runtime invariant companion for the Weixin settings presentation. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-weixin-channel'

/** Cordis companion plugin name. */
export const name = 'client-ui-weixin-channel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The loopback Host owns connection-state invariants; this package is presentation only. */
const install: InvariantInstaller = () => {
  // No runtime invariant: slot conflicts and the Host RPC own the observable relationships.
}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
