/** Standalone browser-control settings section. */

import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BrowserControlSettingsController, BrowserControlView, BrowserKind,
} from './controller.ts'
import type { BrowserControlKey } from './locales.ts'
import css from './BrowserControlSection.module.css'

/** Registration-side dependencies of the browser-control page. */
export interface BrowserControlSectionInjected {
  hooks: {
    /** Host setting bound to `useBrowserControl` by the slot renderer. */
    browserControl: HostObservable<BrowserControlView>
  }
  actions: Pick<BrowserControlSettingsController, 'select'>
  t: (key: BrowserControlKey) => string
}

/** Complete browser-control section props. */
export type BrowserControlSectionProps = PropsRuntime<'settings.section'> & InjectFace<BrowserControlSectionInjected>

interface BrowserChoiceProps {
  browser: BrowserKind
  selected: boolean
  disabled: boolean
  label: string
  description: string
  badge?: string
  selectedLabel: string
  onSelect: (browser: BrowserKind) => void
}

function BrowserMark({ browser }: { browser: BrowserKind }): ReactNode {
  return browser === 'edge'
    ? <span className={`${css.mark} ${css.edgeMark}`} aria-hidden="true">e</span>
    : <span className={`${css.mark} ${css.chromeMark}`} aria-hidden="true"><i /><i /><i /></span>
}

function BrowserChoice(props: BrowserChoiceProps): ReactNode {
  const { browser, selected, disabled, label, description, badge, selectedLabel, onSelect } = props
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={selected ? `${css.choice} ${css.choiceSelected}` : css.choice}
      disabled={disabled}
      onClick={() => { onSelect(browser) }}
    >
      <BrowserMark browser={browser} />
      <span className={css.choiceCopy}>
        <span className={css.choiceTitle}>
          <strong>{label}</strong>
          {badge !== undefined && <small>{badge}</small>}
        </span>
        <span>{description}</span>
      </span>
      <span className={css.radio} aria-hidden="true"><i /></span>
      {selected && <span className={css.selectedText}>{selectedLabel}</span>}
    </button>
  )
}

/** Render a dedicated settings page instead of a row in General settings. */
export function BrowserControlSection({ useBrowserControl, actions, t }: BrowserControlSectionProps): ReactNode {
  const view = useBrowserControl(state => state)
  const disabled = view.status === 'loading' || view.status === 'saving' || !view.writable
  const select = (browser: BrowserKind): void => { void actions.select(browser) }

  return (
    <section className={css.root}>
      <header className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </header>

      {view.status === 'loading' && <p className={css.status}>{t('loading')}</p>}
      {view.status === 'unavailable' && <p className={css.status}>{t('unavailable')}</p>}
      {view.error !== null && <p className={css.error}>{view.error}</p>}

      <div className={css.block}>
        <h3>{t('choose')}</h3>
        <div className={css.choices} role="radiogroup" aria-label={t('choose')}>
          <BrowserChoice
            browser="edge"
            selected={view.browser === 'edge'}
            disabled={disabled}
            label={t('edge')}
            description={t('edgeDescription')}
            badge={t('default')}
            selectedLabel={t('selected')}
            onSelect={select}
          />
          <BrowserChoice
            browser="chrome"
            selected={view.browser === 'chrome'}
            disabled={disabled}
            label={t('chrome')}
            description={t('chromeDescription')}
            selectedLabel={t('selected')}
            onSelect={select}
          />
        </div>
        {view.status === 'saving' && <p className={css.saving}>{t('saving')}</p>}
        <p className={css.notice}>{t('switchNotice')}</p>
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
