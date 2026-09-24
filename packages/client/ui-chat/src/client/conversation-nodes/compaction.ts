import type { Context } from '@deepseek-ai/cordis'
import type {
  CompactionSummaryNode, ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-compaction/types'
import { chatNode } from './common.ts'
import { compactSource, compactSummary, updateCompactionState } from './command.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Automatic compaction checkpoint marker. */
    compaction: CompactionSummaryNode
  }
}

interface CompactionState {
  readonly summary?: ConversationMatch
  readonly checkpoint?: ConversationMatch
  readonly end?: ConversationMatch
}

function fallbackState(context: ConversationNodeContext<CompactionState>): CompactionState {
  const summary = context.matches.find(match => match.event.type === 'compaction/summary')
  const checkpoint = context.matches.find(match => compactSource(match.event) !== undefined)
  const end = context.matches.findLast(match => match.event.type === 'compaction/end')
  return {
    ...summary === undefined ? {} : { summary },
    ...checkpoint === undefined ? {} : { checkpoint },
    ...end === undefined ? {} : { end },
  }
}

/** Automatic compaction lifecycle and landed checkpoint Definition. */
export const compactionDefinition: ConversationNodeDefinition<CompactionState> = {
  kind: 'compaction',
  target: 'chat',
  match: (event) => {
    const checkpoint = compactSource(event)
    if (checkpoint !== undefined && checkpoint.sourceCommandId === undefined) {
      return { id: checkpoint.compactionId, role: 'update' }
    }
    if (event.type === 'compaction/start'
      || event.type === 'compaction/summary'
      || event.type === 'compaction/end') {
      if (event.data.sourceCommandId !== undefined) return null
      const compactionId: unknown = event.data.compactionId
      if (typeof compactionId !== 'string' || compactionId === '') return null
      return { id: compactionId, role: event.type === 'compaction/start' ? 'start' : 'update' }
    }
    return null
  },
  start: () => ({}),
  update: (context, match) => updateCompactionState(context.state, match),
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state.checkpoint === undefined) {
      if (state.end?.event.type !== 'compaction/end' || state.end.event.data.error === undefined) return null
      return chatNode(context, 'compaction', state.end.event.seq, {
        kind: 'compaction',
        seq: state.end.event.seq,
        time: state.end.event.time,
        summary: null,
        summaryEventSeq: null,
        shadowedItemCount: null,
        shadowedTokenCount: null,
        failure: true,
      })
    }
    const marker = compactSummary(state.summary, state.checkpoint)
    return chatNode(context, 'compaction', marker.seq, marker)
  },
}

/**
 * Register the automatic-compaction business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerCompactionConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(compactionDefinition)
}
