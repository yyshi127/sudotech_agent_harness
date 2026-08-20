/** Xiaojing sidebar brand. */

import type { ReactNode } from 'react'
import { IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SidebarBrand.module.css'

/** Product sidebar brand props. */
export type SidebarBrandProps = PropsRuntime<'sidebar.brand'>

/** Render the wide SUDO wordmark and collapsed Xiaojing avatar. */
export function SidebarBrand(props: SidebarBrandProps): ReactNode {
  const { wide, startSession, toggleSidebar, newSessionLabel, toggleLabel } = props
  return (
    <>
      {wide && (
        <button type="button" className={css.brand} aria-label={newSessionLabel} onClick={startSession}>
          <img className={css.brandLogo} src="/sudo-logo-gray.png" alt="SUDO 数豆科技" />
          <span className={css.tagline}>用AI重新定义财务</span>
        </button>
      )}
      <Tooltip label={toggleLabel} delayMs={500}>
        <button
          type="button"
          className={wide ? css.toggle : `${css.toggle} ${css.collapsed}`}
          aria-label={toggleLabel}
          onClick={toggleSidebar}
        >
          {!wide && <img className={css.railLogo} src="/sdoobot-avatar.png" alt="" />}
          <IconPanelLeftOutline16 className={css.panelIcon} size={wide ? 16 : 18} />
        </button>
      </Tooltip>
    </>
  )
}
