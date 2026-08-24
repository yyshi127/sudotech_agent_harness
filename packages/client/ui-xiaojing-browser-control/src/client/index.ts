/** Standalone Xiaojing browser-control settings contribution. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { BrowserControlSection, type BrowserControlSectionInjected } from './BrowserControlSection.tsx'
import { en, zh, type BrowserControlKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Edge browser-control and background-operation copy. */
    'xiaojing.browser-control': BrowserControlKey
  }
}

const NS = 'xiaojing.browser-control'

/** Generic Client services required by the product-only settings page. */
export const inject = ['slots', 'locale', 'connection']

/** Register a separate settings section only for the loopback Xiaojing product. */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing') return
  const connection = ctx.get('connection') as ConnectionHandle
  if (!connection.isLoopback) return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-xiaojing-browser-control: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'browser-control',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: (): BrowserControlSectionInjected => ({
      t,
    }),
  }, BrowserControlSection))
}

export type { BrowserControlSectionInjected, BrowserControlSectionProps } from './BrowserControlSection.tsx'
