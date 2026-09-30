/** Computer-wide OSS settings; credentials remain write-only and never enter session state. */
import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AttachmentStorageView, AttachmentStorageTestResult, SaveAttachmentStorageRequest,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import css from './AttachmentStorageSection.module.css'

/** Registration-side callbacks for the loopback-only attachment settings page. */
export interface AttachmentStorageSectionInjected {
  load: () => Promise<AttachmentStorageView>
  save: (request: SaveAttachmentStorageRequest) => Promise<AttachmentStorageView>
  test: (revision: number) => Promise<AttachmentStorageTestResult>
}

/** Settings slot props with framework-bound locale and Host callbacks. */
export type AttachmentStorageSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'finance.clients'> & InjectFace<AttachmentStorageSectionInjected>

/** Render an editable local draft; save does not imply a successful cloud test. */
export function AttachmentStorageSection(props: AttachmentStorageSectionProps): ReactNode {
  const [view, setView] = useState<AttachmentStorageView | null>(null)
  const [id, setId] = useState('')
  const [secret, setSecret] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<AttachmentStorageTestResult | null>(null)
  const [reload, setReload] = useState(0)
  const t = props.t
  useEffect(() => {
    let cancelled = false
    setView(null); setError(null); setMessage(''); setResult(null); setDirty(false); setId(''); setSecret('')
    void props.load().then((next) => { if (!cancelled) setView(next) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [props.load, reload])

  const edited = (): void => { setDirty(true); setResult(null); setMessage(''); setError(null) }
  const save = async (): Promise<void> => {
    if (view === null || busy) return
    setBusy(true); setError(null); setMessage(''); setResult(null)
    try {
      const next = await props.save({
        expectedRevision: view.revision, config: view.config,
        ...(id.trim() === '' ? {} : { accessKeyId: id.trim() }),
        ...(secret.trim() === '' ? {} : { accessKeySecret: secret.trim() }),
      })
      setView(next); setId(''); setSecret(''); setDirty(false); setMessage(t('storageSaved'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const test = async (): Promise<void> => {
    if (view === null || busy || dirty) return
    setBusy(true); setError(null); setMessage(''); setResult(null)
    try { setResult(await props.test(view.revision)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <section className={css.root}>
    <header><h2>{t('storageTitle')}</h2><p>{t('storageIntro')}</p></header>
    {error === null ? null : <div role="alert" className={css.error}>{error}</div>}
    {view === null ? <button type="button" onClick={() => { setReload(value => value + 1) }}>{t('retry')}</button> : <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <fieldset disabled={busy || !view.writable} className={css.fields}>
        <legend>{t('storageProvider')}</legend>
        <div className={css.grid}>
          {(['bucket', 'region', 'endpoint', 'prefix'] as const).map(key => <label key={key}>
            <span>{t(`storage.${key}`)}</span>
            <input required value={view.config[key]} onChange={(event) => { edited(); setView({ ...view, config: { ...view.config, [key]: event.target.value } }) }} autoComplete="off" spellCheck={false} />
          </label>)}
          <label><span>{t('storageAccessKeyId')}</span><input type="password" autoComplete="new-password" value={id} required={!view.configured} placeholder={view.configured ? t('storageKeepKeys') : ''} onChange={(event) => { edited(); setId(event.target.value) }} /></label>
          <label><span>{t('storageAccessKeySecret')}</span><input type="password" autoComplete="new-password" value={secret} required={!view.configured} placeholder={view.configured ? t('storageKeepKeys') : ''} onChange={(event) => { edited(); setSecret(event.target.value) }} /></label>
        </div>
        <p className={css.hint}>{t('storageKeyHelp')}</p>
      </fieldset>
      <p className={css.hint}>{t('storageTestHelp')}</p>
      {!view.writable && <p role="alert">{t('storageReadOnly')}</p>}
      <div className={css.actions}>
        <button type="submit" disabled={busy || !view.writable}>{busy ? t('storageWorking') : t('save')}</button>
        <button type="button" disabled={busy || dirty || !view.configured} onClick={() => { void test() }}>{t('storageTest')}</button>
        <button type="button" disabled={busy} onClick={() => { setReload(value => value + 1) }}>{t('storageReload')}</button>
      </div>
      <p role="status" className={css.status}>{message || (dirty ? t('storageUnsaved') : view.configured ? t('storageConfigured') : t('storageNotConfigured'))}</p>
      {result !== null && <div role={result.uploaded && result.downloaded && result.deleted ? 'status' : 'alert'} className={css.result}>
        <strong>{result.uploaded && result.downloaded && result.deleted ? t('storagePassed') : t('storageFailed')}</strong>
        <p>{result.message}</p>
      </div>}
    </form>}
  </section>
}
