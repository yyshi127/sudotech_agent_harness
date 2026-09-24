/** Xiaojing empty-session hero occupants. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { XiaojingProductKey } from './locales.ts'
import { useApplicationVersion } from './application-info.ts'
import css from './HeroBrand.module.css'

/** Product copy injected into the hero. */
export interface HeroBrandInjected {
  t: (key: XiaojingProductKey) => string
}

/** Product hero mark props. */
export type HeroBrandMarkProps =
  PropsRuntime<'conversation.hero.brand.mark'> & InjectFace<HeroBrandInjected>

/** Product hero copy props. */
export type HeroBrandContentProps =
  PropsRuntime<'conversation.hero.brand.content'> & InjectFace<HeroBrandInjected>

/** Render the shared artwork from the office or finance asset alias at the product hero size. */
export function HeroBrandMark({ className, t, sessionId, useSessions }: HeroBrandMarkProps): ReactNode {
  const finance = useSessions(state => sessionId !== undefined
    && state.byId[sessionId]?.projectionValues?.agentPreset === 'finance')
  const artworkHeight = 970
  return (
    <svg
      className={[css.logo, className].filter(Boolean).join(' ')}
      style={{ width: 145 * 1254 / artworkHeight, height: 145, overflow: 'hidden' }}
      viewBox={`0 105 1254 ${artworkHeight}`}
      role="img"
      aria-label={t('assistantAlt')}
    >
      <image href={finance ? '/xiaojing-finance-robot-logo.png' : '/xiaojing-office-robot-logo.png'} width="1254" height="1254" />
    </svg>
  )
}

/** Render the Xiaojing product title and internal-beta badge. */
export function HeroBrandContent({ t, sessionId, useSessions }: HeroBrandContentProps): ReactNode {
  const version = useApplicationVersion()
  const finance = useSessions(state => sessionId !== undefined
    && state.byId[sessionId]?.projectionValues?.agentPreset === 'finance')
  return (
    <span className={css.titleGroup}>
      <span className={css.title}>{t(finance ? 'financeHeroTitle' : 'heroTitle')}</span>
      <span className={css.badge}>{t('betaBadgeFormat').replace('{version}', version)}</span>
    </span>
  )
}
