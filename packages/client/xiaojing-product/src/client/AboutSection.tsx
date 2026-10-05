/** Xiaojing product identity and release highlights. */

import { useState, type ReactNode } from 'react'
import { Button, IconChevronRightOutlineRegular, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
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

/**
 * Render product information and release summaries, with one selected release in a dialog.
 * @param props - settings callbacks and localized product copy.
 * @returns the About page and the selected release's dismissible details.
 */
export function AboutSection({ t }: AboutSectionProps): ReactNode {
  const version = useApplicationVersion()
  const [selected, setSelected] = useState<typeof XIAOJING_RELEASE_HISTORY[number] | null>(null)
  const groups = [
    { category: 'added', titleKey: 'releaseAdded' },
    { category: 'improved', titleKey: 'releaseImproved' },
    { category: 'fixed', titleKey: 'releaseFixed' },
    { category: 'available', titleKey: 'releaseAvailable' },
  ] as const
  return (
    <section className={css.root} data-xiaojing-about>
      <header className={css.hero}>
        <img className={css.appIcon} src="./xiaojing-character-logo.png" alt={t('assistantAlt')} />
        <h2>{t('aboutTitle')}</h2>
        <p className={css.subtitle}>{t('aboutDescription')}</p>
        <span className={css.version}>{t('version')} {t('versionPrefix')}{version}</span>
      </header>

      <section className={css.history} aria-label={t('historyTitle')}>
        <h3>{t('historyTitle')}</h3>
        <div className={css.releases}>
          {XIAOJING_RELEASE_HISTORY.map(release => (
            <div className={css.release} data-release-version={release.version} key={release.version}>
              <div className={css.releaseCopy}>
                <div className={css.releaseHeading}>
                  <h4>{t('versionPrefix')}{release.version}</h4>
                  {release.version === version && <Tag tone="neutral">{t('version')}</Tag>}
                </div>
                <p>{t(release.summaryKey)}</p>
              </div>
              <Button size="sm" variant="outline" className={css.detailsAction}
                aria-label={t('releaseDetailsLabel').replace('{version}', release.version)}
                onClick={() => { setSelected(release) }}>
                {t('viewDetails')}<IconChevronRightOutlineRegular size={14} />
              </Button>
            </div>
          ))}
        </div>
      </section>
      <p className={css.company}>{t('brandAlt')}</p>

      {selected !== null && (
        <Modal open onClose={() => { setSelected(null) }}
          title={`${t('versionPrefix')}${selected.version} ${t('releaseTitle')}`}
          description={t(selected.summaryKey)} closeLabel={t('closeDetails')}
          className={css.dialog as string} contentClassName={css.dialogContent as string}
          footer={<Button variant="outline" onClick={() => { setSelected(null) }}>{t('closeDetails')}</Button>}>
          <div className={css.releaseDetails} data-release-details={selected.version}>
            {groups.map((group) => {
              const features = selected.features.filter(feature => feature.category === group.category)
              if (features.length === 0) return null
              return (
                <section className={css.featureGroup} key={group.category}>
                  <h3>{t(group.titleKey)}</h3>
                  <ul className={css.features}>
                    {features.map(feature => (
                      <li key={feature.titleKey}>
                        <h4>{t(feature.titleKey)}</h4>
                        <p>{t(feature.copyKey)}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
            {'noteKey' in selected && <p className={css.releaseNote}>{t(selected.noteKey)}</p>}
          </div>
        </Modal>
      )}
    </section>
  )
}
