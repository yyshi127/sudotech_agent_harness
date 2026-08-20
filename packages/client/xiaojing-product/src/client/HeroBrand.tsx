/** Xiaojing empty-session hero occupants. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { XiaojingProductKey } from './locales.ts'
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

/** Render the Xiaojing avatar at the size requested by the hero shell. */
export function HeroBrandMark({ size, className, t }: HeroBrandMarkProps): ReactNode {
  return (
    <img
      className={[css.logo, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      src="/sdoobot-avatar.png"
      alt={t('assistantAlt')}
    />
  )
}

/** Render the Xiaojing product title and internal-beta badge. */
export function HeroBrandContent({ t }: HeroBrandContentProps): ReactNode {
  return (
    <>
      <span className={css.title}>{t('heroTitle')}</span>
      <span className={css.badge}>{t('beta')}</span>
    </>
  )
}
