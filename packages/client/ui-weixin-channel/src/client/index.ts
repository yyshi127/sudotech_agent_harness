/** Weixin channel settings contribution for the Xiaojing product profile. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { WeixinChannelController } from './controller.ts'
import { WeixinChannelSection, type WeixinChannelSectionInjected } from './WeixinChannelSection.tsx'
import { en, zh, type WeixinChannelKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Weixin channel connection and safety copy. */
    'xiaojing.weixin-channel': WeixinChannelKey
  }
}

const NS = 'xiaojing.weixin-channel'

/** Generic Client services required by the product-only settings page. */
export const inject = ['slots', 'locale', 'connection']

/** Register the channels page only in the Xiaojing Client build profile. */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing') return
  const connection = ctx.get('connection') as ConnectionHandle
  if (!connection.isLoopback) return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-weixin-channel: dictionaries')
  const controller = new WeixinChannelController(connection.rpc)
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'channels',
    order: 25,
    label: () => t('nav'),
    locale: NS,
    inject: (): WeixinChannelSectionInjected => ({
      hooks: { channel: controller.store },
      actions: controller,
      t,
    }),
  }, WeixinChannelSection))
}

export type { WeixinChannelView } from './controller.ts'
export type { WeixinChannelSectionInjected, WeixinChannelSectionProps } from './WeixinChannelSection.tsx'
