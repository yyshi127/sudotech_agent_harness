/** Replayable file delivery from committed Finance publication events. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { FinanceManagedFile } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'

type PublishedFile = Pick<FinanceManagedFile, 'path' | 'name'>

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Successfully published Finance file; never inferred from assistant prose. */
    'finance-published-file': PublishedFile
  }
}

/** Each committed publication renders independently of tool success text. */
export const publishedFileDefinition: ConversationNodeDefinition<PublishedFile> = {
  kind: 'finance-published-file',
  target: 'chat',
  match: event => event.type === 'finance/file-published'
    ? { id: String(event.data.file.id), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'finance/file-published') throw new Error('Expected Finance publication')
    const { path, name } = match.event.data.file
    return { path, name }
  },
  update: context => context.state,
  buildViewNode: context => context.start === undefined || context.state === undefined ? null : {
    key: context.key,
    kind: 'finance-published-file',
    id: context.id,
    target: 'chat',
    anchorSeq: context.start.event.seq,
    location: context.start.location,
    visibility: 'visible',
    data: context.state,
  },
}
