/** Local taxpayer-entity management page for Xiaojing Finance. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  FinanceClientDraft,
  FinanceClientId,
  FinanceClientListView,
  FinanceClientReadView,
  FinanceSystemKind,
  FinanceYouchengEnvironment,
  FinanceYouchengSystemConfig,
  FinanceYouchengAccount,
  FinanceYouchengAccountsResult,
  ListFinanceYouchengAccountsRequest,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type { FinanceClientsView } from './controller.ts'
import type { FinanceClientsKey } from './locales.ts'
import css from './FinanceClientsSection.module.css'

/** Complete client editor state with the revision captured when editing began. */
export interface EditorState {
  clientId: FinanceClientId
  expectedRevision: number
  draft: FinanceClientDraft
  credentialStatus: FinanceClientReadView['credentialStatus']
  youchengAppSecret: string
  youchengApiUrls: FinanceClientReadView['youchengApiUrls']
}

/** Registration-side operations and catalog feed. */
export interface FinanceClientsSectionInjected {
  hooks: { financeClients: SnapshotStore<FinanceClientsView> }
  load: () => Promise<void>
  read: (clientId: FinanceClientId) => Promise<FinanceClientReadView>
  update: (editor: EditorState) => Promise<void>
  listYouchengAccounts: (request: ListFinanceYouchengAccountsRequest) => Promise<FinanceYouchengAccountsResult>
  archive: (clientId: FinanceClientId, expectedRevision: number) => Promise<void>
}

/** Full settings-section props. */
export type FinanceClientsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'finance.clients'>
  & InjectFace<FinanceClientsSectionInjected>

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function selectFinanceSystem(
  draft: FinanceClientDraft,
  system: '' | FinanceSystemKind,
): FinanceClientDraft {
  if (system === '') {
    const next = { ...draft }
    delete next.financeSystem
    return next
  }
  if (system === 'youcheng') {
    return {
      ...draft,
      financeSystem: draft.financeSystem?.system === 'youcheng'
        ? draft.financeSystem
        : { system, environment: 'test', appKey: '', accountCode: '' },
    }
  }
  return { ...draft, financeSystem: { system } }
}

function updateYoucheng<Field extends Exclude<keyof FinanceYouchengSystemConfig, 'system'>>(
  draft: FinanceClientDraft,
  field: Field,
  value: FinanceYouchengSystemConfig[Field],
): FinanceClientDraft {
  const current: FinanceYouchengSystemConfig = draft.financeSystem?.system === 'youcheng'
    ? draft.financeSystem
    : { system: 'youcheng', environment: 'test', appKey: '', accountCode: '' }
  return { ...draft, financeSystem: { ...current, [field]: value } }
}

function selectYouchengAccount(
  draft: FinanceClientDraft,
  account: FinanceYouchengAccount | undefined,
): FinanceClientDraft {
  const current: FinanceYouchengSystemConfig = draft.financeSystem?.system === 'youcheng'
    ? draft.financeSystem
    : { system: 'youcheng', environment: 'test', appKey: '', accountCode: '' }
  const next: FinanceYouchengSystemConfig = { ...current, accountCode: account?.id ?? '' }
  delete next.accountName
  if (account !== undefined) next.accountName = account.name
  return { ...draft, financeSystem: next }
}

function titleOf(client: FinanceClientListView['clients'][number]): string {
  return client.shortName ?? client.legalName
}

