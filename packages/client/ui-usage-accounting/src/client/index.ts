/** Usage-accounting sidebar and settings contributions. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { UsageAccountingController } from './controller.ts'
import { UsageSection } from './UsageSection.tsx'
import type { UsageSectionInjected } from './UsageSection.tsx'
import { UsageSidebar } from './UsageSidebar.tsx'
import type { UsageSidebarInjected } from './UsageSidebar.tsx'
import { en, zh } from './locales.ts'

export type { UsageAccountingRemote, UsageAccountingView } from './controller.ts'
export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageSidebarInjected, UsageSidebarProps } from './UsageSidebar.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Local usage summary and calendar copy. */
    'usage.accounting': keyof typeof zh
  }
}

const NS = 'usage.accounting'

/** Required slots, Remote, and locale services. */
export const inject = ['slots', 'remote', 'remote.usageAccounting', 'locale']

/** Register both views over one shared pushed snapshot controller. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-usage-accounting: dictionaries')
  const controller = new UsageAccountingController(ctx.remote.usageAccounting)
  const t = ctx.locale.bind(NS)
  const refresh = (): void => { void controller.load() }
  const shared = { hooks: { usage: controller.store }, refresh, t }
  const sidebarInjected = (): UsageSidebarInjected => shared
  const sectionInjected = (): UsageSectionInjected => shared

  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('usage-accounting/updated', refresh),
      ctx.remote.$on('credentials/updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-usage-accounting: pushed refresh')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'usage-accounting',
    order: -20,
    locale: NS,
    inject: sidebarInjected,
  }, UsageSidebar))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
  }, UsageSection))
}
