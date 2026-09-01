/** Local taxpayer-entity management page for Xiaojing Finance. */

import { useEffect, useState, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  FinanceClientDraft,
  FinanceClientId,
  FinanceClientListView,
  FinanceClientReadView,
  FinanceExternalSystemRef,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type { FinanceClientsView } from './controller.ts'
import type { FinanceClientsKey } from './locales.ts'
import css from './FinanceClientsSection.module.css'

/** Complete client editor state with the revision captured when editing began. */
export interface EditorState {
  clientId: FinanceClientId
  expectedRevision: number
  draft: FinanceClientDraft
}

/** Registration-side operations and catalog feed. */
export interface FinanceClientsSectionInjected {
  hooks: { financeClients: SnapshotStore<FinanceClientsView> }
  load: () => Promise<void>
  read: (clientId: FinanceClientId) => Promise<FinanceClientReadView>
  update: (editor: EditorState) => Promise<void>
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

function externalRef(draft: FinanceClientDraft, system: FinanceExternalSystemRef['system']): FinanceExternalSystemRef {
  return draft.externalSystemRefs.find(item => item.system === system) ?? { system }
}

function updateExternal(
  draft: FinanceClientDraft,
  system: FinanceExternalSystemRef['system'],
  field: 'tenantId' | 'companyId' | 'accountSetId',
  value: string,
): FinanceClientDraft {
  const prior = externalRef(draft, system)
  const next: FinanceExternalSystemRef = { ...prior, [field]: optional(value) }
  const present = next.tenantId !== undefined || next.companyId !== undefined || next.accountSetId !== undefined
  const remaining = draft.externalSystemRefs.filter(item => item.system !== system)
  return { ...draft, externalSystemRefs: present ? [...remaining, next] : remaining }
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
      setEditor({ clientId, expectedRevision: read.revision, draft: read.client })
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
            editor={editor}
            saving={saving}
            t={t}
            onChange={setEditor}
            onCancel={() => { setEditor(null); setLocalError(null) }}
            onSave={() => { void save() }}
          />
        )}
      </div>
    </div>
  )
}

interface ClientEditorProps {
  editor: EditorState
  saving: boolean
  t: (key: FinanceClientsKey) => string
  onChange: (editor: EditorState) => void
  onCancel: () => void
  onSave: () => void
}

function ClientEditor({ editor, saving, t, onChange, onCancel, onSave }: ClientEditorProps): ReactNode {
  const draft = editor.draft
  const setDraft = (next: FinanceClientDraft): void => { onChange({ ...editor, draft: next }) }
  const field = (key: keyof FinanceClientDraft, value: string): void => {
    setDraft({ ...draft, [key]: optional(value) })
  }
  const required = (key: 'legalName' | 'registeredRegion', value: string): void => {
    setDraft({ ...draft, [key]: value })
  }
  const canSave = draft.legalName.trim() !== '' && draft.registeredRegion.trim() !== '' && !saving

  return (
    <form className={css.editor} onSubmit={(event) => { event.preventDefault(); onSave() }}>
      <h3>{t('editTitle')}</h3>
      <div className={css.grid}>
        <label className={css.wide}><span>{t('legalName')}</span><input required value={draft.legalName} onChange={(event) => { required('legalName', event.target.value) }} /></label>
        <label><span>{t('shortName')} <small>{t('optional')}</small></span><input value={draft.shortName ?? ''} onChange={(event) => { field('shortName', event.target.value) }} /></label>
        <label><span>{t('creditCode')} <small>{t('optional')}</small></span><input maxLength={18} value={draft.unifiedSocialCreditCode ?? ''} onChange={(event) => { field('unifiedSocialCreditCode', event.target.value.toUpperCase()) }} /></label>
        <label><span>{t('taxpayerType')}</span><select value={draft.taxpayerType} onChange={(event) => { setDraft({ ...draft, taxpayerType: event.target.value as FinanceClientDraft['taxpayerType'] }) }}><option value="general-vat">{t('taxpayerGeneral')}</option><option value="small-scale-vat">{t('taxpayerSmall')}</option><option value="other">{t('taxpayerOther')}</option></select></label>
        <label><span>{t('region')}</span><input required value={draft.registeredRegion} onChange={(event) => { required('registeredRegion', event.target.value) }} /></label>
        <label><span>{t('accountingStandard')}</span><select value={draft.accountingStandard} onChange={(event) => { setDraft({ ...draft, accountingStandard: event.target.value as FinanceClientDraft['accountingStandard'] }) }}><option value="enterprise">{t('standardEnterprise')}</option><option value="small-enterprise">{t('standardSmall')}</option><option value="government">{t('standardGovernment')}</option><option value="nonprofit">{t('standardNonprofit')}</option><option value="other">{t('standardOther')}</option></select></label>
        <label><span>{t('industry')} <small>{t('optional')}</small></span><input value={draft.industry ?? ''} onChange={(event) => { field('industry', event.target.value) }} /></label>
        <label className={css.wide}><span>{t('policyNotes')} <small>{t('optional')}</small></span><textarea rows={4} value={draft.financePolicyNotes ?? ''} onChange={(event) => { field('financePolicyNotes', event.target.value) }} /></label>
      </div>

      <fieldset>
        <legend>{t('mappings')}</legend>
        {draft.chartMappings.map((mapping, index) => (
          <div className={css.mapping} key={index}>
            <input aria-label={t('localAccount')} placeholder={t('localAccount')} value={mapping.localAccountCode} onChange={(event) => { const rows = [...draft.chartMappings]; rows[index] = { ...mapping, localAccountCode: event.target.value }; setDraft({ ...draft, chartMappings: rows }) }} />
            <input aria-label={t('externalAccount')} placeholder={t('externalAccount')} value={mapping.externalAccountCode} onChange={(event) => { const rows = [...draft.chartMappings]; rows[index] = { ...mapping, externalAccountCode: event.target.value }; setDraft({ ...draft, chartMappings: rows }) }} />
            <button type="button" onClick={() => { setDraft({ ...draft, chartMappings: draft.chartMappings.filter((_, row) => row !== index) }) }}>×</button>
          </div>
        ))}
        <button type="button" className={css.secondary} onClick={() => { setDraft({ ...draft, chartMappings: [...draft.chartMappings, { localAccountCode: '', externalAccountCode: '' }] }) }}>{t('addMapping')}</button>
      </fieldset>

      <fieldset>
        <legend>{t('externalSystems')}</legend>
        {(['youcheng', 'sdoo'] as const).map((system) => {
          const ref = externalRef(draft, system)
          return (
            <div className={css.external} key={system}>
              <strong>{t(system)}</strong>
              {(['tenantId', 'companyId', 'accountSetId'] as const).map(key => (
                <label key={key}><span>{t(key)}</span><input value={ref[key] ?? ''} onChange={(event) => { setDraft(updateExternal(draft, system, key, event.target.value)) }} /></label>
              ))}
            </div>
          )
        })}
      </fieldset>

      <div className={css.editorActions}>
        <button type="button" className={css.secondary} onClick={onCancel}>{t('cancel')}</button>
        <button type="submit" className={css.primary} disabled={!canSave}>{saving ? t('saving') : t('save')}</button>
      </div>
    </form>
  )
}
