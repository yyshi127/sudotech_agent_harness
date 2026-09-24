/** Business-facing Finance card over the settled, persisted presentation metadata. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import css from './FinanceToolCard.module.css'

type Props = ToolCallViewProps & PropsLocale<'finance.clients'>

interface FinanceCardMeta {
  kind: 'xiaojing-finance-card'
  title: string
  text: string
}

function financeCardMeta(value: unknown): FinanceCardMeta | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const meta = value as Record<string, unknown>
  return meta.kind === 'xiaojing-finance-card'
    && typeof meta.title === 'string' && typeof meta.text === 'string'
    ? { kind: 'xiaojing-finance-card', title: meta.title, text: meta.text }
    : null
}

function safeFailure(value: string): string | null {
  const text = value.replace(/^Error:\s*/u, '').replace(/\bsubjectLevel\b/gu, '科目层级')
    .replace(/\s+/gu, ' ').trim()
  return text.length > 0 && text.length <= 240
    && /\p{Script=Han}/u.test(text)
    && !/[A-Za-z_{}\[\]<>]/u.test(text)
    ? text : null
}

/** Render Finance tools without exposing raw model arguments or technical JSON. */
export function FinanceToolCard({ block, t }: Props) {
  const done = 'kind' in block
  const meta = done && !block.isError ? financeCardMeta(block.meta) : null
  const result = done && block.content.length === 1 && block.content[0]?.type === 'tool-result'
    ? block.content[0].content : done ? block.content : []
  const failure = done && block.isError && result.length === 1 && result[0]?.type === 'text'
    ? safeFailure(result[0].text) : null
  const title = meta?.title ?? (done
    ? block.isError ? t('toolFailed') : t('toolResultUnavailable')
    : t('toolWorking'))
  return (
    <section className={css.card} aria-label={title}>
      <span className={css.title}>{title}</span>
      {meta?.text ? <span className={css.body}>{meta.text}</span> : null}
      {failure !== null ? <span className={css.body}>{failure}</span> : null}
    </section>
  )
}
