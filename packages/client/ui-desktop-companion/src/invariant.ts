/** Runtime invariant companion for the desktop-companion settings presentation. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-desktop-companion'

/** Cordis companion plugin name. */
export const name = 'client-ui-desktop-companion-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Electron IPC owns desktop availability; this package is presentation only. */
const install: InvariantInstaller = () => {
  // No runtime invariant: the Electron preload and settings slot own observable relationships.
}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
