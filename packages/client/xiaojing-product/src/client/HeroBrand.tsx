/** Xiaojing empty-session hero brand. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { XiaojingProductKey } from './locales.ts'
import css from './HeroBrand.module.css'

/** Product copy injected into the hero. */
export interface HeroBrandInjected {
  t: (key: XiaojingProductKey) => string
}

/** Product hero brand props. */
export type HeroBrandProps = PropsRuntime<'conversation.hero.brand'> & InjectFace<HeroBrandInjected>

/** Render the Xiaojing avatar, product title, and beta badge. */
export function HeroBrand({ t }: HeroBrandProps): ReactNode {
  return (
    <div className={css.headline}>
      <span className={css.logoHitbox}>
        <img className={css.logo} src="/sdoobot-avatar.png" alt={t('assistantAlt')} />
      </span>
      <span className={css.title}>{t('heroTitle')}</span>
      <span className={css.badge}>{t('beta')}</span>
    </div>
  )
}
