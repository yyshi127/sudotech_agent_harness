/** Immutable Finance client context in the active session header. */

import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import css from './FinanceContextLabel.module.css'

/** Full session-header label props. */
export type FinanceContextLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'finance.clients'>

/** Render the safe bound label, or the explicit general-context label. */
export function FinanceContextLabel({ sessionId, useSessions, useProjection, t }: FinanceContextLabelProps): ReactNode {
  const preset = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset)
  const projection = useProjection('financeClient')
  if (preset !== 'finance') return null
  return (
    <span className={css.label} title={projection?.state === 'bound' ? projection.clientName : t('generalConsulting')}>
      {projection?.state === 'bound'
        ? projection.clientName
        : t('generalConsulting')}
    </span>
  )
}
