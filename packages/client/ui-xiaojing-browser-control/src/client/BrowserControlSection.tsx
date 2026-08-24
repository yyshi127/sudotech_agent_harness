/** Managed and personal Edge automation settings section. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserControlController, BrowserControlView } from './controller.ts'
import type { BrowserControlKey } from './locales.ts'
import css from './BrowserControlSection.module.css'

/** Registration-side dependencies of the browser-control page. */
export interface BrowserControlSectionInjected {
  hooks: {
    /** Sanitized Host status bound to `useBrowserControl` by the slot renderer. */
    browserControl: HostObservable<BrowserControlView>
  }
  actions: Pick<BrowserControlController,
    'load' | 'startPairing' | 'cancelPairing' | 'disconnect' | 'revealExtension' | 'openExtensionManager'>
  /** Translate browser-control copy in the active locale. */
  t: (key: BrowserControlKey) => string
}

/** Complete browser-control section props. */
export type BrowserControlSectionProps = PropsRuntime<'settings.section'> & InjectFace<BrowserControlSectionInjected>

function EdgeMark(): ReactNode {
  return <span className={css.mark} aria-hidden="true">e</span>
}

function personalStateLabel(view: BrowserControlView, t: BrowserControlSectionInjected['t']): string {
  const personal = view.snapshot?.personal
  if (personal === undefined) return t('loading')
  switch (personal.state) {
    case 'connected': return t('connected')
    case 'pairing': return t('pairing')
    case 'incompatible': return t('incompatible')
    case 'error': return t('unavailable')
    default: return personal.paired ? t('authorized') : t('notConnected')
  }
}

/** Render dedicated managed Edge and optional personal Edge controls. */
export function BrowserControlSection({ useBrowserControl, actions, t }: BrowserControlSectionProps): ReactNode {
  const view = useBrowserControl(state => state)
  const [clock, setClock] = useState(Date.now())
  const snapshot = view.snapshot
  const personal = snapshot?.personal

  useEffect(() => {
    void actions.load()
    const refresh = setInterval(() => { void actions.load() }, 2_000)
    return () => { clearInterval(refresh) }
  }, [actions])

  useEffect(() => {
    if (personal?.pairingExpiresAt === undefined) return
    const tick = setInterval(() => { setClock(Date.now()) }, 1_000)
    return () => { clearInterval(tick) }
  }, [personal?.pairingExpiresAt])

  const seconds = useMemo(() => personal?.pairingExpiresAt === undefined
    ? 0
    : Math.max(0, Math.ceil((personal.pairingExpiresAt - clock) / 1_000)), [clock, personal?.pairingExpiresAt])

  return (
    <section className={css.root}>
      <header className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </header>

      {view.error !== null && <p className={css.error}>{view.error}</p>}

      <article className={css.card}>
        <div className={css.cardHeader}>
          <div className={css.identity}>
            <EdgeMark />
            <div><strong>{t('managedTitle')}</strong><span>{t('managedDescription')}</span></div>
          </div>
          <span className={css.readyBadge}><i />{snapshot?.managed.running ? t('running') : t('ready')}</span>
        </div>
        <div className={css.features}>
          <span>{t('managedFeatureReuse')}</span>
          <span>{t('managedFeatureBackground')}</span>
          <span>{t('managedFeatureProfile')}</span>
        </div>
      </article>

      <article className={css.card}>
        <div className={css.cardHeader}>
          <div className={css.identity}>
            <EdgeMark />
            <div><strong>{t('personalTitle')}</strong><span>{t('personalDescription')}</span></div>
          </div>
          <span className={personal?.state === 'connected' ? css.readyBadge : css.badge}>
            <i />{personalStateLabel(view, t)}
          </span>
        </div>

        {personal?.error !== undefined && <p className={css.notice}>{personal.error}</p>}

        <ol className={css.steps}>
          <li>{t('installStepManager')}</li>
          <li>{t('installStepDeveloper')}</li>
          <li>{t('installStepLoad')}</li>
          <li>{t('installStepPair')}</li>
        </ol>

        <div className={css.actions}>
          <button className={css.secondary} disabled={view.busy} onClick={() => { void actions.openExtensionManager() }}>
            {t('openManager')}
          </button>
          <button className={css.secondary} disabled={view.busy} onClick={() => { void actions.revealExtension() }}>
            {t('openFolder')}
          </button>
        </div>

        {personal?.state === 'pairing' && personal.pairingCode !== undefined ? (
          <div className={css.pairing}>
            <div><span>{t('pairingCode')}</span><code>{personal.pairingCode}</code></div>
            <p>{t('pairingHint')} · {t('expires')} {seconds} {t('seconds')}</p>
            <button className={css.secondary} disabled={view.busy} onClick={() => { void actions.cancelPairing() }}>
              {t('cancelPairing')}
            </button>
          </div>
        ) : (
          <div className={css.connectionActions}>
            {personal?.state !== 'connected' && personal?.state !== 'incompatible' && (
              <button className={css.primary} disabled={view.busy || snapshot === null} onClick={() => { void actions.startPairing() }}>
                {personal?.paired ? t('pairAgain') : t('startPairing')}
              </button>
            )}
            {(personal?.paired === true || personal?.connected === true) && (
              <button className={css.danger} disabled={view.busy} onClick={() => { void actions.disconnect() }}>
                {t('revoke')}
              </button>
            )}
          </div>
        )}

        {personal !== undefined && (
          <dl className={css.metadata}>
            <div><dt>{t('extensionId')}</dt><dd>{personal.extensionId}</dd></div>
            <div><dt>{t('extensionVersion')}</dt><dd>{personal.version ?? t('notDetected')}</dd></div>
          </dl>
        )}
        <p className={css.safety}>{t('personalSafety')}</p>
      </article>
    </section>
  )
}
