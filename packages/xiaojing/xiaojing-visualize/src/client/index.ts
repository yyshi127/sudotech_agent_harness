/**
 * dsh-visualize, browser half: the settled visualization card under the
 * `visualize` key of the atomic toolview hole, completed cards in the Turn
 * tail, and the streaming preview in the composer's input dock. Clients without this half degrade to the tool's
 * generic result text by the documented toolview fallback.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the `tool.call.toolview` SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `conversation.input.dock` SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, zh } from './locales.ts'
import { VisualizeCard } from './VisualizeCard.tsx'
import { StreamingPreview } from './StreamingPreview.tsx'
import { VisualizeTurnTail } from './VisualizeTurnTail.tsx'

export const name = 'xiaojing-visualize'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Product visualization status copy. */
    'xiaojing.visualize': keyof typeof zh
  }
}

export const inject = ['slots', 'locale']

/**
 * Register the keyed toolview, completed cards, and dock preview. Waiting on each hole's
 * declaration mirrors the official registrants: entry application order is
 * loader-driven, and a direct register racing the declaration fails boot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('xiaojing.visualize', { zh, en }), 'xiaojing-visualize: dictionaries')
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'visualize', locale: 'xiaojing.visualize' },
    VisualizeCard,
  ))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'visualize-stream', order: 30, locale: 'xiaojing.visualize' },
    StreamingPreview,
  ))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
    { name: 'conversation.chat.turnTail', id: 'visualize-results', order: 30 },
    VisualizeTurnTail,
  ))
}
