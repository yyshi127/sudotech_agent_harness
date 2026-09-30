/** Xiaojing product identity and release highlights. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useApplicationVersion } from './application-info.ts'
import type { XiaojingProductKey } from './locales.ts'
import { XIAOJING_RELEASE_HISTORY } from './release-history.ts'
import css from './AboutSection.module.css'

/** Product copy injected into the About settings section. */
export interface AboutSectionInjected {
  t: (key: XiaojingProductKey) => string
}

/** Complete About settings-section props. */
export type AboutSectionProps = PropsRuntime<'settings.section'> & InjectFace<AboutSectionInjected>

/** Render the Xiaojing version and newest-first incremental release history. */
export function AboutSection({ t }: AboutSectionProps): ReactNode {
  const version = useApplicationVersion()
  return (
    <section className={css.root} data-xiaojing-about>
      <header className={css.hero}>
        <div className={css.identity}>
          <img className={css.avatar} src="/sdoobot-avatar.png" alt={t('assistantAlt')} />
          <div>
            <p className={css.eyebrow}>{t('brandAlt')}</p>
            <h2>{t('aboutTitle')}</h2>
            <p className={css.subtitle}>{t('heroTitle')}</p>
          </div>
        </div>
        <span className={css.version}>{t('version')} {t('versionPrefix')}{version}</span>
      </header>

      {XIAOJING_RELEASE_HISTORY.map((release, releaseIndex) => (
        <section className={css.release} data-release-version={release.version} key={release.version}>
          <div className={css.releaseHeading}>
            <div>
              <p>{t(releaseIndex === 0 ? 'releaseEyebrow' : 'historyEyebrow')}</p>
              <h3>{t('versionPrefix')}{release.version} {t('releaseTitle')}</h3>
            </div>
            <span>{release.features.length} {t('features')}</span>
          </div>

          <ol className={css.features}>
            {release.features.map(feature => (
              <li key={feature.label}>
                <span>{feature.label}</span>
                <p>{t(feature.copyKey)}</p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </section>
  )
}
