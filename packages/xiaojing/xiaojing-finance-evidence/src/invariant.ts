/** Package-owned invariant companion for Xiaojing Finance official evidence. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaojing-finance-evidence'

/** Cordis companion plugin name. */
export const name = 'xiaojing-finance-evidence-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns no session event stream or mutable
 * cross-service relationship. Cache documents are validated at initialization
 * and every read before they can influence an evidence result.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the package-owned invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
