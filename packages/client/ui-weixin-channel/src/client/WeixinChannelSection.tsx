/** Weixin pairing and connection state page. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WeixinChannelView, WeixinChannelController } from './controller.ts'
import type { WeixinChannelKey } from './locales.ts'
import css from './WeixinChannelSection.module.css'

/** Registration-side dependencies of the channel settings section. */
export interface WeixinChannelSectionInjected {
  hooks: {
    /** Sanitized Host status bound to `useChannel` by the slot renderer. */
    channel: HostObservable<WeixinChannelView>
  }
  actions: Pick<WeixinChannelController, 'load' | 'startPairing' | 'verify' | 'cancelPairing' | 'disconnect'>
  t: (key: WeixinChannelKey) => string
}

/** Complete settings-section props. */
export type WeixinChannelSectionProps = PropsRuntime<'settings.section'> & InjectFace<WeixinChannelSectionInjected>

function WeixinMark(): ReactNode {
  return (
    <span className={css.mark} aria-hidden="true">
      <svg viewBox="0 0 48 48" role="img">
        <path d="M20.5 8C11.4 8 4 14 4 21.4c0 4.2 2.4 8 6.2 10.5L8.8 37l5.5-2.7c2 .7 4 1 6.2 1 9.1 0 16.5-6 16.5-13.4S29.6 8 20.5 8Z" />
        <path className={css.markBack} d="M31.5 19C24.6 19 19 23.5 19 29.1s5.6 10.1 12.5 10.1c1.6 0 3.2-.2 4.7-.8l4.1 2-1.1-3.8c3-1.9 4.8-4.7 4.8-7.6C44 23.5 38.4 19 31.5 19Z" />
        <circle cx="15" cy="20" r="1.8" className={css.eye} />
        <circle cx="25" cy="20" r="1.8" className={css.eye} />
      </svg>
    </span>
  )
}

function stateLabel(state: NonNullable<WeixinChannelView['snapshot']>['state'], t: WeixinChannelSectionInjected['t']): string {
  switch (state) {
    case 'connected': return t('connected')
    case 'pairing': return t('pairing')
    case 'scanned': return t('scannedState')
    case 'verification-required': return t('verificationState')
    case 'reconnecting': return t('reconnecting')
    case 'expired': return t('expiredState')
    case 'token-expired':
    case 'instance-busy':
    case 'error': return t('unavailable')
    default: return t('disconnected')
  }
}

/** Render the default-expanded Weixin channel card. */
export function WeixinChannelSection({ useChannel, actions, t }: WeixinChannelSectionProps): ReactNode {
  const view = useChannel(state => state)
  const [code, setCode] = useState('')
  const [clock, setClock] = useState(Date.now())
  const snapshot = view.snapshot

  useEffect(() => {
    void actions.load()
    const refresh = setInterval(() => { void actions.load() }, 2_000)
    return () => { clearInterval(refresh) }
  }, [actions])

  useEffect(() => {
    if (snapshot?.qrExpiresAt === undefined) return
    const tick = setInterval(() => { setClock(Date.now()) }, 1_000)
    return () => { clearInterval(tick) }
  }, [snapshot?.qrExpiresAt])

  const seconds = useMemo(() => snapshot?.qrExpiresAt === undefined
    ? 0
    : Math.max(0, Math.ceil((snapshot.qrExpiresAt - clock) / 1_000)), [clock, snapshot?.qrExpiresAt])

  return (
    <section className={css.root}>
      <header className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </header>

      <article className={css.card}>
        <div className={css.cardHeader}>
          <div className={css.identity}>
            <WeixinMark />
            <div>
              <strong>{t('weixin')}</strong>
              <span>{t('online')}</span>
            </div>
          </div>
          <span className={snapshot?.state === 'connected' ? css.connectedBadge : css.badge}>
            <i />{snapshot === null ? t('loading') : stateLabel(snapshot.state, t)}
          </span>
        </div>

        {view.error !== null && <p className={css.error}>{view.error}</p>}
        {snapshot?.error !== undefined && <p className={css.notice}>{snapshot.error}</p>}

        {snapshot === null && (
          <div className={css.placeholder}>{t('loading')}</div>
        )}

        {snapshot?.state === 'disconnected' && (
          <div className={css.emptyState}>
            <p>{t('capabilities')}</p>
            <button className={css.primary} disabled={view.busy} onClick={() => { void actions.startPairing() }}>{t('scan')}</button>
          </div>
        )}

        {snapshot !== null && ['pairing', 'scanned', 'verification-required'].includes(snapshot.state) && (
          <div className={css.pairing}>
            <div className={css.qrPane}>
              {snapshot.qrCodeDataUrl !== undefined && <img src={snapshot.qrCodeDataUrl} alt={t('scanTitle')} />}
              <strong>{snapshot.state === 'scanned' ? t('scanned') : t('scanTitle')}</strong>
              <span>{t('expires')} {seconds} {t('seconds')}</span>
            </div>
            <div className={css.pairingCopy}>
              <p>{t('scanHint')}</p>
              {snapshot.verificationRequired && (
                <label className={css.verify}>
                  <span>{t('verifyTitle')}</span>
                  <div>
                    <input
                      inputMode="numeric"
                      value={code}
                      maxLength={8}
                      placeholder={t('verifyPlaceholder')}
                      onChange={(event) => { setCode(event.target.value.replace(/\D/g, '')) }}
                    />
                    <button
                      className={css.primary}
                      disabled={view.busy || code.length < 4}
                      onClick={() => { void actions.verify(code) }}
                    >{t('verify')}</button>
                  </div>
                </label>
              )}
              <button className={css.secondary} disabled={view.busy} onClick={() => { void actions.cancelPairing() }}>{t('cancel')}</button>
            </div>
          </div>
        )}

        {snapshot?.state === 'connected' && (
          <div className={css.connectedBody}>
            <div className={css.account}><span>{t('account')}</span><strong>{snapshot.accountLabel}</strong></div>
            <p>{t('safety')}</p>
            <p>{t('capabilities')}</p>
            <div className={css.actions}>
              <button className={css.secondary} disabled={view.busy} onClick={() => { void actions.startPairing() }}>{t('reconnect')}</button>
              <button className={css.danger} disabled={view.busy} onClick={() => { void actions.disconnect() }}>{t('disconnect')}</button>
            </div>
          </div>
        )}

        {snapshot?.state === 'reconnecting' && (
          <div className={css.emptyState}><span className={css.spinner} /> <p>{t('reconnecting')}</p></div>
        )}

        {snapshot !== null && ['expired', 'token-expired', 'error'].includes(snapshot.state) && (
          <div className={css.emptyState}>
            <p>{snapshot.state === 'token-expired' ? t('tokenExpired') : snapshot.error}</p>
            <button className={css.primary} disabled={view.busy} onClick={() => { void actions.startPairing() }}>{t('retry')}</button>
          </div>
        )}

        {snapshot?.state === 'instance-busy' && <div className={css.emptyState}><p>{t('instanceBusy')}</p></div>}
      </article>
    </section>
  )
}
