/** Xiaojing sidebar brand occupants. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { XiaojingProductKey } from './locales.ts'
import css from './SidebarBrand.module.css'

/** Product copy injected into the sidebar name. */
export interface SidebarBrandInjected {
  t: (key: XiaojingProductKey) => string
}

/** Enlarge the character within its transparent margins, retaining the shell-supplied frame. */
export function SidebarBrandMark({ size }: PropsRuntime<'sidebar.brand.mark'>): ReactNode {
  return (
    <svg className={css.avatar} width={size} height={size} viewBox="82 82 1090 1090" aria-hidden="true">
      <image href="/xiaojing-character-logo.png" width="1254" height="1254" />
    </svg>
  )
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
