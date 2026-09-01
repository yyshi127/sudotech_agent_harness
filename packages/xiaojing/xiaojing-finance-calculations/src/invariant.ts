/** Package-owned invariant companion for Xiaojing Finance calculations. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaojing-finance-calculations'

/** Cordis companion plugin name. */
export const name = 'xiaojing-finance-calculations-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

// No runtime invariant: this package performs pure calculations and owns no mutable runtime relationship.
const install: InvariantInstaller = () => {}

/**
 * Register the package-owned invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
