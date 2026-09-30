/** Customer record editor opened from a Finance workspace action menu. */
import { useEffect, useState, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FinanceClientId } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type { FinanceClientsView } from './controller.ts'
import { ClientEditor, type ClientEditorProps, type EditorState } from './FinanceClientsSection.tsx'
import css from './FinanceClientDetailsOverlay.module.css'

export interface FinanceClientDetailsOverlayInjected {
  hooks: { financeClients: SnapshotStore<FinanceClientsView> }
  read: (clientId: FinanceClientId) => Promise<import('@deepseek-ai/dsh-xiaojing-finance-domain/types').FinanceClientReadView>
  update: (editor: EditorState) => Promise<void>
  listYouchengAccounts: ClientEditorProps['listYouchengAccounts']
  close: () => void
}

export type FinanceClientDetailsOverlayProps = PropsRuntime<'shell.overlay'> & PropsLocale<'finance.clients'> & InjectFace<FinanceClientDetailsOverlayInjected>

/** Render the revision-safe full customer editor in a modal. */
export function FinanceClientDetailsOverlay(props: FinanceClientDetailsOverlayProps): ReactNode {
  const state = props.useFinanceClients(snapshot => snapshot)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const target = state.clientEditing ?? null

  useEffect(() => {
    if (target === null) { setEditor(null); return }
    let cancelled = false
    setEditor(null); setError(null)
    void props.read(target).then((read) => {
      if (cancelled) return
      setEditor({
        clientId: target,
        expectedRevision: read.revision,
        draft: read.client,
        credentialStatus: read.credentialStatus,
        youchengAppSecret: '',
        youchengApiUrls: read.youchengApiUrls,
      })
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [target, props.read, reload])

  const close = (): void => { if (!saving) props.close() }
  const save = async (): Promise<void> => {
    if (editor === null || saving) return
    setSaving(true); setError(null)
    try { await props.update(editor); props.close() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }

  return <Modal open={target !== null} onClose={close} title={props.t('editTitle')} headless className={css.dialog ?? ''}>
    <header className={css.header}>
      <h2>{props.t('editTitle')}</h2>
      <button type="button" className={css.close} aria-label={props.t('cancel')} disabled={saving} onClick={close}>
        <IconCloseOutlineRegular />
      </button>
    </header>
    {error === null && editor === null ? <p className={css.message} role="status">{props.t('loading')}</p> : null}
    {error === null ? null : <div className={css.message} role="alert"><p>{error}</p><button type="button" disabled={saving} onClick={() => { setReload(value => value + 1) }}>{props.t('retry')}</button></div>}
    {editor === null ? null : (
      <ClientEditor
        key={`${editor.clientId}:${String(editor.expectedRevision)}`}
        editor={editor}
        saving={saving}
        t={props.t}
        showHeading={false}
        contained
        listYouchengAccounts={props.listYouchengAccounts}
        savedAccountName={state.workspaces?.clients.find(client => client.clientId === editor.clientId)?.connection?.accountName}
        onChange={setEditor}
        onCancel={close}
        onSave={() => { void save() }}
      />
    )}
  </Modal>
}
