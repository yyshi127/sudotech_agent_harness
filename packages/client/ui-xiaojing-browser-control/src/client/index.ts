/** Standalone Xiaojing browser-control settings contribution. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  BROWSER_CONTROL_SETTINGS_NAMESPACE,
  BrowserControlSettingsController,
  decodeBrowserControlSettings,
  type BrowserControlSettings,
} from './controller.ts'
import { BrowserControlSection, type BrowserControlSectionInjected } from './BrowserControlSection.tsx'
import { en, zh, type BrowserControlKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Browser selection and background-operation copy. */
    'xiaojing.browser-control': BrowserControlKey
  }
}

const NS = 'xiaojing.browser-control'

/** Generic Client services required by the product-only settings page. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/** Register a separate settings section only for the loopback Xiaojing product. */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing') return
  const connection = ctx.get('connection') as ConnectionHandle
  if (!connection.isLoopback) return
  const scope = ctx.settingsScope.bind<BrowserControlSettings>({
    namespace: BROWSER_CONTROL_SETTINGS_NAMESPACE,
    decode: decodeBrowserControlSettings,
  })
  const controller = new BrowserControlSettingsController(scope)
  ctx.effect(() => () => { controller.dispose() }, 'ui-xiaojing-browser-control: settings subscription')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-xiaojing-browser-control: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'browser-control',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: (): BrowserControlSectionInjected => ({
      hooks: { browserControl: controller.store },
      actions: controller,
      t,
    }),
  }, BrowserControlSection))
}

export type {
  BrowserControlSettings, BrowserControlView, BrowserKind,
} from './controller.ts'
export type { BrowserControlSectionInjected, BrowserControlSectionProps } from './BrowserControlSection.tsx'
