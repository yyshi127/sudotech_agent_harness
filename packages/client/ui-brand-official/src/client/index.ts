/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { OfficialBrandMark, OfficialBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar brand slots as one declaration-aware registration set. The
 * conversation hero stays on its declaring package's animated fish fallback,
 * so the official build registers nothing there.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  ctx.effect(() => {
    const root = document.documentElement
    const existing = root.dataset.dshClientBuildProfile
    if (existing !== undefined && existing !== 'official') {
      throw new Error(`official-brand: Client build profile already claimed by ${JSON.stringify(existing)}`)
    }
    root.dataset.dshClientBuildProfile = 'official'
    return () => {
      if (root.dataset.dshClientBuildProfile === 'official') delete root.dataset.dshClientBuildProfile
    }
  }, 'official-brand: build profile witness')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, OfficialBrandName)
    }))
}
