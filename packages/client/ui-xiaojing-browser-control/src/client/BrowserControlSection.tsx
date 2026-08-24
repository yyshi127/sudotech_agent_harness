/** Standalone browser-control settings section. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserControlKey } from './locales.ts'
import css from './BrowserControlSection.module.css'

/** Registration-side dependencies of the browser-control page. */
export interface BrowserControlSectionInjected {
  /** Translate browser-control copy in the active locale. */
  t: (key: BrowserControlKey) => string
}

/** Complete browser-control section props. */
export type BrowserControlSectionProps = PropsRuntime<'settings.section'> & InjectFace<BrowserControlSectionInjected>

/** Render a dedicated settings page instead of a row in General settings. */
export function BrowserControlSection({ t }: BrowserControlSectionProps): ReactNode {
  return (
    <section className={css.root}>
      <header className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </header>

      <div className={css.block}>
        <h3>{t('choose')}</h3>
        <article className={css.browserCard}>
          <span className={`${css.mark} ${css.edgeMark}`} aria-hidden="true">e</span>
          <span className={css.browserCopy}>
            <span className={css.browserTitle}>
              <strong>{t('edge')}</strong>
              <small>{t('enabled')}</small>
            </span>
            <span>{t('edgeDescription')}</span>
          </span>
        </article>
      </div>

      <div className={css.infoGrid}>
        <article>
          <span className={css.infoIcon} aria-hidden="true">▣</span>
          <div><h3>{t('visibleTitle')}</h3><p>{t('visibleDescription')}</p></div>
        </article>
        <article>
          <span className={css.infoIcon} aria-hidden="true">◎</span>
          <div><h3>{t('profileTitle')}</h3><p>{t('profileDescription')}</p></div>
        </article>
      </div>
    </section>
  )
}
