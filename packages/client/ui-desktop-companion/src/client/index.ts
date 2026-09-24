/** Desktop-companion settings contribution for the Xiaojing product profile. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DesktopCompanionController } from './controller.ts'
import { DesktopCompanionSection, type DesktopCompanionSectionInjected } from './DesktopCompanionSection.tsx'
import { en, zh, type DesktopCompanionKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Windows desktop-companion controls and status copy. */
    'xiaojing.desktop-companion': DesktopCompanionKey
  }
}

const NS = 'xiaojing.desktop-companion'

/** Generic Client services required by the product-only settings page. */
export const inject = ['slots', 'locale']

/** Register desktop controls only in the Xiaojing Client build profile. */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing') return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-companion: dictionaries')
  const controller = new DesktopCompanionController()
  ctx.effect(() => () => { controller.dispose() }, 'ui-desktop-companion: bridge subscription')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'desktop-companion',
    order: 1000,
    label: () => t('nav'),
    locale: NS,
    inject: (): DesktopCompanionSectionInjected => ({
      hooks: { companion: controller.store },
      actions: controller,
      t,
    }),
  }, DesktopCompanionSection))
}

export type { DesktopCompanionView } from './controller.ts'
export type { DesktopCompanionSectionInjected, DesktopCompanionSectionProps } from './DesktopCompanionSection.tsx'
