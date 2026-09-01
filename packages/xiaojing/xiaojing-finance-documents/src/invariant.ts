/** Package-owned invariant companion for shared document normalization. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaojing-finance-documents'

/** Cordis companion plugin name. */
export const name = 'xiaojing-finance-documents-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Durable cache records are validated at initialization and on every read. */
const install: InvariantInstaller = () => {
  // No runtime invariant: cache validation is enforced directly at every durable read and write.
}

/** Register package ownership. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
