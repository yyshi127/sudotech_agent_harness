/** Explicit local file opener for a committed Finance deliverable. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from './published-file.ts'

/** Existing slot actions and the local-host availability flag. */
export type PublishedFileProps = PropsRuntime<'conversation.chat.node', 'finance-published-file'>
  & PropsLocale<'finance.clients'> & { canOpen: boolean }

/** Show the committed name and open its exact path only on a user gesture.
 * @param props - Durable node, existing Host opener and translated labels.
 * @returns A local file action, disabled for non-loopback clients.
 */
export function PublishedFile({ node, openFile, canOpen, t }: PublishedFileProps) {
  return <div data-finance-published-file={node.id}>
    <button type="button" title={node.data.path} disabled={!canOpen}
      onClick={() => { openFile(node.data.path) }}>
      {t('publishedFileOpen')} · {node.data.name}
    </button>
    {!canOpen && <span>{t('publishedFileLocalOnly')}</span>}
  </div>
}
