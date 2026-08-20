/** Current-month calendar settings section. */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageAccountingDay } from '@deepseek-ai/dsh-usage-accounting/types'
import type { UsageAccountingView } from './controller.ts'
import type { UsageAccountingKey } from './locales.ts'
import { formatNanoyuan, formatTokens } from './format.ts'
import css from './UsageSection.module.css'

/** Registration-side dependencies of the settings section. */
export interface UsageSectionInjected {
  hooks: {
    /** Shared current-key usage state bound to `useUsage` by the slot renderer. */
    usage: HostObservable<UsageAccountingView>
  }
  refresh: () => void
  t: (key: UsageAccountingKey) => string
}

/** Complete usage section props. */
export type UsageSectionProps = PropsRuntime<'settings.section'> & InjectFace<UsageSectionInjected>

function daysOfMonth(month: string): { day: number; date: string }[] {
  const [yearText, monthText] = month.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Array.from({ length: count }, (_, index) => ({
    day: index + 1,
    date: `${month}-${String(index + 1).padStart(2, '0')}`,
  }))
}

function mondayOffset(month: string): number {
  const [yearText, monthText] = month.split('-')
  const weekday = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1)).getUTCDay()
  return (weekday + 6) % 7
}

function dayContent(
  date: string,
  today: string,
  trackingSince: string,
  row: UsageAccountingDay | undefined,
  t: UsageSectionInjected['t'],
): ReactNode {
  if (date > today) return null
  if (date < trackingSince) return <span className={css.untracked}>{t('untracked')}</span>
  const tokens = row?.totalTokens ?? 0
  const cost = row?.costNanoyuan ?? '0'
  return (
    <>
      <span className={css.tokens}>{formatTokens(tokens)} {t('token')}</span>
      <span className={css.cost}>¥{formatNanoyuan(cost)}</span>
      {(row?.unpricedTokens ?? 0) > 0 && (
        <span className={css.unpriced}>{formatTokens(row?.unpricedTokens ?? 0)} {t('unpriced')}</span>
      )}
    </>
  )
}

/** Render the current Beijing month as a seven-column calendar. */
export function UsageSection({ refresh, useUsage, t }: UsageSectionProps): ReactNode {
  const view = useUsage(state => state)
  useEffect(() => { if (view.status === 'idle') refresh() }, [refresh, view.status])

  if (view.snapshot === null) {
    return <section className={css.root}><h2>{t('title')}</h2><p>{view.error ?? t('loading')}</p></section>
  }
  const snapshot = view.snapshot
  const byDate = new Map(snapshot.days.map(day => [day.date, day]))
  const blanks = Array.from({ length: mondayOffset(snapshot.month) }, (_, index) => index)

  return (
    <section className={css.root}>
      <div className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
        <div className={css.total}>
          <span>{t('monthTotal')}</span>
          <div className={css.totalValue}>
            <strong>{formatTokens(snapshot.total.totalTokens)} {t('token')} · ¥{formatNanoyuan(snapshot.total.costNanoyuan)}</strong>
            {snapshot.total.unpricedTokens > 0 && (
              <small>{formatTokens(snapshot.total.unpricedTokens)} {t('unpriced')}</small>
            )}
          </div>
        </div>
      </div>
      {!snapshot.keyConfigured && <p className={css.notice}>{t('noKey')}</p>}
      <div className={css.month}>{snapshot.month}</div>
      <div className={css.calendar}>
        {t('weekdays').split(',').map(day => <div key={day} className={css.weekday}>{day}</div>)}
        {blanks.map(index => <div key={`blank-${index}`} className={css.blank} />)}
        {daysOfMonth(snapshot.month).map(({ day, date }) => (
          <div key={date} className={date === snapshot.today ? `${css.day} ${css.today}` : css.day}>
            <span className={css.dayNumber}>{day}</span>
            {dayContent(date, snapshot.today, snapshot.trackingSince, byDate.get(date), t)}
          </div>
        ))}
      </div>
    </section>
  )
}
