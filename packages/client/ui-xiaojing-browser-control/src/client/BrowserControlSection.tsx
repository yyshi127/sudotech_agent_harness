/** Existing-tab permissions and observed native browser connection states. */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconBrowseOutlineRegular, IconCopyOutlineRegular, Input, Modal, StateDot, Switch, writeClipboard, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeBrowser, NativeBrowserState } from '@deepseek-ai/dsh-xiaojing-browser-control/native-settings-types'
import type { BrowserControlController, BrowserControlView } from './controller.ts'
import type { BrowserControlKey } from './locales.ts'
import css from './BrowserControlSection.module.css'

/** Registration-side dependencies of the browser-control page. */
export interface BrowserControlSectionInjected {
  hooks: {
    /** Sanitized Host status bound to `useBrowserControl` by the slot renderer. */
    browserControl: HostObservable<BrowserControlView>
  }
  actions: Pick<BrowserControlController, 'load' | 'setEnabled' | 'openSettings'>
  /** Translate browser-control copy in the active locale. */
  t: (key: BrowserControlKey) => string
}

/** Complete browser-control section props. */
export type BrowserControlSectionProps = PropsRuntime<'settings.section'> & InjectFace<BrowserControlSectionInjected>

function dotState(state: NativeBrowserState, error: string | undefined): StateDotState {
  switch (state) {
    case 'connected': return 'done'
    case 'connecting': return 'ongoing'
    case 'setup-required': return 'warning'
    case 'disconnected': return error === undefined ? 'idle' : 'error'
    case 'disabled':
    case 'ready': return 'idle'
    default: return assertNever(state)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected native browser state: ${String(value)}`)
}

function BrowserSetupGuide({ browser, busy, canOpenSettings, actions, onClose, t }: {
  browser: NativeBrowser
  busy: boolean
  canOpenSettings: boolean
  actions: Pick<BrowserControlController, 'openSettings'>
  onClose: () => void
  t: (key: BrowserControlKey) => string
}): ReactNode {
  const [copy, setCopy] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const [opening, setOpening] = useState<'idle' | 'opening' | 'opened' | 'failed'>('idle')
  const address = browser === 'chrome' ? 'chrome://inspect/#remote-debugging' : 'edge://inspect/#remote-debugging'
  return (
    <Modal open onClose={onClose} title={t(browser === 'chrome' ? 'guideChrome' : 'guideEdge')}
      closeLabel={t('closeGuide')} description={t('guideDescription')} className={css.guide as string}
      footer={<Button onClick={onClose}>{t('guideDone')}</Button>}>
      {canOpenSettings ? <Button variant="primary" disabled={busy || opening === 'opening'} onClick={() => {
        if (busy || opening === 'opening') return
        setOpening('opening')
        void actions.openSettings(browser).then((opened) => { setOpening(opened ? 'opened' : 'failed') })
      }}>
        <IconBrowseOutlineRegular size={16} />{t(opening === 'opening' ? 'openingSettings' : browser === 'chrome' ? 'openChromeSettings' : 'openEdgeSettings')}
      </Button> : <p>{t('manualSettingsOnly')}</p>}
      {opening === 'opened' && <p role="status">{t('settingsOpened')}</p>}
      {opening === 'failed' && <p className={css.copyError} role="alert"><StateDot state="error" /><span>{t('settingsOpenFailed')}</span></p>}
      <div className={css.address}>
        <Input readOnly value={address} aria-label={t('addressLabel')} data-modal-autofocus
          onFocus={(event) => { event.currentTarget.select() }} />
        <Button size="sm" variant="outline" disabled={copy === 'copying'}
          onClick={() => {
            setCopy('copying')
            void writeClipboard(address).then((ok) => { setCopy(ok ? 'copied' : 'failed') })
          }}>
          <IconCopyOutlineRegular size={16} />{t(copy === 'copied' ? 'addressCopied' : 'copyAddress')}
        </Button>
      </div>
      {copy === 'failed' && <p className={css.copyError} role="alert"><StateDot state="error" /><span>{t('copyFailed')}</span></p>}
      <ol className={css.steps}>
        <li>{t(browser === 'chrome' ? 'guideOpenChrome' : 'guideOpenEdge')}</li>
        <li>{t('guideAllow')}</li>
        <li>{t('guideConnect')}</li>
      </ol>
    </Modal>
  )
}

/**
 * Render Chrome and Edge permissions without creating browser connections.
 * @param props - settings runtime hooks, fixed Host actions, and localized copy.
 * @returns the native browser settings section.
 */
export function BrowserControlSection({ useBrowserControl, actions, t }: BrowserControlSectionProps): ReactNode {
  const view = useBrowserControl(state => state)
  const snapshot = view.snapshot
  const [managedBrowser, setManagedBrowser] = useState<NativeBrowser | null>(null)

  useEffect(() => {
    void actions.load()
    const refresh = setInterval(() => { void actions.load() }, 2_000)
    return () => { clearInterval(refresh) }
  }, [actions])

  return (
    <section className={css.root}>
      <header className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </header>

      {view.error !== null && (
        <div className={css.errorNotice} role="alert">
          <StateDot state="error" />
          <p>{view.error}</p>
          <Button size="sm" disabled={view.busy} onClick={() => { void actions.load() }}>{t('retry')}</Button>
        </div>
      )}

      {snapshot === null ? (
        view.status !== 'error' && <div className={css.loading} role="status" aria-label={t('loading')}><StateDot state="ongoing" size={24} /></div>
      ) : (
        <>
          <div className={css.browsers}>
            {snapshot.browsers.map(row => (
              <article className={css.row} key={row.browser}>
                <span className={css.browserIcon}><IconBrowseOutlineRegular size={24} /></span>
                <div className={css.details}>
                  <div className={css.name}><strong>{t(row.browser)}</strong><span>{t(row.installed === null ? 'detectionFailed' : row.installed ? 'installed' : 'notInstalled')}</span></div>
                  <div className={css.connection}>
                    <StateDot state={dotState(row.state, row.error)} />
                    <span>{t(row.state)}</span>
                  </div>
                  {row.error !== undefined && <p className={css.rowError}><StateDot state="error" /><span>{row.error}</span></p>}
                </div>
                <div className={css.actions}>
                  <Button size="sm" variant="outline" disabled={view.busy || row.installed !== true}
                    aria-label={t(row.browser === 'chrome' ? 'manageChrome' : 'manageEdge')}
                    onClick={() => { setManagedBrowser(row.browser) }}>
                    {t('manage')}
                  </Button>
                  <Switch checked={row.enabled} disabled={view.busy || (row.installed !== true && !row.enabled)}
                    label={t(row.browser === 'chrome' ? 'enableChrome' : 'enableEdge')}
                    onChange={(enabled) => {
                      void actions.setEnabled(row.browser, enabled).then((confirmed) => {
                        const browser = confirmed?.browsers.find(item => item.browser === row.browser)
                        if (enabled && browser?.enabled && !browser.setupReady) setManagedBrowser(row.browser)
                      })
                    }} />
                </div>
              </article>
            ))}
          </div>
          <p className={css.hint}>{t('setupHint')}</p>
          <p className={css.hint}>{t('disableHint')}</p>
        </>
      )}
      {managedBrowser !== null && <BrowserSetupGuide key={managedBrowser} browser={managedBrowser}
        busy={view.busy} canOpenSettings={snapshot?.canOpenSettings === true} actions={actions}
        onClose={() => { setManagedBrowser(null) }} t={t} />}
    </section>
  )
}
