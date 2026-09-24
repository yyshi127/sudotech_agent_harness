/** Product-owned customer creation dialog opened from the Finance sidebar. */

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CreateFinanceClientRequest,
  FinanceAccountingStandard,
  FinanceClientId,
  FinanceClientMutationResult,
  FinanceTaxpayerType,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type { FinanceClientsView } from './controller.ts'
import css from './FinanceClientCreateOverlay.module.css'

interface ClientDraft {
  legalName: string
  shortName: string
  taxpayerType: '' | FinanceTaxpayerType
  registeredRegion: string
  accountingStandard: '' | FinanceAccountingStandard
}

const EMPTY_CLIENT: ClientDraft = {
  legalName: '',
  shortName: '',
  taxpayerType: '',
  registeredRegion: '',
  accountingStandard: '',
}

/** Operations supplied by the Finance product registration. */
export interface FinanceClientCreateOverlayInjected {
  hooks: { financeClients: SnapshotStore<FinanceClientsView> }
  createClient: (request: CreateFinanceClientRequest) => Promise<FinanceClientMutationResult>
  complete: (clientId: FinanceClientId) => void
  cancel: () => void
}

/** Full root-overlay props. */
export type FinanceClientCreateOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'finance.clients'>
  & InjectFace<FinanceClientCreateOverlayInjected>

/** Render the customer details form after the user selects a workspace directory. */
export function FinanceClientCreateOverlay(props: FinanceClientCreateOverlayProps): ReactNode {
  const state = props.useFinanceClients(snapshot => snapshot)
  const creation = state.clientCreation
  const [draft, setDraft] = useState<ClientDraft>(EMPTY_CLIENT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formId = useId()

  useEffect(() => {
    if (creation === null) return
    setDraft(EMPTY_CLIENT)
    setBusy(false)
    setError(null)
  }, [creation?.workspacePath])

  const close = (): void => {
    if (busy) return
    props.cancel()
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (creation === null) return
    const legalName = draft.legalName.trim()
    const shortName = draft.shortName.trim()
    const registeredRegion = draft.registeredRegion.trim()
    if (
      legalName === ''
      || shortName === ''
      || registeredRegion === ''
      || draft.taxpayerType === ''
      || draft.accountingStandard === ''
    ) {
      setError(props.t('requiredFields'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await props.createClient({
        expectedRevision: state.catalog.revision,
        workspacePath: creation.workspacePath,
        client: {
          legalName,
          shortName,
          taxpayerType: draft.taxpayerType,
          registeredRegion,
          accountingStandard: draft.accountingStandard,
          chartMappings: [],
          externalSystemRefs: [],
        },
      })
      props.complete(result.client.id)
    } catch (failure) {
      setError(`${props.t('createError')}${failure instanceof Error ? failure.message : String(failure)}`)
      setBusy(false)
    }
  }

  return (
    <Modal
      open={creation !== null}
      onClose={close}
      title={props.t('createTitle')}
      closeLabel={props.t('cancel')}
      className={css.dialog ?? ''}
      footer={(
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>{props.t('cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy}>
            {busy ? props.t('saving') : props.t('save')}
          </Button>
        </>
      )}
    >
      <form id={formId} className={css.form} noValidate onSubmit={(event) => { void submit(event) }}>
        <div className={css.workspacePath}>
          <span>{props.t('workspaceDirectory')}</span>
          <strong title={creation?.workspacePath}>{creation?.workspacePath}</strong>
        </div>
        <label className={css.wide}>
          <span>{props.t('legalName')}</span>
          <input
            autoFocus
            required
            value={draft.legalName}
            onChange={(event) => { setDraft(value => ({ ...value, legalName: event.target.value })) }}
          />
        </label>
        <label className={css.wide}>
          <span>{props.t('shortName')} <small id={`${formId}-short-name-hint`}>{props.t('shortNameHint')}</small></span>
          <input
            required
            aria-label={props.t('shortName')}
            aria-describedby={`${formId}-short-name-hint`}
            value={draft.shortName}
            onChange={(event) => { setDraft(value => ({ ...value, shortName: event.target.value })) }}
          />
        </label>
        <label>
          <span>{props.t('taxpayerType')}</span>
          <select
            required
            value={draft.taxpayerType}
            onChange={(event) => {
              setDraft(value => ({ ...value, taxpayerType: event.target.value as ClientDraft['taxpayerType'] }))
            }}
          >
            <option value="" disabled>{props.t('taxpayerType')}</option>
            <option value="general-vat">{props.t('taxpayerGeneral')}</option>
            <option value="small-scale-vat">{props.t('taxpayerSmall')}</option>
            <option value="other">{props.t('taxpayerOther')}</option>
          </select>
        </label>
        <label>
          <span>{props.t('accountingStandard')}</span>
          <select
            required
            value={draft.accountingStandard}
            onChange={(event) => {
              setDraft(value => ({
                ...value,
                accountingStandard: event.target.value as ClientDraft['accountingStandard'],
              }))
            }}
          >
            <option value="" disabled>{props.t('accountingStandard')}</option>
            <option value="enterprise">{props.t('standardEnterprise')}</option>
            <option value="small-enterprise">{props.t('standardSmall')}</option>
            <option value="government">{props.t('standardGovernment')}</option>
            <option value="nonprofit">{props.t('standardNonprofit')}</option>
            <option value="other">{props.t('standardOther')}</option>
          </select>
        </label>
        <label className={css.wide}>
          <span>{props.t('region')}</span>
          <input
            required
            value={draft.registeredRegion}
            onChange={(event) => { setDraft(value => ({ ...value, registeredRegion: event.target.value })) }}
          />
        </label>
        {error !== null && <p className={css.error} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
