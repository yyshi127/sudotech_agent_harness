/** Xiaojing sidebar brand occupants. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { XiaojingProductKey } from './locales.ts'
import css from './SidebarBrand.module.css'

/** Product copy injected into the sidebar name. */
export interface SidebarBrandInjected {
  t: (key: XiaojingProductKey) => string
}

/** Render the Xiaojing avatar in expanded and collapsed sidebar states. */
export function SidebarBrandMark({ size }: PropsRuntime<'sidebar.brand.mark'>): ReactNode {
  return <img className={css.avatar} style={{ width: size, height: size }} src="/sdoobot-avatar.png" alt="" />
}

/** Render the SUDO wordmark and Xiaojing finance tagline. */
export function SidebarBrandName(
  { t }: PropsRuntime<'sidebar.brand.name'> & InjectFace<SidebarBrandInjected>,
): ReactNode {
  return (
    <span className={css.name}>
      <img className={css.wordmark} src="/sudo-logo-gray.png" alt={t('brandAlt')} />
      <span className={css.tagline}>{t('tagline')}</span>
    </span>
  )
}