/** Render the client-management settings section. */
export function FinanceClientsSection(props: FinanceClientsSectionProps): ReactNode {
  const { useFinanceClients, load, t } = props
  const state = useFinanceClients(snapshot => snapshot)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<FinanceClientId | null>(null)

  useEffect(() => { void load() }, [load])

  const active = state.catalog.clients.filter(client => client.status === 'active')
  const archived = state.catalog.clients.filter(client => client.status === 'archived')

  const edit = async (clientId: FinanceClientId): Promise<void> => {
    setLocalError(null)
    try {
      const read = await props.read(clientId)
      setEditor({
        clientId,
        expectedRevision: read.revision,
        draft: read.client,
        credentialStatus: read.credentialStatus,
        youchengAppSecret: '',
        youchengApiUrls: read.youchengApiUrls,
      })
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }

  const save = async (): Promise<void> => {
    if (editor === null || saving) return
    setSaving(true)
    setLocalError(null)
    try {
      await props.update(editor)
      setEditor(null)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
      await load()
    } finally {
      setSaving(false)
    }
  }

  const archive = async (clientId: FinanceClientId): Promise<void> => {
    setSaving(true)
    setLocalError(null)
    try {
      await props.archive(clientId, state.catalog.revision)
      setArchiveTarget(null)
      if (editor?.clientId === clientId) setEditor(null)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (state.status === 'loading' && state.catalog.clients.length === 0) {
    return <p className={css.status}>{t('loading')}</p>
  }

  return (
    <div className={css.section}>
      <header className={css.header}>
        <div>
          <h2>{t('title')}</h2>
          <p>{t('intro')}</p>
        </div>
      </header>

      {state.error === null && localError === null ? null : (
        <div className={css.error} role="alert">
          <span>{localError ?? state.error}</span>
          <button type="button" onClick={() => { void load() }}>{t('retry')}</button>
        </div>
      )}

      <div className={css.layout}>
        <div className={css.catalog}>
          <h3>{t('activeClients')}</h3>
          {active.length === 0 ? <p className={css.empty}>{t('noClients')}</p> : active.map(client => (
            <article className={css.clientCard} key={client.id}>
              <div>
                <strong>{titleOf(client)}</strong>
                {client.shortName === undefined ? null : <span>{client.legalName}</span>}
                <small>{`${client.registeredRegion} · v${String(client.version)}`}</small>
              </div>
              <div className={css.cardActions}>
                <button type="button" onClick={() => { void edit(client.id) }}>{t('edit')}</button>
                <button type="button" className={css.dangerLink} onClick={() => { setArchiveTarget(client.id) }}>
                  {t('archive')}
                </button>
              </div>
              {archiveTarget !== client.id ? null : (
                <div className={css.archiveConfirm}>
                  <p>{t('archiveConfirm')}</p>
                  <button type="button" onClick={() => { setArchiveTarget(null) }}>{t('cancel')}</button>
                  <button type="button" disabled={saving} onClick={() => { void archive(client.id) }}>
                    {t('confirmArchive')}
                  </button>
                </div>
              )}
            </article>
          ))}

          {archived.length === 0 ? null : (
            <>
              <h3 className={css.archivedHeading}>{t('archivedClients')}</h3>
              {archived.map(client => (
                <article className={`${css.clientCard} ${css.archived}`} key={client.id}>
                  <div>
                    <strong>{titleOf(client)}</strong>
                    <small>{client.legalName}</small>
                  </div>
                </article>
              ))}
            </>
          )}
        </div>

        {editor === null ? (
          <div className={css.placeholder}>{t('intro')}</div>
        ) : (
          <ClientEditor
            key={`${editor.clientId}:${String(editor.expectedRevision)}`}
            editor={editor}
            saving={saving}
            t={t}
            listYouchengAccounts={props.listYouchengAccounts}
            onChange={setEditor}
            onCancel={() => { setEditor(null); setLocalError(null) }}
            onSave={() => { void save() }}
          />
        )}
      </div>
    </div>
  )
}

export interface ClientEditorProps {
  editor: EditorState
  saving: boolean
  t: (key: FinanceClientsKey) => string
  showHeading?: boolean
  /** Keep actions outside the scrolling fields when hosted in a bounded dialog. */
  contained?: boolean
  /** Independently saved system settings, rendered inside the scroll area. */
  additionalSettings?: ReactNode
  savedAccountName?: string | undefined
  listYouchengAccounts: (request: ListFinanceYouchengAccountsRequest) => Promise<FinanceYouchengAccountsResult>
  onChange: (editor: EditorState) => void
  onCancel: () => void
  onSave: () => void
}

export function ClientEditor({
  editor,
  saving,
  t,
  showHeading = true,
  contained = false,
  additionalSettings,
  savedAccountName,
  listYouchengAccounts,
  onChange,
  onCancel,
  onSave,
}: ClientEditorProps): ReactNode {
  const lookupGeneration = useRef(0)
  const [lookup, setLookup] = useState<
    | { state: 'idle' | 'loading' }
    | { state: 'ready'; accounts: FinanceYouchengAccount[] }
    | { state: 'failed'; message: string }
  >({ state: 'idle' })
  useEffect(() => () => { lookupGeneration.current += 1 }, [])
  const draft = editor.draft
  const setDraft = (next: FinanceClientDraft): void => { onChange({ ...editor, draft: next }) }
  const resetLookup = (): void => {
    lookupGeneration.current += 1
    setLookup({ state: 'idle' })
  }
  const changeYoucheng = (key: 'environment' | 'appKey', value: string): void => {
    resetLookup()
    const next = key === 'environment'
      ? updateYoucheng(draft, key, value as FinanceYouchengEnvironment)
      : updateYoucheng(draft, key, value)
    setDraft(selectYouchengAccount(next, undefined))
  }
  const field = (key: keyof FinanceClientDraft, value: string): void => {
    setDraft({ ...draft, [key]: optional(value) })
  }
  const required = (key: 'legalName' | 'shortName' | 'registeredRegion', value: string): void => {
    setDraft({ ...draft, [key]: value })
  }
  const youcheng = draft.financeSystem?.system === 'youcheng' ? draft.financeSystem : undefined
  const hasYouchengSecret = editor.credentialStatus.youchengAppSecretConfigured
    || editor.youchengAppSecret.trim() !== ''
  const fetching = lookup.state === 'loading'
  const fetchAccounts = async (): Promise<void> => {
    if (youcheng === undefined || fetching || saving) return
    const generation = ++lookupGeneration.current
    setLookup({ state: 'loading' })
    setDraft(selectYouchengAccount(draft, undefined))
    try {
      const secret = editor.youchengAppSecret.trim()
      const result = await listYouchengAccounts({
        clientId: editor.clientId, expectedRevision: editor.expectedRevision,
        environment: youcheng.environment, appKey: youcheng.appKey.trim(),
        ...secret === '' ? {} : { youchengAppSecret: secret },
      })
      if (generation !== lookupGeneration.current) return
      setLookup(result.state === 'ready' ? result : { state: 'failed', message: t(`connection.${result.failure}`) })
    } catch (_error) {
      if (generation !== lookupGeneration.current) return
      setLookup({ state: 'failed', message: t('accountLookupFailed') })
    }
  }
  const canSave = draft.legalName.trim() !== ''
    && (draft.shortName?.trim() ?? '') !== ''
    && draft.registeredRegion.trim() !== ''
    && (youcheng === undefined || (
      youcheng.appKey.trim() !== ''
      && youcheng.accountCode.trim() !== ''
      && hasYouchengSecret
    ))
    && !saving && !fetching

  return (
    <form className={clsx(css.editor, contained && css.containedEditor)} onSubmit={(event) => {
      event.preventDefault()
      if (canSave) onSave()
    }}>
      <div className={css.fields} role={contained ? 'region' : undefined} aria-label={contained ? t('editorFields') : undefined} tabIndex={contained ? 0 : undefined}>
        {showHeading ? <h3>{t('editTitle')}</h3> : null}
        <fieldset disabled={saving}>
          <legend>{t('basicDetails')}</legend>
          <div className={css.grid}>
            <label className={css.wide}><span>{t('legalName')}</span><input required value={draft.legalName} onChange={(event) => { required('legalName', event.target.value) }} /></label>
            <label><span>{t('shortName')} <small>{t('shortNameHint')}</small></span><input required aria-label={t('shortName')} value={draft.shortName ?? ''} onChange={(event) => { required('shortName', event.target.value) }} /></label>
            <label><span>{t('creditCode')} <small>{t('optional')}</small></span><input maxLength={18} value={draft.unifiedSocialCreditCode ?? ''} onChange={(event) => { field('unifiedSocialCreditCode', event.target.value.toUpperCase()) }} /></label>
            <label><span>{t('taxpayerType')}</span><select value={draft.taxpayerType} onChange={(event) => { setDraft({ ...draft, taxpayerType: event.target.value as FinanceClientDraft['taxpayerType'] }) }}><option value="general-vat">{t('taxpayerGeneral')}</option><option value="small-scale-vat">{t('taxpayerSmall')}</option><option value="other">{t('taxpayerOther')}</option></select></label>
            <label><span>{t('region')}</span><input required value={draft.registeredRegion} onChange={(event) => { required('registeredRegion', event.target.value) }} /></label>
            <label><span>{t('accountingStandard')}</span><select value={draft.accountingStandard} onChange={(event) => { setDraft({ ...draft, accountingStandard: event.target.value as FinanceClientDraft['accountingStandard'] }) }}><option value="enterprise">{t('standardEnterprise')}</option><option value="small-enterprise">{t('standardSmall')}</option><option value="government">{t('standardGovernment')}</option><option value="nonprofit">{t('standardNonprofit')}</option><option value="other">{t('standardOther')}</option></select></label>
            <label><span>{t('industry')} <small>{t('optional')}</small></span><input value={draft.industry ?? ''} onChange={(event) => { field('industry', event.target.value) }} /></label>
            <details className={clsx(css.policyNotes, css.wide)}>
              <summary>{t('policyNotes')} <small>{t('optional')}</small></summary>
              <textarea aria-label={t('policyNotes')} rows={3} value={draft.financePolicyNotes ?? ''} onChange={(event) => { field('financePolicyNotes', event.target.value) }} />
            </details>
          </div>
        </fieldset>

        <fieldset disabled={saving}>
          <legend>{t('financeSystemConfig')}</legend>
          <div className={css.systemGrid}>
            <label className={css.wide}>
              <span>{t('financeSystem')}</span>
              <select
                value={draft.financeSystem?.system ?? ''}
                onChange={(event) => {
                  resetLookup()
                  setDraft(selectFinanceSystem(draft, event.target.value as '' | FinanceSystemKind))
                }}
              >
                <option value="">{t('noFinanceSystem')}</option>
                <option value="youcheng">{t('youcheng')}</option>
                <option value="sdoo">{t('sdoo')}</option>
                <option value="yonyou">{t('yonyou')}</option>
                <option value="kingdee">{t('kingdee')}</option>
              </select>
            </label>

            {youcheng === undefined ? null : (
              <>
                <label>
                  <span>{t('apiEnvironment')}</span>
                  <select
                    value={youcheng.environment}
                    onChange={(event) => { changeYoucheng('environment', event.target.value) }}
                  >
                    <option value="test">{t('environmentTest')}</option>
                    <option value="production">{t('environmentProduction')}</option>
                  </select>
                </label>
                <label>
                  <span>{t('apiAddress')}</span>
                  <input readOnly value={editor.youchengApiUrls[youcheng.environment]} />
                </label>
                <small className={clsx(css.credentialHint, css.wide)}>{t('environmentHint')}</small>
                <label className={css.wide}>
                  <span>{t('appKey')}</span>
                  <input required maxLength={200} autoComplete="off" value={youcheng.appKey} onChange={(event) => { changeYoucheng('appKey', event.target.value) }} />
                </label>
                <label className={css.wide}>
                  <span>{t('appSecret')}</span>
                  <input
                    aria-label={t('appSecret')}
                    type="password"
                    maxLength={4096}
                    required={!editor.credentialStatus.youchengAppSecretConfigured}
                    autoComplete="new-password"
                    disabled={!editor.credentialStatus.youchengAppSecretWritable}
                    placeholder={editor.credentialStatus.youchengAppSecretConfigured
                      ? t('appSecretConfiguredPlaceholder')
                      : t('appSecretPlaceholder')}
                    value={editor.youchengAppSecret}
                    onChange={(event) => {
                      resetLookup()
                      onChange({ ...editor, draft: selectYouchengAccount(draft, undefined), youchengAppSecret: event.target.value })
                    }}
                  />
                  <small className={css.credentialHint}>
                    {editor.credentialStatus.youchengAppSecretConfigured
                      ? t('appSecretConfigured')
                      : t('appSecretNotConfigured')}
                  </small>
                </label>
                <div className={clsx(css.wide, css.accountLookup)}>
                  <button type="button" className={css.secondary}
                    disabled={saving || fetching || youcheng.appKey.trim() === '' || !hasYouchengSecret}
                    onClick={() => { void fetchAccounts() }}>
                    {t(fetching ? 'fetchingAccounts' : 'fetchAccounts')}
                  </button>
                  <small>{t('accountLookupHint')}</small>
                  {lookup.state === 'failed' ? <p role="alert">{lookup.message}</p> : null}
                  {lookup.state === 'ready' ? <p role="status">{lookup.accounts.length === 0
                    ? t('noAccounts') : `${t('availableAccounts')} ${String(lookup.accounts.length)}`}</p> : null}
                </div>
                <label className={css.wide}>
                  <span>{t('accountSelection')}</span>
                  <select value={youcheng.accountCode} disabled={lookup.state !== 'ready' || lookup.accounts.length === 0}
                    onChange={(event) => {
                      const account = lookup.state === 'ready'
                        ? lookup.accounts.find(candidate => candidate.id === event.target.value)
                        : undefined
                      setDraft(selectYouchengAccount(draft, account))
                    }}>
                    <option value="">{t(lookup.state === 'ready' ? 'chooseAccount' : 'fetchAccountsFirst')}</option>
                    {lookup.state === 'ready' ? lookup.accounts.map(account => (
                      <option key={account.id} value={account.id}>{`${account.name} · ID ${account.id}`}</option>
                    )) : youcheng.accountCode === '' ? null : (
                      <option value={youcheng.accountCode}>{`${youcheng.accountName ?? savedAccountName ?? t('savedAccount')} · ID ${youcheng.accountCode}`}</option>
                    )}
                  </select>
                </label>
                <p className={clsx(css.systemNotice, css.wide)}>{t('connectionCheckHint')}</p>
              </>
            )}

            {draft.financeSystem === undefined || draft.financeSystem.system === 'youcheng' ? null : (
              <p className={`${css.systemNotice} ${css.wide}`}>{t('systemNotSupported')}</p>
            )}
            {draft.financeSystem !== undefined ? null : (
              <p className={`${css.systemNotice} ${css.wide}`}>{t('noFinanceSystemHint')}</p>
            )}
          </div>
        </fieldset>
        {additionalSettings}
      </div>
      <div className={css.editorActions}>
        <button type="button" className={css.secondary} disabled={saving} onClick={onCancel}>{t('cancel')}</button>
        <button type="submit" className={css.primary} disabled={!canSave}>{saving ? t(youcheng === undefined ? 'saving' : 'savingAndChecking') : t('save')}</button>
      </div>
    </form>
  )
}
