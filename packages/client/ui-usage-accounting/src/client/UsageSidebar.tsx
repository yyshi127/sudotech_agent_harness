/** Sidebar current-day usage summary. */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageAccountingView } from './controller.ts'
import type { UsageAccountingKey } from './locales.ts'
import { formatNanoyuan, formatTokens } from './format.ts'
import css from './UsageSidebar.module.css'

/** Registration-side dependencies of the sidebar summary. */
export interface UsageSidebarInjected {
  hooks: {
    /** Shared current-key usage state bound to `useUsage` by the slot renderer. */
    usage: HostObservable<UsageAccountingView>
  }
  refresh: () => void
  t: (key: UsageAccountingKey) => string
}

/** Complete sidebar summary props. */
export type UsageSidebarProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<UsageSidebarInjected>

const POPOVER_WIDTH = 304

function costLabel(value: string | null | undefined, t: UsageSidebarInjected['t']): string {
  return value === null || value === undefined ? t('detailUnavailable') : `¥${formatNanoyuan(value)}`
}

/** Render today's current-key usage in the sidebar footer. */
export function UsageSidebar({ wide, refresh, useUsage, t }: UsageSidebarProps): ReactNode {
  const view = useUsage(state => state)
  const [open, setOpen] = useState(false)
  const [panelPosition, setPanelPosition] = useState({ left: 12, bottom: 84 })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (view.status === 'idle') refresh()
  }, [refresh, view.status])

  const positionPanel = useCallback((): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const rightmostLeft = Math.max(12, window.innerWidth - POPOVER_WIDTH - 12)
    setPanelPosition({
      left: Math.min(Math.max(12, rect.left), rightmostLeft),
      bottom: Math.max(12, window.innerHeight - rect.top + 8),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (!rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false)
    }
    const closeWithEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeWithEscape)
    window.addEventListener('resize', positionPanel)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeWithEscape)
      window.removeEventListener('resize', positionPanel)
    }
  }, [open, positionPanel])

  const today = view.snapshot?.days.find(day => day.date === view.snapshot?.today)
  const tokenText = formatTokens(today?.totalTokens ?? 0)
  const costText = formatNanoyuan(today?.costNanoyuan ?? '0')
  const label = view.status === 'error'
    ? t('unavailable')
    : view.snapshot === null
      ? t('loading')
      : `${t('today')} ${tokenText} ${t('token')} · ¥${costText}`
  const rows = [
    {
      label: t('cacheHitInput'),
      tokens: today?.cacheHitInputTokens ?? 0,
      cost: today?.cacheHitInputCostNanoyuan,
    },
    {
      label: t('cacheMissInput'),
      tokens: today?.cacheMissInputTokens ?? 0,
      cost: today?.cacheMissInputCostNanoyuan,
    },
    {
      label: t('output'),
      tokens: today?.outputTokens ?? 0,
      cost: today?.outputCostNanoyuan,
    },
  ]

  return (
    <div ref={rootRef} className={wide ? css.root : `${css.root} ${css.compact}`}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? titleId : undefined}
        onClick={() => {
          if (!open) positionPanel()
          setOpen(current => !current)
        }}
      >
        <IconDataOutline16 className={css.icon} size={16} />
        {wide && (
          <span className={css.label}>
            {view.status === 'error' || view.snapshot === null
              ? label
              : (
                <>
                  {t('today')} <strong className={css.metric}>{tokenText}</strong> {t('token')} ·{' '}
                  <strong className={css.metric}>¥{costText}</strong>
                </>
              )}
          </span>
        )}
      </button>
      {open && createPortal((
        <div
          ref={panelRef}
          id={titleId}
          className={css.popover}
          style={panelPosition}
          role="dialog"
          aria-labelledby={`${titleId}-title`}
        >
          <div className={css.panelHeading}>
            <strong id={`${titleId}-title`}>{t('detailTitle')}</strong>
            <span>¥{formatNanoyuan(today?.costNanoyuan ?? '0')}</span>
          </div>
          <div className={css.columnHeading} aria-hidden="true">
            <span>{t('category')}</span>
            <span>{t('tokenColumn')}</span>
            <span>{t('costColumn')}</span>
          </div>
          <div className={css.details}>
            {rows.map(row => (
              <div key={row.label} className={css.detailRow}>
                <span className={css.category}>{row.label}</span>
                <span className={css.tokenValue}>{formatTokens(row.tokens)}</span>
                <span className={css.costValue}>{costLabel(row.cost, t)}</span>
              </div>
            ))}
          </div>
          <div className={css.totalRow}>
            <span>{t('todayTotal')}</span>
            <strong>{formatTokens(today?.totalTokens ?? 0)} {t('token')} · ¥{formatNanoyuan(today?.costNanoyuan ?? '0')}</strong>
          </div>
          {(today?.unpricedTokens ?? 0) > 0 && (
            <div className={css.unpricedRow}>
              <span>{t('unpricedTokens')}</span>
              <strong>{formatTokens(today?.unpricedTokens ?? 0)} {t('token')}</strong>
            </div>
          )}
          <p className={css.note}>{t('detailNote')}</p>
        </div>
      ), document.body)}
    </div>
  )
}
