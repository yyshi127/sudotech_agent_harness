/** Xiaojing product identity and release highlights. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useApplicationVersion } from './application-info.ts'
import type { XiaojingProductKey } from './locales.ts'
import css from './AboutSection.module.css'

/** Product copy injected into the About settings section. */
export interface AboutSectionInjected {
  t: (key: XiaojingProductKey) => string
}

/** Complete About settings-section props. */
export type AboutSectionProps = PropsRuntime<'settings.section'> & InjectFace<AboutSectionInjected>

const FEATURE_KEYS = [
  'featureVision',
  'featureWeixin',
  'featureEdge',
  'featureUsage',
  'featureVisualize',
  'featureCompanion',
] as const

/** Render the Xiaojing version and current release highlights. */
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
        <span className={css.version}>{t('version')} v{version}</span>
      </header>

      <div className={css.releaseHeading}>
        <div>
          <p>{t('releaseEyebrow')}</p>
          <h3>v{version} {t('releaseTitle')}</h3>
        </div>
        <span>{FEATURE_KEYS.length} {t('features')}</span>
      </div>

      <ol className={css.features}>
        {FEATURE_KEYS.map((key, index) => (
          <li key={key}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <p>{t(key)}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
