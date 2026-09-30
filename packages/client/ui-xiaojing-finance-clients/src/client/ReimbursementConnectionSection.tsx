/** Independently saved reimbursement credentials within an existing account-book editor. */
import { useEffect, useState, type ReactNode } from 'react'
import type { FinanceClientId, ReimbursementConnectionView, SaveReimbursementConnectionRequest } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type { FinanceClientsKey } from './locales.ts'
import css from './FinanceClientsSection.module.css'

/** Plain callbacks injected by the account-book overlay registration. */
export interface ReimbursementConnectionActions {
  read: (id: FinanceClientId) => Promise<ReimbursementConnectionView>
  save: (request: SaveReimbursementConnectionRequest) => Promise<ReimbursementConnectionView>
  test: (id: FinanceClientId) => Promise<string>
}

/** @param props - Owning account-book and independent save/test callbacks. @returns Nested fields, never a nested form. */
export function ReimbursementConnectionSection(props: {
  clientId: FinanceClientId
  actions: ReimbursementConnectionActions
  disabled: boolean
  t: (key: FinanceClientsKey) => string
}): ReactNode {
  const [view, setView] = useState<ReimbursementConnectionView | null>(null)
  const [secret, setSecret] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const t = props.t
  useEffect(() => {
    let cancelled = false
    setView(null); setSecret(''); setDirty(false); setError(''); setMessage('')
    void props.actions.read(props.clientId).then((next) => { if (!cancelled) setView(next) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [props.clientId, props.actions, reload])
  const run = async (save: boolean): Promise<void> => {
    if (view === null || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (save) {
        const next = await props.actions.save({
          clientId: props.clientId, expectedRevision: view.revision, apiUrl: view.apiUrl, appKey: view.appKey,
          ...(secret.trim() ? { appSecret: secret.trim() } : {}) })
        setView(next); setSecret(''); setDirty(false); setMessage(t('reimbursementSaved'))
      } else setMessage(await props.actions.test(props.clientId))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const edit = (): void => { setDirty(true); setMessage(''); setError('') }
  return <fieldset disabled={props.disabled || busy}>
    <legend>{t('reimbursementTitle')}</legend>
    <p className={css.systemNotice}>{t('reimbursementIntro')}</p>
    {view === null ? <p>{t('loading')}</p> : <div className={css.grid}>
      <label className={css.wide}><span>{t('reimbursementApiUrl')}</span><select value={view.apiUrl} onChange={(event) => { edit(); setView({ ...view, apiUrl: event.target.value }) }}>
        <option value="https://yiqbdata.superboss.cc">{t('reimbursementProductionUrl')}</option>
        <option value="https://yiqbdatatest.superboss.cc">{t('reimbursementTestUrl')}</option>
      </select></label>
      <label className={css.wide}><span>{t('reimbursementAppKey')}</span><input value={view.appKey} autoComplete="off" onChange={(event) => { edit(); setView({ ...view, appKey: event.target.value }) }} /></label>
      <label className={css.wide}><span>{t('reimbursementSecret')}</span><input type="password" value={secret} autoComplete="new-password" placeholder={view.configured ? t('appSecretConfiguredPlaceholder') : ''} onChange={(event) => { edit(); setSecret(event.target.value) }} /></label>
      <div className={css.wide}>
        <button type="button" className={css.secondary} disabled={!view.writable} onClick={() => { void run(true) }}>{t('reimbursementSave')}</button>{' '}
        <button type="button" className={css.secondary} disabled={!view.configured || dirty} onClick={() => { void run(false) }}>{t('reimbursementTest')}</button>
      </div>
    </div>}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" className={css.secondary} onClick={() => { setReload(value => value + 1) }}>{t('storageReload')}</button>
  </fieldset>
}
