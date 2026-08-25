/** Desktop-companion settings page. */

import { useEffect, type ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompanionState } from '@deepseek-ai/dsh-xiaojing-desktop-companion/types'
import type { DesktopCompanionController, DesktopCompanionView } from './controller.ts'
import type { DesktopCompanionKey } from './locales.ts'
import css from './DesktopCompanionSection.module.css'

/** Registration-side dependencies of the desktop-companion settings section. */
export interface DesktopCompanionSectionInjected {
  hooks: {
    /** Electron availability and content-free task state bound by the slot renderer. */
    companion: HostObservable<DesktopCompanionView>
  }
  actions: Pick<DesktopCompanionController, 'load' | 'wake' | 'tuck' | 'resetPosition' | 'setScale'>
  t: (key: DesktopCompanionKey) => string
}

/** Complete desktop-companion settings-section props. */
export type DesktopCompanionSectionProps = PropsRuntime<'settings.section'> & InjectFace<DesktopCompanionSectionInjected>

function stateKey(state: CompanionState): DesktopCompanionKey {
  return state
}

/** Render desktop-only companion controls with a safe web fallback. */
export function DesktopCompanionSection({ useCompanion, actions, t }: DesktopCompanionSectionProps): ReactNode {
  const view = useCompanion(state => state)

  useEffect(() => {
    void actions.load()
  }, [actions])

  return (
    <section className={css.root} data-desktop-companion-settings>
      <header className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </header>

      <article className={css.card}>
        <div className={css.preview}>
          <span className={css.halo} aria-hidden="true" />
          <img src="/desktop-companion/idle.webp" alt={t('title')} />
        </div>
        <div className={css.content}>
          {!view.available ? (
            <p className={css.unavailable}>{t('unavailable')}</p>
          ) : (
            <>
              <div className={css.statusLine}>
                <span className={view.visible ? css.online : css.offline}>
                  <i />{view.visible ? t('awake') : t('tucked')}
                </span>
                {view.visible && view.snapshot.state !== 'idle' && (
                  <strong>{t(stateKey(view.snapshot.state))}</strong>
                )}
                {view.snapshot.activeTaskCount > 1 && (
                  <span>{view.snapshot.activeTaskCount} {t('taskCount')}</span>
                )}
              </div>
              {view.error !== null && <p className={css.error}>{view.error}</p>}
              <div className={css.sizeControl}>
                <div className={css.sizeHeading}>
                  <label htmlFor="desktop-companion-size">{t('size')}</label>
                  <strong>{Math.round(view.scale * 100)}%</strong>
                </div>
                <input
                  id="desktop-companion-size"
                  type="range"
                  min="30"
                  max="100"
                  step="5"
                  value={Math.round(view.scale * 100)}
                  disabled={view.busy}
                  onChange={(event) => { void actions.setScale(Number(event.currentTarget.value) / 100) }}
                />
                <div className={css.sizeLabels} aria-hidden="true">
                  <span>{t('smaller')}</span>
                  <span>{t('larger')}</span>
                </div>
              </div>
              <div className={css.actions}>
                <button
                  className={css.primary}
                  disabled={view.busy}
                  onClick={() => { void (view.visible ? actions.tuck() : actions.wake()) }}
                >{view.visible ? t('tuck') : t('wake')}</button>
                <button
                  className={css.secondary}
                  disabled={view.busy}
                  onClick={() => { void actions.resetPosition() }}
                >{t('reset')}</button>
              </div>
            </>
          )}
          <ul className={css.notes}>
            <li>{t('activityHint')}</li>
            <li>{t('backgroundHint')}</li>
          </ul>
        </div>
      </article>
    </section>
  )
}
