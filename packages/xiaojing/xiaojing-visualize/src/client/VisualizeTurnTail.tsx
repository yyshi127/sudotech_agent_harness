/** Completed visualizations remain visible when Chat folds the Turn's process. */
import type { ChatNode, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { visualizeMetaFrom } from '../fragment.ts'
import { VisualizeFrame } from './VisualizeCard.tsx'

function SavedVisualization({ nodeKey, useChat }: { nodeKey: string; useChat: UseChat }) {
  const node = useChat(snapshot => snapshot.nodes.get(nodeKey)) as ChatNode | undefined
  if (node?.kind !== 'tool-call') return null
  const block = node.data.root
  if (!('kind' in block) || block.isError) return null
  const meta = visualizeMetaFrom(block.meta)
  if (meta === undefined) return null
  return <VisualizeFrame meta={meta} callId={block.callId} />
}

/**
 * Render this completed Turn's saved cards outside its collapsible process.
 * @param props - completed Turn and current Conversation's Chat reader.
 * @returns successful visualization cards, including those restored from history.
 */
export function VisualizeTurnTail({ turn, useChat }: PropsRuntime<'conversation.chat.turnTail'>) {
  const keys = useChat(snapshot => snapshot.locations.getTurn(turn.turn))
  return <>{keys.map(key => <SavedVisualization key={key} nodeKey={key} useChat={useChat} />)}</>
}
