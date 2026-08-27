/** Xiaojing product UI contributions. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { AboutSection } from './AboutSection.tsx'
import type { AboutSectionInjected } from './AboutSection.tsx'
import { HeroBrandContent, HeroBrandMark } from './HeroBrand.tsx'
import type { HeroBrandInjected } from './HeroBrand.tsx'
import { OnboardingContent } from './OnboardingContent.tsx'
import type { OnboardingContentInjected } from './OnboardingContent.tsx'
import { SidebarBrandMark, SidebarBrandName } from './SidebarBrand.tsx'
import type { SidebarBrandInjected } from './SidebarBrand.tsx'
import { en, zh, type XiaojingProductKey } from './locales.ts'
import './theme.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Xiaojing Accounting product copy. */
    'xiaojing.product': XiaojingProductKey
  }
}

const NS = 'xiaojing.product'

function syncThemeColor(): void {
  const metadata = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (metadata !== null) metadata.content = getComputedStyle(document.body).backgroundColor
}

/** Product UI requires generic slots, locale, and the preset-copy registry. */
export const inject = ['slots', 'locale', 'agentPresetDisplay']

/** Register Xiaojing brand, hero, onboarding, and theme as one unloadable product layer. */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing') return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'xiaojing-product: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.agentPresetDisplay.register('finance', () => ({
    name: t('financePresetName'),
    description: t('financePresetDescription'),
  })), 'xiaojing-product: Finance preset copy')
  ctx.effect(() => {
    document.body.dataset.xiaojingProduct = ''
    syncThemeColor()
    return () => {
      delete document.body.dataset.xiaojingProduct
      syncThemeColor()
    }
  }, 'xiaojing-product: theme scope')
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
  }, SidebarBrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    locale: NS,
    inject: (): SidebarBrandInjected => ({ t }),
  }, SidebarBrandName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
    locale: NS,
    inject: (): HeroBrandInjected => ({ t }),
  }, HeroBrandMark))
  ctx.slots.inject('conversation.hero.brand.content', () => ctx.slots.register({
    name: 'conversation.hero.brand.content',
    locale: NS,
    inject: (): HeroBrandInjected => ({ t }),
  }, HeroBrandContent))
  ctx.slots.inject('onboarding.content', () => ctx.slots.register({
    name: 'onboarding.content',
    locale: NS,
    inject: (): OnboardingContentInjected => ({ t }),
  }, OnboardingContent))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'about-xiaojing',
    order: 1010,
    label: () => t('aboutNav'),
    locale: NS,
    inject: (): AboutSectionInjected => ({ t }),
  }, AboutSection))
}
