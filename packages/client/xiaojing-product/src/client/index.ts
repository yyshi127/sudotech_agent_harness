/** Xiaojing product UI contributions. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { HeroBrand } from './HeroBrand.tsx'
import type { HeroBrandInjected } from './HeroBrand.tsx'
import { OnboardingContent } from './OnboardingContent.tsx'
import type { OnboardingContentInjected } from './OnboardingContent.tsx'
import { SidebarBrand } from './SidebarBrand.tsx'
import { en, zh, type XiaojingProductKey } from './locales.ts'
import './theme.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Xiaojing Accounting product copy. */
    'xiaojing.product': XiaojingProductKey
  }
}

const NS = 'xiaojing.product'

/** Product UI requires only generic slots and locale. */
export const inject = ['slots', 'locale']

/** Register Xiaojing brand, hero, onboarding, and theme as one unloadable product layer. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'xiaojing-product: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.brand', () => ctx.slots.register({
    name: 'sidebar.brand',
  }, SidebarBrand))
  ctx.slots.inject('conversation.hero.brand', () => ctx.slots.register({
    name: 'conversation.hero.brand',
    locale: NS,
    inject: (): HeroBrandInjected => ({ t }),
  }, HeroBrand))
  ctx.slots.inject('onboarding.content', () => ctx.slots.register({
    name: 'onboarding.content',
    locale: NS,
    inject: (): OnboardingContentInjected => ({ t }),
  }, OnboardingContent))
}
