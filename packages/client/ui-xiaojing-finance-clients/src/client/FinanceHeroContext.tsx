/** Finance-only blank-session mode and client controls. */

import { useEffect, useState, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FinanceClientId,
  FinanceSessionContextView,
  StageFinanceClientRequest,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type { FinanceClientsView } from './controller.ts'
import css from './FinanceHeroContext.module.css'

type FinanceHomeMode = 'standard' | 'client'

/** Context selector operations supplied by the registration. */
export interface FinanceHeroContextInjected {
  hooks: { financeClients: SnapshotStore<FinanceClientsView> }
  loadClients: () => Promise<void>
  sessionContext: (sessionId: SessionId) => Promise<FinanceSessionContextView>
  stage: (sessionId: SessionId, request: StageFinanceClientRequest) => Promise<FinanceSessionContextView>
  setBlocked: (sessionId: SessionId, reason: string | undefined) => void
}

/** Full hero context props. */
export type FinanceHeroContextProps =
  PropsRuntime<'conversation.hero.context'>
  & PropsLocale<'finance.clients'>
  & InjectFace<FinanceHeroContextInjected>

/** Render compact Finance controls only for a blank Finance session. */
export function FinanceHeroContext(props: FinanceHeroContextProps): ReactNode {
  const { sessionId, useSessions, useFinanceClients, t } = props
  const summary = useSessions(state => sessionId === undefined ? undefined : state.byId[sessionId])
  const catalog = useFinanceClients(state => state)
  const [context, setContext] = useState<FinanceSessionContextView | null>(null)
  const [mode, setMode] = useState<FinanceHomeMode>('standard')
  const [modeOpen, setModeOpen] = useState(false)
  const [clientOpen, setClientOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [transitionFailed, setTransitionFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visible = summary?.projectionValues?.agentPreset === 'finance' && summary.blank

  useEffect(() => {
    let active = true
    setContext(null)
    setMode('standard')
    setModeOpen(false)
    setClientOpen(false)
    setError(null)
    setTransitionFailed(false)
    if (!visible || sessionId === undefined) return () => { active = false }
    void props.loadClients()
    void props.sessionContext(sessionId).then((value) => {
      if (!active) return
      setContext(value)
      setMode(value.state === 'general' ? 'standard' : 'client')
    }, (failure: unknown) => {
      if (active) {
        setError(failure instanceof Error ? failure.message : String(failure))
        setTransitionFailed(true)
      }
    })
    return () => { active = false }
  }, [catalog.contextEpoch, props.loadClients, props.sessionContext, sessionId, visible])

  const activeClients = catalog.catalog.clients.filter(client => client.status === 'active')
  const selectedClientId = context !== null && 'clientId' in context ? context.clientId : undefined
  const selectedClient = activeClients.find(client => client.id === selectedClientId)
  const clientLabel = (client: (typeof activeClients)[number]): string => {
    const name = client.shortName ?? client.legalName
    const connection = catalog.workspaces?.clients.find(entry => entry.clientId === client.id)?.connection
    if (connection === undefined) return name
    return t('clientNameAccountId').replace('{name}', name).replace('{account}', connection.accountName ?? t('savedAccount')).replace('{id}', connection.accountId)
  }
  const selectedLabel = selectedClient === undefined ? undefined : clientLabel(selectedClient)
  const boundClientName = context?.state === 'bound' ? context.clientName : undefined
  const hasClientContext = selectedClientId !== undefined || boundClientName !== undefined
  const contextLocked = context?.locked === true
  const contextError = transitionFailed ? `${t('contextError')}${error ?? ''}` : null
  const blockReason = contextError
    ?? (busy || context === null
      ? t('savingContext')
      : mode === 'client' && !hasClientContext
        ? t('clientRequired')
        : undefined)

  useEffect(() => {
    if (!visible || sessionId === undefined) return
    props.setBlocked(sessionId, blockReason)
    return () => { props.setBlocked(sessionId, undefined) }
  }, [blockReason, props.setBlocked, sessionId, visible])

  if (!visible || sessionId === undefined) return null

  const stageSelection = async (request: StageFinanceClientRequest): Promise<void> => {
    setBusy(true)
    setTransitionFailed(false)
    setError(null)
    try {
      setContext(await props.stage(sessionId, request))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setTransitionFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={css.context} role="group" aria-label={t('chooseContext')} title={contextError ?? undefined}>
      <Menu
        open={modeOpen}
        onClose={() => { setModeOpen(false) }}
        items={[
          { id: 'standard', label: t('generalConsulting') },
          { id: 'client', label: t('clientMode') },
        ]}
        selectedId={mode}
        onSelect={(id) => {
          setModeOpen(false)
          if (id === 'standard') {
            setMode('standard')
            setClientOpen(false)
            void stageSelection({ mode: 'general' })
            return
          }
          setMode('client')
        }}
        align="start"
        compact
        portal
        anchor={(
          <button
            type="button"
            className={`${css.selector} ${css.modeSelector}`}
            aria-label={t('chooseMode')}
            aria-haspopup="menu"
            aria-expanded={modeOpen}
            disabled={busy || context === null || contextLocked}
            onClick={() => { setModeOpen(value => !value) }}
          >
            <span className={css.selectorText}>{mode === 'standard' ? t('generalConsulting') : t('clientMode')}</span>
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />

      {mode === 'client' && (
        <Menu
          open={clientOpen}
          onClose={() => { setClientOpen(false) }}
          items={activeClients.map(client => ({
            id: client.id,
            label: clientLabel(client),
          }))}
          selectedId={selectedClientId}
          onSelect={(id) => {
            setClientOpen(false)
            void stageSelection({ mode: 'client', clientId: id as FinanceClientId })
          }}
          align="start"
          compact
          portal
          anchor={(
            <button
              type="button"
              className={`${css.selector} ${css.clientSelector}`}
              aria-label={t('chooseClient')}
              title={selectedLabel}
              aria-haspopup="menu"
              aria-expanded={clientOpen}
              disabled={busy || catalog.status === 'loading' || contextLocked}
              onClick={() => { setClientOpen(value => !value) }}
            >
              <span className={css.selectorText}>
                {selectedLabel ?? boundClientName ?? t('chooseClient')}
              </span>
              <IconChevronDownOutlineRegular className={css.chevron} />
            </button>
          )}
        />
      )}

      {contextError !== null && <span className={css.srOnly} role="status">{contextError}</span>}
    </span>
  )
}
