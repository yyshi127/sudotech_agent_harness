/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them). A Session row's
 * "..." menu and hover buttons are the `sidebar.workspaces.session.menu.item`
 * and `sidebar.workspaces.session.row.action` lists rendered through this
 * entry's `renderSlot`; the actions in them, this package's own included,
 * are slot entries with their own behavior, so this component threads no
 * action callbacks and hosts no action surface.
 */
import { Fragment, type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, HoverCardGroup, IconArchiveCheckOutlineRegular, IconArchiveOffOutlineRegular, IconArchiveOutlineRegular,
  IconChevronsUpDownOutlineRegular, IconClockOutlineRegular, IconCloseFillRegular,
  IconDataOutlineRegular, IconFlatListOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
  IconProjectAddOutlineRegular,
  IconSearchOutlineRegular, IconSlidersTwoOutlineRegular,
  IconThinkOutlineRegular, IconTriangleRightFillRegular, IconUserOutlineRegular,
  IconQueueOutlineRegular,
  IconWorkspaceTreeOutlineRegular, Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionListState, SessionSearchResultItem,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { WorkspaceCategorySection, WorkspaceCategoryState } from '../category-registry.ts'
import type { ArchivedFilter, GroupNode, SessionNode, SessionOrderBy, SessionRowState } from '../tree.ts'
import {
  deriveFlat, deriveGroups, deriveSearchResults, orderByRecency, owningGroupKey, owningParentFolder,
  pinCurrentBlank, reconcileManualOrder, sessionMemberIds, UNGROUPED_KEY,
} from '../tree.ts'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from './Rows.tsx'
import { AnimatedRows } from './AnimatedRows.tsx'
import { FLAT_SESSION_ORDER_KEY, type SessionGroupBy } from '../stores.ts'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Non-blank Session rows visible per Workspace while no Session raises its watermark. */
const SESSION_WATERMARK_BASE = 5
/** Highest watermark that attention-bearing Sessions raise automatically; Show more and search reveals may exceed it. */
const SESSION_WATERMARK_AUTO_MAX = 50

/** Render a product-neutral semantic section icon while retaining folder fallback. */
function sectionIcon(section: WorkspaceCategorySection, expanded: boolean): ReactNode {
  if (section.icon === undefined) return expanded ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />
  switch (section.icon) {
    case 'discussion': return <IconThinkOutlineRegular />
    case 'ledger': return <IconDataOutlineRegular />
    case 'person': return <IconUserOutlineRegular />
    default: return assertNeverSectionIcon(section.icon)
  }
}

/** Reject an unhandled closed-union member. */
function assertNeverSectionIcon(value: never): never {
  throw new Error(`Unhandled workspace section icon: ${String(value)}`)
}

/** Show the blank row plus the first `watermark` non-blank rows, in list order. */
function watermarkRows(sessions: readonly SessionNode[], watermark: number): {
  rows: readonly SessionNode[]
  hiddenCount: number
} {
  let count = 0
  const rows = sessions.filter((session) => {
    if (session.blank) return true
    count += 1
    return count <= watermark
  })
  return { rows, hiddenCount: sessions.length - rows.length }
}

/**
 * Smallest watermark that covers every non-blank row within the automatic maximum that is running, has a running
 * child, awaits the user, carries an unread completion, or is current, and the reveal target at any position.
 */
function requiredWatermark(
  sessions: readonly SessionNode[],
  current: SessionId | undefined,
  revealSessionId: SessionId | undefined,
): number {
  let index = 0
  let required = 0
  for (const session of sessions) {
    if (session.blank) continue
    index += 1
    const attention = index <= SESSION_WATERMARK_AUTO_MAX && (
      session.running || session.runningSubagentCount > 0 || session.pendingInteraction !== undefined
      || session.completed || session.id === current
    )
    if (attention || session.id === revealSessionId) required = index
  }
  return required
}

/** Raise each listed group's watermark to its requirement; returns `marks` itself when nothing rises. */
function raiseWatermarks(
  marks: Readonly<Record<string, number>>,
  required: ReadonlyMap<string, number>,
): Readonly<Record<string, number>> {
  let raised = marks
  for (const [key, watermark] of required) {
    if (watermark > (raised[key] ?? SESSION_WATERMARK_BASE)) raised = { ...raised, [key]: watermark }
  }
  return raised
}

/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

/** Grouping, ordering, and archived-filter menu; own open state so it resets with the wide chrome. */
function ViewOptionsMenu({ groupBy, orderBy, archivedFilter, onGroupPick, onOrderPick, onArchivedFilterPick, t }: {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  archivedFilter: ArchivedFilter
  onGroupPick: (mode: SessionGroupBy) => void
  onOrderPick: (mode: SessionOrderBy) => void
  onArchivedFilterPick: (filter: ArchivedFilter) => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace'), icon: <IconFolderCloseRegular /> },
        { id: 'workspace-tree', label: t('groupBy.workspaceTree'), icon: <IconWorkspaceTreeOutlineRegular /> },
        { id: 'flat', label: t('groupBy.flat'), icon: <IconFlatListOutlineRegular /> },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual'), icon: <IconChevronsUpDownOutlineRegular /> },
        { id: 'updated', label: t('orderBy.updated'), icon: <IconClockOutlineRegular /> },
        { type: 'separator' as const, id: 'archived-filter-separator' },
        { type: 'label' as const, id: 'filter-by', text: t('filterBy.label') },
        { id: 'hide-archived', label: t('viewOptions.hideArchived'), icon: <IconArchiveOffOutlineRegular /> },
        { id: 'show-archived', label: t('viewOptions.showArchived'), icon: <IconQueueOutlineRegular /> },
        { id: 'only-archived', label: t('viewOptions.onlyArchived'), icon: <IconArchiveCheckOutlineRegular /> },
      ]}
      selectedIds={[
        groupBy,
        orderBy,
        { default: 'hide-archived', show: 'show-archived', only: 'only-archived' }[archivedFilter],
      ]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'workspace-tree' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        else if (id === 'hide-archived') onArchivedFilterPick('default')
        else if (id === 'show-archived') onArchivedFilterPick('show')
        else if (id === 'only-archived') onArchivedFilterPick('only')
        setOpen(false)
      }}
      align="end"
      dense
      listClassName={css.viewOptionsMenu}
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconSlidersTwoOutlineRegular />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** In-flight root-row drag: source identity plus the current insert marker. */
interface DragState {
  /** Workspace id, or {@link UNGROUPED_KEY} for the browser-local loose-session account. */
  accountKey: string
  sessionId: SessionNode['id']
  /** Source row was pinned at drag start; drop targets share the pinned block. */
  pinned: boolean
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/** Apply a visible drop to the complete account without removing hidden members. */
function sessionDragOrder(
  order: readonly SessionId[],
  rows: readonly SessionNode[],
  drag: DragState,
  over: NonNullable<DragState['over']>,
): SessionId[] | undefined {
  const source = rows.find(row => row.id === drag.sessionId)
  const target = rows.find(row => row.id === over.id)
  if (source === undefined || target === undefined || source.blank
    || source.pinned !== drag.pinned || target.pinned !== drag.pinned
    || source.id === target.id || !order.includes(source.id)) return
  const section = rows.filter(row => row.pinned === drag.pinned)
  const sourceIndex = section.findIndex(row => row.id === source.id)
  const withoutSource = section.filter(row => row.id !== source.id)
  const insertAt = withoutSource.findIndex(row => row.id === target.id) + (over.half === 'after' ? 1 : 0)
  if (insertAt === sourceIndex) return
  const next = order.filter(id => id !== source.id)
  const targetIndex = next.indexOf(target.id)
  if (targetIndex === -1) return
  next.splice(targetIndex + (over.half === 'after' ? 1 : 0), 0, source.id)
  return pinCurrentBlank(next, rows.find(row => row.blank)?.id)
}

/** In-flight Workspace-row drag: source identity plus the current marker. */
interface WorkspaceDragState {
  workspaceId: WorkspaceId
  over: { id: WorkspaceId; half: 'before' | 'after' } | null
}

/** Resolve an insertion side across the Workspace header, descendants, and Sessions. */
function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessionStatus' | 'startSession' | 'open'
  | 'insertWorkspaceBefore' | 't' | 'usePanelInfo'
> & PropsRenderSlots<
  | 'sidebar.workspaces.session.menu.item'
  | 'sidebar.workspaces.session.row.action'
  | 'sidebar.session.row.leading'
  | 'sidebar.session.row.hover'
> & {
  shortcuts: readonly import('@deepseek-ai/dsh-client-shortcuts/client').ShortcutCatalogEntry[]
  /** Always-mounted Session list snapshot. */
  list: SessionListState
  /** Host account home for POSIX hover-path abbreviation. */
  home?: string | undefined
  /** Workspaces in Host group order with browser-projected Session order. */
  workspaces: readonly WorkspaceView[]
  /** Browser-projected order for Sessions outside every Workspace. */
  ungroupedSessionIds: readonly SessionId[]
  /** Whether the current Workspace stream has a complete Host baseline. */
  workspaceReady: boolean
  /** Grouping, ordering, and filter changes replace the view without row motion. */
  animationResetKey: string
  /** Nest Workspaces under their nearest registered ancestors. */
  nestWorkspaces: boolean
  /** Explicit persisted group expansion, including descendants in tree mode. */
  groupExpansion: Readonly<Record<string, boolean>>
  /** Persist one Workspace group's expansion. */
  setGroupExpanded: (key: string, expanded: boolean) => void
  /** Save a drag order and select Manual. */
  setSessionOrder: (accountKey: string, order: readonly string[]) => void
  /** Registry-global pin and archive sets plus the archived-visibility choice. */
  rowState: SessionRowState
  /** Workspaces that retain history but cannot create another session. */
  newSessionDisabledWorkspaceIds: ReadonlySet<WorkspaceId>
  /** Optional product-owned nested sections within the active category. */
  workspaceSections: readonly WorkspaceCategorySection[]
  /** Whether the composed directory flow can serve section add actions. */
  sectionAddAvailable: boolean
  /** Open one product section's directory-backed add flow. */
  onSectionAdd: (section: WorkspaceCategorySection, anchor: HTMLButtonElement) => void
  /** Whether Workspace drag reordering is available on the active surface. */
  manageWorkspaces: boolean
  /** Workspaces whose owning surface exposes rename and remove actions. */
  manageableWorkspaceIds: ReadonlySet<WorkspaceId>
  /** Product-category remove label; ordinary Workspaces retain delete wording. */
  removeWorkspaceLabel?: string | undefined
  workspaceDetailsLabel?: string | undefined
  workspaceDetailsWorkspaceIds: ReadonlySet<WorkspaceId>
  workspaceBadges: NonNullable<WorkspaceCategoryState['workspaceBadges']>
  onWorkspaceDetails: (workspaceId: WorkspaceId) => void
  onWorkspaceBadgeAction: (workspaceId: WorkspaceId) => void
  /** Switch the archived filter back to the default hide-archived view. */
  onLeaveArchivedOnly: () => void
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the rename dialog from a row title double-click. */
  onSessionRenameRequest: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** One Session chosen from search that must be exposed and scrolled into view. */
  revealSessionId?: SessionId | undefined
  /** Acknowledge that the chosen Session row has been revealed. */
  onSessionRevealed: (sessionId: SessionId) => void
}

/** The list-empty placeholder — a glyph over the text; the archived-only view names its filter and offers the way back. */
function EmptySessions({ rowState, onLeaveArchivedOnly, t }: Pick<SessionTreeProps, 'rowState' | 'onLeaveArchivedOnly' | 't'>) {
  const archivedOnly = rowState.archivedFilter === 'only'
  return (
    <div className={css.emptyState} data-row-key="empty">
      {archivedOnly ? <IconArchiveOutlineRegular size={24} /> : <IconQueueOutlineRegular size={24} />}
      <div>{archivedOnly ? t('empty.noneArchived') : t('empty.none')}</div>
      {archivedOnly && (
        <button type="button" className={css.emptyAction} onClick={onLeaveArchivedOnly}>
          {t('empty.viewOthers')}
        </button>
      )}
    </div>
  )
}

/** The scrolling session tree; unmounting drops the sessions subscription and the session watermarks. */
function SessionTree({
  list, useSessionStatus, startSession, open, workspaces, ungroupedSessionIds,
  rowState, onLeaveArchivedOnly,
  workspaceReady, animationResetKey, usePanelInfo,
  onRenameRequest, onDeleteRequest, onSessionRenameRequest,
  renderSlot,
  insertWorkspaceBefore,
  nestWorkspaces, groupExpansion, setGroupExpanded,
  setSessionOrder, home, t,
  revealSessionId, onSessionRevealed, shortcuts,
  newSessionDisabledWorkspaceIds, workspaceSections, sectionAddAvailable, onSectionAdd,
  manageWorkspaces, manageableWorkspaceIds, removeWorkspaceLabel,
  workspaceDetailsLabel, workspaceDetailsWorkspaceIds, workspaceBadges,
  onWorkspaceDetails, onWorkspaceBadgeAction,
}: SessionTreeProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const current = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const revealGroup = revealSessionId === undefined || !workspaceReady
    ? undefined
    : owningGroupKey(workspaces, revealSessionId)
  // Per-group raised watermarks; an absent key means the base watermark.
  const [storedWatermarks, setStoredWatermarks] = useState<Readonly<Record<string, number>>>({})
  // Advances on user-driven watermark changes so AnimatedRows settles them; automatic raises animate.
  const [watermarkMotionKey, setWatermarkMotionKey] = useState(0)
  // Transient drag marker state; the selected mode owns the resulting order.
  const [drag, setDrag] = useState<DragState | null>(null)
  const sessionDropCommitted = useRef(false)
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState | null>(null)
  const workspaceDropCommitted = useRef(false)
  const nativeDragActive = drag !== null || workspaceDrag !== null
  useNativeDragAcceptance(nativeDragActive)
  const currentGroup = current === undefined || !workspaceReady
    ? undefined
    : owningGroupKey(workspaces, current)
  useEffect(() => {
    if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
    setGroupExpanded(currentGroup, true)
  }, [current, currentGroup, setGroupExpanded, groupExpansion])
  const parents = useMemo(() => {
    if (!nestWorkspaces) return new Map<string, WorkspaceId | undefined>()
    const keysByPath = new Map(workspaces.map(workspace => [workspace.path, workspace.workspaceId]))
    const paths = [...keysByPath.keys()]
    return new Map<string, WorkspaceId | undefined>(workspaces.map((workspace) => {
      const path = owningParentFolder(workspace.path, paths)
      return [workspace.workspaceId, path === undefined ? undefined : keysByPath.get(path)]
    }))
  }, [nestWorkspaces, workspaces])
  const currentAncestors = useMemo(() => {
    const keys = new Set<string>()
    for (let key = currentGroup === undefined ? undefined : parents.get(currentGroup); key !== undefined; key = parents.get(key)) {
      keys.add(key)
    }
    return keys
  }, [currentGroup, parents])
  const expandedGroups = useMemo(() => {
    const ancestorKeys = new Set<string | undefined>(parents.values())
    return [...workspaces.map(workspace => workspace.workspaceId), UNGROUPED_KEY]
      .filter(key => groupExpansion[key] ?? ancestorKeys.has(key))
  }, [groupExpansion, parents, workspaces])
  const groups = useMemo(
    () => deriveGroups(list, workspaces, rowState, statuses, {
      expandedGroups,
      ungroupedOrder: ungroupedSessionIds,
    }),
    [list, workspaces, rowState, statuses, expandedGroups, ungroupedSessionIds],
  )
  useEffect(() => {
    for (let key = revealGroup; key !== undefined; key = parents.get(key)) {
      if (groupExpansion[key] === false || (key === revealGroup && groupExpansion[key] !== true)) {
        setGroupExpanded(key, true)
      }
    }
  }, [groupExpansion, parents, revealGroup, setGroupExpanded])
  const baselines = new Map(groups.map(group => [group.key, Math.max(SESSION_WATERMARK_BASE, requiredWatermark(
    group.sessions,
    current,
    group.key === revealGroup ? revealSessionId : undefined,
  ))]))
  const foldedKeys = new Set(groups.filter(group => !group.expanded).map(group => group.key))
  const underFoldedAncestor = (key: string): boolean => {
    for (let owner = parents.get(key); owner !== undefined; owner = parents.get(owner)) {
      if (foldedKeys.has(owner)) return true
    }
    return false
  }
  // A group hidden by a folded ancestor keeps its own expansion and rows but must not raise its watermark.
  const requiredWatermarks = new Map([...baselines].filter(([key]) => !underFoldedAncestor(key)))
  const sessionWatermarks = raiseWatermarks(storedWatermarks, requiredWatermarks)
  // Raising during render keeps the watermark monotonic without committing a lower frame first.
  if (sessionWatermarks !== storedWatermarks) setStoredWatermarks(marks => raiseWatermarks(marks, requiredWatermarks))
  const dropWatermarks = (drop: (key: string) => boolean): void => {
    if (!Object.keys(storedWatermarks).some(drop)) return
    setStoredWatermarks(marks => Object.fromEntries(Object.entries(marks).filter(([key]) => !drop(key))))
    setWatermarkMotionKey(key => key + 1)
  }
  const withinGroup = (key: string, root: string): boolean => {
    for (let owner: string | undefined = key; owner !== undefined; owner = parents.get(owner)) {
      if (owner === root) return true
    }
    return false
  }
  const now = Date.now()
  const commitSessionDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    setDrag(null)
    const group = groups.find(candidate => candidate.key === activeDrag.accountKey)
    if (group === undefined) return
    if (over.id === activeDrag.sessionId) return
    const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
      ? ungroupedSessionIds
      : workspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
    if (accountSessionIds === undefined) return
    const renderedSessions = watermarkRows(group.sessions, sessionWatermarks[group.key] ?? SESSION_WATERMARK_BASE).rows
    const nextOrder = sessionDragOrder(accountSessionIds, renderedSessions, activeDrag, over)
    if (nextOrder !== undefined) setSessionOrder(activeDrag.accountKey, nextOrder)
  }
  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return
    workspaceDropCommitted.current = true
    setWorkspaceDrag(null)
    const owner = parents.get(activeDrag.workspaceId)
    const siblings = workspaces.filter(workspace => parents.get(workspace.workspaceId) === owner)
    const rowIndex = siblings.findIndex(workspace => workspace.workspaceId === over.id)
    if (rowIndex === -1) return
    const anchor = over.half === 'before' ? over.id : siblings[rowIndex + 1]?.workspaceId
    if (anchor === activeDrag.workspaceId) return
    const sourceIndex = siblings.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId)
    const anchorIndex = anchor === undefined
      ? siblings.length
      : siblings.findIndex(workspace => workspace.workspaceId === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason: unknown) => {
      console.warn('workspace reorder rejected:', reason)
    })
  }
  const childrenByParent = useMemo(() => {
    const rendered = new Set(groups.map(group => group.key))
    const children = new Map<string | undefined, GroupNode[]>()
    for (const group of groups) {
      // The archived-only view drops empty groups, so an ancestor may be
      // absent; nest under the nearest rendered one.
      let parent = parents.get(group.key)
      while (parent !== undefined && !rendered.has(parent)) parent = parents.get(parent)
      const siblings = children.get(parent)
      if (siblings === undefined) children.set(parent, [group])
      else siblings.push(group)
    }
    return children
  }, [groups, parents])
  const rootGroups = childrenByParent.get(undefined) ?? []
  const [collapsedWorkspaceSections, setCollapsedWorkspaceSections] = useState<ReadonlySet<string>>(new Set())
  const sectionByWorkspaceId = useMemo(() => {
    const result = new Map<WorkspaceId, WorkspaceCategorySection>()
    for (const section of workspaceSections) {
      for (const workspaceId of section.workspaceIds) result.set(workspaceId, section)
    }
    return result
  }, [workspaceSections])
  const displayedRootGroups = useMemo(() => {
    if (workspaceSections.length === 0) return rootGroups
    const sectionOrder = new Map(workspaceSections.map((section, index) => [section.id, index]))
    return rootGroups.map((group, index) => ({ group, index }))
      .sort((left, right) => {
        const leftSection = left.group.workspaceId === undefined
          ? undefined
          : sectionByWorkspaceId.get(left.group.workspaceId)
        const rightSection = right.group.workspaceId === undefined
          ? undefined
          : sectionByWorkspaceId.get(right.group.workspaceId)
        const leftOrder = leftSection === undefined
          ? workspaceSections.length
          : (sectionOrder.get(leftSection.id) ?? workspaceSections.length)
        const rightOrder = rightSection === undefined
          ? workspaceSections.length
          : (sectionOrder.get(rightSection.id) ?? workspaceSections.length)
        return leftOrder - rightOrder || left.index - right.index
      })
      .map(item => item.group)
  }, [rootGroups, sectionByWorkspaceId, workspaceSections])
  const firstGroupKeyBySection = useMemo(() => {
    const result = new Map<string, string>()
    for (const group of displayedRootGroups) {
      if (group.workspaceId === undefined) continue
      const section = sectionByWorkspaceId.get(group.workspaceId)
      if (section !== undefined && !result.has(section.id)) result.set(section.id, group.key)
    }
    return result
  }, [displayedRootGroups, sectionByWorkspaceId])
  const sectionPlacement = useMemo(() => {
    const beforeGroup = new Map<string, WorkspaceCategorySection[]>()
    let pending: WorkspaceCategorySection[] = []
    for (const section of workspaceSections) {
      const firstGroupKey = firstGroupKeyBySection.get(section.id)
      if (firstGroupKey === undefined) {
        pending.push(section)
        continue
      }
      beforeGroup.set(firstGroupKey, [...pending, section])
      pending = []
    }
    const firstUnsectionedGroup = displayedRootGroups.find(group =>
      group.workspaceId === undefined || !sectionByWorkspaceId.has(group.workspaceId))
    if (firstUnsectionedGroup !== undefined && pending.length > 0) {
      beforeGroup.set(firstUnsectionedGroup.key, pending)
      pending = []
    }
    return { beforeGroup, trailing: pending }
  }, [displayedRootGroups, firstGroupKeyBySection, sectionByWorkspaceId, workspaceSections])
  const currentWorkspaceSection = currentGroup === undefined
    ? undefined
    : workspaceSections.find(section => section.workspaceIds.some(workspaceId => workspaceId === currentGroup))
  useEffect(() => {
    if (currentWorkspaceSection === undefined) return
    setCollapsedWorkspaceSections((collapsed) => {
      if (!collapsed.has(currentWorkspaceSection.id)) return collapsed
      const next = new Set(collapsed)
      next.delete(currentWorkspaceSection.id)
      return next
    })
  }, [currentWorkspaceSection])
  const sectionRow = (section: WorkspaceCategorySection): ReactNode => {
    const expanded = !collapsedWorkspaceSections.has(section.id)
    const containsCurrent = section.id === currentWorkspaceSection?.id
    return (
      <div key={`section:${section.id}`} className={css.workspaceSectionRow} role="treeitem" aria-expanded={expanded}>
        <button
          type="button"
          className={css.workspaceSectionToggle}
          onClick={() => {
            setCollapsedWorkspaceSections((collapsed) => {
              const next = new Set(collapsed)
              if (next.has(section.id)) next.delete(section.id)
              else next.add(section.id)
              return next
            })
          }}
        >
          <span className={clsx(
            css.workspaceSectionSlot,
            css.workspaceSectionFolder,
            containsCurrent && css.workspaceSectionIconActive,
          )} data-workspace-section-icon={section.icon ?? 'folder'}>
            {sectionIcon(section, expanded)}
          </span>
          <span className={clsx(css.workspaceSectionSlot, css.workspaceSectionChevron)}>
            <IconTriangleRightFillRegular className={clsx(
              css.workspaceSectionArrow,
              expanded && css.workspaceSectionArrowOpen,
            )} />
          </span>
          <span className={css.workspaceSectionLabel}>{section.label}</span>
        </button>
        {section.addLabel !== undefined && sectionAddAvailable && (
          <Tooltip label={section.addLabel} side="right" delayMs={500}>
            <button
              type="button"
              className={css.workspaceSectionAdd}
              aria-label={section.addLabel}
              onClick={(event) => { onSectionAdd(section, event.currentTarget) }}
            >
              <IconProjectAddOutlineRegular size={16} />
            </button>
          </Tooltip>
        )}
      </div>
    )
  }
  const workspaceDropAtListStart = displayedRootGroups[0]?.workspaceId !== undefined
    && workspaceDrag?.over?.id === displayedRootGroups[0].workspaceId
    && workspaceDrag.over.half === 'before'

  const rowKeys: string[] = groups.length === 0 && workspaceSections.length === 0 ? ['empty'] : []
  const renderGroup = (group: GroupNode, depth: number): ReactNode => {
    const workspaceId = group.workspaceId
    const children = childrenByParent.get(group.key) ?? []
    const compatibleDrag = workspaceDrag !== null && parents.get(workspaceDrag.workspaceId) === parents.get(group.key)
    const watermark = sessionWatermarks[group.key] ?? SESSION_WATERMARK_BASE
    const collapsed = watermarkRows(group.sessions, baselines.get(group.key) ?? SESSION_WATERMARK_BASE)
    const visible = watermarkRows(group.sessions, watermark)
    const sessionsExpanded = visible.hiddenCount === 0
    rowKeys.push(`workspace:${group.key}`)
    const childRows = group.expanded ? children.map(child => renderGroup(child, depth + 1)) : []
    const sessions = visible.rows
    for (const node of sessions) rowKeys.push(`session:${node.id}`)
    if (collapsed.hiddenCount > 0) rowKeys.push(`overflow:${group.key}`)
    const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId
      ? workspaceDrag.over.half
      : null
    const workspaceDragProps = workspaceId === undefined || !manageWorkspaces ? undefined : {
      start: () => {
        workspaceDropCommitted.current = false
        setWorkspaceDrag({ workspaceId, over: null })
      },
      end: () => {
        if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
          commitWorkspaceDrag(workspaceDrag, workspaceDrag.over)
        } else {
          setWorkspaceDrag(null)
        }
        workspaceDropCommitted.current = false
      },
    }
    const hoverWorkspace = workspaceId === undefined || !compatibleDrag
      ? undefined
      : (half: 'before' | 'after') => {
        setWorkspaceDrag(active => active === null
          ? active
          : { ...active, over: { id: workspaceId, half } })
      }
    const dropWorkspace = workspaceId === undefined || !compatibleDrag
      ? undefined
      : (half: 'before' | 'after') => {
        commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half })
      }
    return (
    // Group section: header, descendant Workspaces, and own Session rows. The
    // inter-group breathing room is the section's own margin
    // (WorkspaceBrowser.module.css).
      <div
        key={group.key}
        style={{ '--dsh-workspace-indent': `${depth * 12}px` } as CSSProperties}
        className={clsx(
          css.groupSection,
          workspaceMarker === 'before' && css.workspaceDropBefore,
          workspaceMarker === 'after' && css.workspaceDropAfter,
        )}
        onDragOver={workspaceDrag === null
          ? undefined
          : (e) => {
            e.preventDefault()
            if (hoverWorkspace === undefined && parents.get(group.key) !== undefined) return
            e.stopPropagation()
            if (hoverWorkspace === undefined) {
              e.dataTransfer.dropEffect = 'none'
              if (workspaceDrag.over !== null) setWorkspaceDrag({ ...workspaceDrag, over: null })
            } else {
              e.dataTransfer.dropEffect = 'move'
              hoverWorkspace(workspaceGroupHalf(e))
            }
          }}
        onDrop={workspaceDrag === null
          ? undefined
          : (e) => {
            e.preventDefault()
            if (dropWorkspace === undefined && parents.get(group.key) !== undefined) return
            e.stopPropagation()
            if (dropWorkspace === undefined) {
              workspaceDropCommitted.current = true
              setWorkspaceDrag(null)
            } else {
              dropWorkspace(workspaceGroupHalf(e))
            }
          }}
      >
        <ProjectRowItem
          newShortcut={shortcuts.find(row => row.id === 'session.new')}
          group={group}
          containsCurrentDescendant={currentAncestors.has(group.key)}
          badge={workspaceBadges.find(badge => badge.workspaceId === group.workspaceId)}
          onBadgeAction={workspaceId === undefined ? undefined : () => { onWorkspaceBadgeAction(workspaceId) }}
          home={home}
          t={t}
          onToggle={() => {
            if (group.expanded) dropWatermarks(key => withinGroup(key, group.key))
            setGroupExpanded(group.key, !group.expanded)
          }}
          onCreate={workspaceId !== undefined && newSessionDisabledWorkspaceIds.has(workspaceId)
            ? undefined
            : () => {
              if (group.workspaceId !== undefined) {
                setGroupExpanded(group.key, true)
                startSession(group.workspaceId)
              }
            }}
          drag={workspaceDragProps}
          actions={group.workspaceId === undefined || !manageableWorkspaceIds.has(group.workspaceId)
            ? undefined
            : {
              ...(workspaceDetailsLabel === undefined || !workspaceDetailsWorkspaceIds.has(group.workspaceId)
                ? {}
                : {
                  details: () => {
                    if (group.workspaceId !== undefined) onWorkspaceDetails(group.workspaceId)
                  },
                  detailsLabel: workspaceDetailsLabel,
                }),
              rename: () => {
              /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
              },
              delete: () => {
              /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
              },
              ...(removeWorkspaceLabel === undefined ? {} : { deleteLabel: removeWorkspaceLabel }),
            }}
        />
        {childRows.length > 0 && (
          <div role="group">
            {childRows}
          </div>
        )}
        {sessions.map((node) => {
        // Session drag never leaves its browser-local account, and pinned
        // rows reorder only within their leading pinned block.
          const sameGroupDrag = drag !== null && drag.accountKey === group.key
          const compatibleTarget = sameGroupDrag && drag.pinned === node.pinned
          const normalizeHalf = (half: 'before' | 'after'): 'before' | 'after' =>
            node.blank ? 'after' : half
          const dragProps = {
            start: () => {
              sessionDropCommitted.current = false
              setDrag({ accountKey: group.key, sessionId: node.id, pinned: node.pinned, over: null })
            },
            active: compatibleTarget,
            marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
            hover: (half: 'before' | 'after') => {
            /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
              setDrag(d => (d === null ? d : {
                ...d, over: { id: node.id, half: normalizeHalf(half) },
              }))
            },
            drop: (half: 'before' | 'after') => {
            /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
              if (drag === null) return
              commitSessionDrag(drag, { id: node.id, half: normalizeHalf(half) })
            },
            end: () => {
              if (drag?.over !== null && drag?.over !== undefined) commitSessionDrag(drag, drag.over)
              else setDrag(null)
              sessionDropCommitted.current = false
            },
          }
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={current}
              now={now}
              onOpen={open}
              onRenameRequest={onSessionRenameRequest}
              renderSlot={renderSlot}
              onReveal={node.id === revealSessionId && group.key === revealGroup
                ? () => { onSessionRevealed(node.id) }
                : undefined}
              drag={dragProps}
              t={t}
            />
          )
        })}
        {collapsed.hiddenCount > 0 && (
          <button
            type="button"
            className={css.sessionOverflowButton}
            data-row-key={`overflow:${group.key}`}
            aria-expanded={sessionsExpanded}
            onClick={() => {
              if (sessionsExpanded) {
                dropWatermarks(key => key === group.key)
                return
              }
              setStoredWatermarks(marks => ({
                ...marks,
                [group.key]: visible.hiddenCount <= SESSION_WATERMARK_BASE ? Infinity : watermark + SESSION_WATERMARK_BASE,
              }))
              setWatermarkMotionKey(key => key + 1)
            }}
          >
            {sessionsExpanded
              ? t('sessions.collapse')
              : t('sessions.expand', { n: visible.hiddenCount })}
          </button>
        )}
      </div>
    )
  }

  return (
    <HoverCardGroup className={clsx(css.treeBody, css.wide)}>
      {workspaceDropAtListStart && <span className={css.listTopDropIndicator} aria-hidden="true" />}
      <AnimatedRows
        className={clsx(css.list, workspaceDropAtListStart && css.listTopDropActive)}
        label={t('section.sessions')}
        rowKeys={rowKeys}
        ready={list.phase === 'ready' && workspaceReady && !nativeDragActive}
        resetKey={JSON.stringify([animationResetKey, watermarkMotionKey])}
      >
        {groups.length === 0 && workspaceSections.length === 0 && (
          <EmptySessions rowState={rowState} onLeaveArchivedOnly={onLeaveArchivedOnly} t={t} />
        )}
        {displayedRootGroups.map((group) => {
          const workspaceSection = group.workspaceId === undefined
            ? undefined
            : sectionByWorkspaceId.get(group.workspaceId)
          const startingSections = sectionPlacement.beforeGroup.get(group.key) ?? []
          const workspaceSectionExpanded = workspaceSection === undefined
            || !collapsedWorkspaceSections.has(workspaceSection.id)
          const groupElement = workspaceSectionExpanded ? renderGroup(group, 0) : null
          return (
            <Fragment key={group.key}>
              {startingSections.map(sectionRow)}
              {workspaceSectionExpanded && (workspaceSection === undefined
                ? groupElement
                : <div className={css.workspaceSectionChildren}>{groupElement}</div>)}
            </Fragment>
          )
        })}
        {sectionPlacement.trailing.map(sectionRow)}
      </AnimatedRows>
      <span className={css.fade} />
    </HoverCardGroup>
  )
}

/** The flat "In one list" body: every session is one draggable top-level row. */
function FlatList({
  list, sessionIds, rowState, onLeaveArchivedOnly, useSessionStatus, open, onSessionRenameRequest,
  usePanelInfo, setSessionOrder, workspaceReady, animationResetKey,
  revealSessionId, onSessionRevealed, renderSlot, t,
}: Pick<
  SessionTreeProps,
  | 'useSessionStatus'
  | 'open'
  | 'onSessionRenameRequest'
  | 'renderSlot'
  | 'usePanelInfo'
  | 'setSessionOrder'
  | 'workspaceReady'
  | 'animationResetKey'
  | 'revealSessionId'
  | 'onSessionRevealed'
  | 'rowState'
  | 'onLeaveArchivedOnly'
  | 't'
> & {
  list: SessionListState
  sessionIds: readonly SessionId[]
}) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const rows = useMemo(
    () => deriveFlat(list, sessionIds, rowState, statuses),
    [list, sessionIds, rowState, statuses],
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const commitDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    const nextOrder = sessionDragOrder(sessionIds, rows, activeDrag, over)
    if (nextOrder !== undefined) setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder)
  }
  const now = Date.now()
  return (
    <HoverCardGroup className={clsx(css.treeBody, css.wide)}>
      <AnimatedRows
        className={clsx(css.list, css.flatList)}
        label={t('section.sessions')}
        rowKeys={rows.length === 0 ? ['empty'] : rows.map(row => `session:${row.id}`)}
        ready={list.phase === 'ready' && workspaceReady && drag === null}
        resetKey={animationResetKey}
      >
        {rows.length === 0 && (
          <EmptySessions rowState={rowState} onLeaveArchivedOnly={onLeaveArchivedOnly} t={t} />
        )}
        {rows.map((node) => {
          const active = drag !== null && drag.pinned === node.pinned
          const normalizeHalf = (half: 'before' | 'after'): 'before' | 'after' =>
            node.blank ? 'after' : half
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={currentId}
              now={now}
              onOpen={open}
              onRenameRequest={onSessionRenameRequest}
              renderSlot={renderSlot}
              onReveal={node.id === revealSessionId
                ? () => { onSessionRevealed(node.id) }
                : undefined}
              drag={{
                start: () => {
                  dropCommitted.current = false
                  setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, pinned: node.pinned, over: null })
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  setDrag(current => current === null ? current : {
                    ...current, over: { id: node.id, half: normalizeHalf(half) },
                  })
                },
                drop: (half) => {
                  if (drag !== null) commitDrag(drag, { id: node.id, half: normalizeHalf(half) })
                },
                end: () => {
                  if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
                  else setDrag(null)
                  dropCommitted.current = false
                },
              }}
              t={t}
            />
          )
        })}
      </AnimatedRows>
      <span className={css.fade} />
    </HoverCardGroup>
  )
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

interface SectionPickerRequest {
  categoryId: string
  section: WorkspaceCategorySection
}

/** Flat search body: local metadata matches plus the current Host result page. */
function SearchResults({
  useSessions,
  useSessionStatus,
  open,
  onUnarchive,
  workspaces,
  archivedSessionIds,
  archivedFilter,
  query,
  remote,
  resultLimit,
  usePanelInfo,
  visibleSessionIds: categorySessionIds,
  t,
}: Pick<WorkspaceBrowserProps, 'useSessions' | 'useSessionStatus' | 'open' | 't' | 'usePanelInfo'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  /** Search matches follow the archived filter selected for the list. */
  archivedFilter: ArchivedFilter
  /** Unarchive an archived result row in place. */
  onUnarchive: (id: SessionNode['id']) => void
  query: string
  remote: RemoteSearchState
  resultLimit: number
  visibleSessionIds: ReadonlySet<SessionId>
}) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const list = useSessions(s => s)
  const statuses = useSessionStatus(s => s)
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  const unfilteredResults = useMemo(
    () => deriveSearchResults(
      list,
      workspaces,
      query,
      archivedSessionIds,
      archivedFilter,
      statuses,
      currentRemote,
      resultLimit,
    ),
    [list, workspaces, query, archivedSessionIds, archivedFilter, statuses, currentRemote, resultLimit],
  )
  const results = useMemo(() => ({
    ...unfilteredResults,
    items: unfilteredResults.items.filter(item => categorySessionIds.has(item.id)),
  }), [categorySessionIds, unfilteredResults])
  const pending = currentRemote.status === 'loading'
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={currentId}
              onOpen={open}
              onUnarchive={onUnarchive}
              t={t}
            />
          ))}
        </div>
        {pending && (
          /* Two skeleton rows on an empty list, one when local matches already
             show and only the content hits are outstanding. */
          <div role="status" aria-label={t('search.pending')}>
            {(results.items.length === 0 ? [0, 1] : [0]).map(i => (
              <div key={i} className={css.skeletonRow} aria-hidden="true">
                <span className={css.skeletonDot} />
                <span className={css.skeletonBars}>
                  <span className={css.skeletonBar} />
                  <span className={clsx(css.skeletonBar, css.skeletonBarWide)} />
                </span>
              </div>
            ))}
          </div>
        )}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function WorkspaceBrowser({
  wide,
  usePanelInfo,
  expandSidebar,
  useSessions,
  useSessionStatus,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  requestSessionRename,
  notifyArchivedNotOpenable,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  unarchiveSession,
  createWorkspace,
  searchSessions,
  searchResultLimit,
  activateWorkspaceCategory,
  selectWorkspaceCategory,
  addWorkspaceToCategory,
  renameWorkspaceInCategory,
  removeWorkspaceFromCategory,
  openWorkspaceDetails,
  activateWorkspaceBadge,
  useDirectoryFlow,
  useHostInfo,
  useWorkspaceCategories,
  useShortcuts,
  useWorkspaceShortcuts,
  requestSearch,
  requestAddWorkspace,
  closeAddWorkspace,
  setDirectoryBusy,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  const home = useHostInfo(info => info.home)
  const shortcuts = useShortcuts(rows => rows)
  const searchShortcut = shortcuts.find(row => row.id === 'session.search')
  const addShortcut = shortcuts.find(row => row.id === 'workspace.add')
  const shortcutState = useWorkspaceShortcuts(state => state)
  // Ordering remains live while the rail or search replaces the list body.
  const list = useSessions(state => state)
  const storedWorkspaces = useWorkspaces(state => state.items)
  // The resolved name, not `t`, is the memo dependency: the bound seat keeps
  // its identity across a language switch.
  const defaultWorkspaceName = t('workspace.defaultName')
  const allWorkspaces = useMemo(
    () => storedWorkspaces.map(workspace => ({
      ...workspace,
      title: workspaceDisplayTitle(workspace.title, defaultWorkspaceName),
    })),
    [storedWorkspaces, defaultWorkspaceName],
  )
  const workspacePhase = useWorkspaces(state => state.phase)
  const workspaceStreamState = useWorkspaces(state => state.state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const pinnedSessionIds = useWorkspaces(state => state.pinnedSessionIds)
  const categories = useWorkspaceCategories(state => state.categories)
  const ordinaryCategoryLabel = categories.find(category => category.ordinaryLabel !== undefined)?.ordinaryLabel
    ?? t('section.workspaces')
  const mainSessionId = Object.values(list.byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const categoryForCurrent = mainSessionId === undefined
    ? undefined
    : categories.find(category => (category.reservedWorkspaceIds ?? category.workspaceIds).some(workspaceId =>
      allWorkspaces.find(workspace => workspace.workspaceId === workspaceId)?.sessionIds.includes(mainSessionId)))?.id
  const activeCategoryId = useWorkspaceCategories(state => state.activeCategoryId)
  useEffect(() => {
    if (mainSessionId === undefined) return
    selectWorkspaceCategory(categoryForCurrent)
  }, [categoryForCurrent, mainSessionId, selectWorkspaceCategory])
  const activeCategory = categories.find(category => category.id === activeCategoryId)
  const reservedWorkspaceIds = useMemo(
    () => new Set(categories.flatMap(category => category.reservedWorkspaceIds ?? category.workspaceIds)),
    [categories],
  )
  const workspaces = useMemo(
    () => activeCategory === undefined
      ? allWorkspaces.filter(workspace => !reservedWorkspaceIds.has(workspace.workspaceId))
      : allWorkspaces.filter(workspace => activeCategory.workspaceIds.includes(workspace.workspaceId)),
    [activeCategory, allWorkspaces, reservedWorkspaceIds],
  )
  const reservedSessionIds = useMemo(() => new Set(
    allWorkspaces
      .filter(workspace => reservedWorkspaceIds.has(workspace.workspaceId))
      .flatMap(workspace => workspace.sessionIds),
  ), [allWorkspaces, reservedWorkspaceIds])
  const categorySessionIds = useMemo(() => activeCategory === undefined
    ? new Set(list.ids.filter(sessionId => !reservedSessionIds.has(sessionId)))
    : new Set(workspaces.flatMap(workspace => workspace.sessionIds)),
  [activeCategory, list.ids, reservedSessionIds, workspaces])
  const categoryList = useMemo(() => ({
    ...list,
    ids: list.ids.filter(id => categorySessionIds.has(id)),
  }), [categorySessionIds, list])
  const newSessionDisabledWorkspaceIds = useMemo(
    () => new Set(activeCategory?.newSessionDisabledWorkspaceIds ?? []),
    [activeCategory],
  )
  const manageableWorkspaceIds = useMemo(
    () => new Set(activeCategory?.manageableWorkspaceIds ?? (activeCategory === undefined
      ? workspaces.map(workspace => workspace.workspaceId)
      : [])),
    [activeCategory, workspaces],
  )
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  // Persisted view blobs written before the archived filter existed rehydrate
  // without the field; they read as the default hide-archived view.
  const archivedFilter = useStore(s => s.archivedFilter ?? 'default')
  const animationResetKey = `${activeCategoryId ?? 'ordinary'}/${groupBy}/${orderBy}/${archivedFilter}`
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  // Archived sessions are not openable: the row stays visible under the
  // filter but a click explains instead of navigating.
  const guardedOpen = (sessionId: SessionId): void => {
    if (archivedSessionIds.includes(sessionId)) {
      notifyArchivedNotOpenable()
      return
    }
    open(sessionId)
  }
  const leaveArchivedOnly = (): void => { actions.setArchivedFilter('default') }
  const workspaceReady = workspacePhase === 'ready' && workspaceStreamState !== 'loading'
  const currentBlank = mainSessionId !== undefined && list.byId[mainSessionId]?.blank === true
    ? mainSessionId
    : undefined
  const startVisibleSession = (workspaceId?: WorkspaceId, options?: Parameters<WorkspaceBrowserProps['startSession']>[1]): void => {
    if (activeCategory === undefined || options !== undefined) {
      if (options === undefined) startSession(workspaceId)
      else startSession(workspaceId, options)
      return
    }
    void activateWorkspaceCategory(activeCategory.id, workspaceId).catch((reason: unknown) => {
      console.warn('workspace category activation failed:', reason)
    })
  }
  const openVisibleSession = (sessionId: SessionId): void => {
    const workspaceId = sessionId === currentBlank
      ? workspaces.find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId
      : undefined
    if (activeCategory !== undefined && workspaceId !== undefined
      && !newSessionDisabledWorkspaceIds.has(workspaceId)) {
      startVisibleSession(workspaceId)
      return
    }
    guardedOpen(sessionId)
  }
  const ungroupedMemberIds = useMemo(() => {
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    return list.ids.filter(id => list.byId[id] !== undefined && categorySessionIds.has(id) && !accounted.has(id))
  }, [categorySessionIds, list, workspaces])
  const orderState = useMemo(
    () => ({ pinnedSessionIds, archivedSessionIds }),
    [archivedSessionIds, pinnedSessionIds],
  )
  const rowState = useMemo<SessionRowState>(
    () => ({ ...orderState, archivedFilter }),
    [orderState, archivedFilter],
  )
  const flatMemberIds = useMemo(() => sessionMemberIds(categoryList), [categoryList])
  const orderedWorkspaces = useMemo(() => workspaces.map((workspace) => {
    const memberIds = workspace.sessionIds
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(memberIds, list.byId)
      : reconcileManualOrder(memberIds, sessionOrderByAccount[workspace.workspaceId], list.byId, orderState)
    return {
      ...workspace,
      sessionIds: pinCurrentBlank(
        baseOrder,
        currentBlank !== undefined && memberIds.includes(currentBlank) ? currentBlank : undefined,
      ),
    }
  }), [currentBlank, list.byId, orderBy, orderState, sessionOrderByAccount, workspaces])
  const orderedUngroupedSessionIds = useMemo(() => {
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(ungroupedMemberIds, list.byId)
      : reconcileManualOrder(ungroupedMemberIds, sessionOrderByAccount[UNGROUPED_KEY], list.byId, orderState)
    return pinCurrentBlank(
      baseOrder,
      currentBlank !== undefined && ungroupedMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, list.byId, orderBy, orderState, sessionOrderByAccount, ungroupedMemberIds])
  const orderedFlatSessionIds = useMemo(() => {
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(flatMemberIds, list.byId)
      : reconcileManualOrder(flatMemberIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY], list.byId, orderState)
    return pinCurrentBlank(
      baseOrder,
      currentBlank !== undefined && flatMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, flatMemberIds, list.byId, orderBy, orderState, sessionOrderByAccount])
  const activeSessionOrders = useMemo<Readonly<Record<string, readonly SessionId[]>>>(() => Object.fromEntries([
    ...orderedWorkspaces.map(workspace => [workspace.workspaceId, workspace.sessionIds] as const),
    [UNGROUPED_KEY, orderedUngroupedSessionIds] as const,
    [FLAT_SESSION_ORDER_KEY, orderedFlatSessionIds] as const,
  ]), [orderedFlatSessionIds, orderedUngroupedSessionIds, orderedWorkspaces])
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    actions.retainAccountKeys([
      UNGROUPED_KEY,
      FLAT_SESSION_ORDER_KEY,
      ...allWorkspaces.map(workspace => workspace.workspaceId),
    ])
  }, [actions.retainAccountKeys, allWorkspaces, workspacePhase])
  useEffect(() => {
    if (list.phase !== 'ready' || workspaceReady || orderBy !== 'manual' || currentBlank === undefined) return
    // A first prompt can end blank pinning before the Workspace baseline arrives.
    // Preserve saved members until that baseline can establish departures.
    const changed: Record<string, readonly string[]> = {}
    for (const [key, ids] of Object.entries(activeSessionOrders)) {
      if (key !== FLAT_SESSION_ORDER_KEY && workspacePhase !== 'ready') continue
      const saved = sessionOrderByAccount[key] ?? []
      if (ids[0] !== currentBlank || saved[0] === currentBlank) continue
      changed[key] = [currentBlank, ...saved.filter(id => id !== currentBlank)]
    }
    if (Object.keys(changed).length > 0) actions.syncSessionOrders(changed)
  }, [
    actions.syncSessionOrders,
    activeSessionOrders,
    currentBlank,
    list.phase,
    orderBy,
    sessionOrderByAccount,
    workspacePhase,
    workspaceReady,
  ])
  useEffect(() => {
    if (list.phase !== 'ready' || !workspaceReady || orderBy !== 'manual' || currentBlank === undefined) return
    const moved = Object.entries(activeSessionOrders).some(([key, ids]) =>
      ids[0] === currentBlank && sessionOrderByAccount[key]?.[0] !== currentBlank)
    if (moved) actions.syncSessionOrders(activeSessionOrders)
  }, [
    actions.syncSessionOrders,
    activeSessionOrders,
    currentBlank,
    list.phase,
    orderBy,
    sessionOrderByAccount,
    workspaceReady,
  ])
  const saveSessionOrder = (accountKey: string, order: readonly string[]): void => {
    actions.setSessionOrder(accountKey, order, activeSessionOrders)
  }
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [revealSessionId, setRevealSessionId] = useState<SessionId | undefined>(undefined)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  // Section-header ＋ opens the picker menu (same popover in wide and rail
  // states; the menu anchors on this button).
  const wsPickerOpen = shortcutState.addRequested
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  const [sectionPicker, setSectionPicker] = useState<SectionPickerRequest | null>(null)
  const sectionPickerRef = useRef<SectionPickerRequest | null>(null)
  const sectionPlusRef = useRef<HTMLButtonElement | null>(null)
  const composingRef = useRef(false)

  const openSearchResult = (sessionId: SessionId): void => {
    if (archivedSessionIds.includes(sessionId)) {
      notifyArchivedNotOpenable()
      return
    }
    setRevealSessionId(sessionId)
    setQuery('')
    setSearchExpanded(false)
    openVisibleSession(sessionId)
  }
  const acknowledgeSessionReveal = (sessionId: SessionId): void => {
    setRevealSessionId(current => current === sessionId ? undefined : current)
  }
  useEffect(() => {
    if (normalizedQuery !== '') setRevealSessionId(undefined)
  }, [normalizedQuery])

  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])
  useEffect(() => {
    if (shortcutState.searchRequest === 0) return
    closeAddWorkspace()
    setSearchExpanded(true)
    if (!wide) {
      setSearchOnExpand(true)
      expandSidebar()
    } else searchInput.current?.focus({ preventScroll: true })
  }, [shortcutState.searchRequest])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])

  // Outside-click dismissal stays off while the rail gesture is in flight
  // (searchOnExpand): the rail click flips the shell wide and mounts this
  // listener during its own dispatch, then keeps bubbling to document with
  // the now-unmounted rail button as its target — outside searchRoot, so the
  // listener would dismiss the search that click just opened.
  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery,
      status: 'loading',
      items: [],
      hasMore: false,
    })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // Rename dialog (browser-owned so it outlives row unmounts during collapse).
  const [renameTarget, setRenameTarget] = useState<{
    workspaceId: WorkspaceId
    storedTitle: string
    categoryId?: string
  } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  // Self is excluded by identity, not by title: the draft is seeded with the
  // localized label, which for an automatically titled Workspace equals its
  // own displayed title without being a conflict with itself.
  const renameDuplicate = renameTarget !== null && renameTrimmed !== ''
    && workspaces.some(w => w.workspaceId !== renameTarget.workspaceId && w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.storedTitle || renameDuplicate
  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    const operation = renameTarget.categoryId === undefined
      ? renameWorkspace(renameTarget.workspaceId, renameTrimmed)
      : renameWorkspaceInCategory(renameTarget.categoryId, renameTarget.workspaceId, renameTrimmed)
    operation.then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // The search results' restore button; the row actions own the rest of the
  // Session verbs as slot entries.
  const onSessionUnarchive = (sessionId: SessionNode['id']) => {
    unarchiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session unarchive rejected:', reason)
    })
  }

  // Delete dialog is separate from the row so a successful removal can
  // unmount that row without tearing down the in-flight confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<{
    workspaceId: WorkspaceId
    title: string
    categoryId?: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, workspaces])
  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    const operation = deleteTarget.categoryId === undefined
      ? deleteWorkspace(deleteTarget.workspaceId)
      : removeWorkspaceFromCategory(deleteTarget.categoryId, deleteTarget.workspaceId)
    operation.then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <div className={clsx(css.sectionLabels, searchExpanded && css.sectionLabelHidden)}>
            <button
              type="button"
              className={clsx(
                css.sectionLabel,
                css.wide,
                css.categoryButton,
                activeCategory === undefined && css.categoryButtonActive,
              )}
              onClick={() => {
                closeAddWorkspace()
                selectWorkspaceCategory(undefined)
              }}
            >
              {groupBy === 'flat' ? t('section.sessions') : ordinaryCategoryLabel}
            </button>
            {categories.map(category => (
              <button
                key={category.id}
                type="button"
                className={clsx(css.categoryButton, activeCategory?.id === category.id && css.categoryButtonActive)}
                onClick={() => {
                  closeAddWorkspace()
                  selectWorkspaceCategory(category.id)
                  void activateWorkspaceCategory(category.id).catch((reason: unknown) => {
                    console.warn('workspace category activation failed:', reason)
                  })
                }}
              >
                {category.label}
              </button>
            ))}
          </div>
        )}
        {wide && (
          <div className={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
            <div
              ref={searchRoot}
              className={clsx(css.search, searchExpanded && css.searchExpanded)}
              onClick={() => {
                closeAddWorkspace()
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} shortcutKeys={searchShortcut?.keys} side="bottom" delayMs={500} disabled={searchExpanded}>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-keyshortcuts={searchShortcut?.aria}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    requestSearch()
                  }}
                >
                  <IconSearchOutlineRegular size={searchExpanded ? 11 : 14} />
                </button>
              </Tooltip>
              <input
                ref={searchInput}
                className={css.searchInput}
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={query}
                tabIndex={searchExpanded ? 0 : -1}
                onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  setQuery('')
                  setSearchExpanded(false)
                }}
              />
              {searchExpanded && (
                <button
                  type="button"
                  className={css.clearButton}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuery('')
                    setSearchExpanded(false)
                  }}
                >
                  <IconCloseFillRegular />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
          {wide && (
            <ViewOptionsMenu
              groupBy={groupBy}
              orderBy={orderBy}
              archivedFilter={archivedFilter}
              onGroupPick={actions.setGroupBy}
              onOrderPick={(mode) => { actions.setOrderBy(mode, activeSessionOrders) }}
              onArchivedFilterPick={actions.setArchivedFilter}
              t={t}
            />
          )}
          {/* Adding is the button's one action, so a composition with no
              picking affordance has nothing to offer here: the region hides the
              button rather than leaving a dead one in the header. */}
          {directoryFlowAvailable && activeCategory === undefined && (
            <Tooltip label={t('workspace.add')} shortcutKeys={addShortcut?.keys} side="bottom" delayMs={500}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                aria-keyshortcuts={addShortcut?.aria}
                onClick={() => {
                  requestAddWorkspace()
                }}
              >
                <IconProjectAddOutlineRegular size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
        </div>
        {/* Add flow + its error dialog (same package — direct composition). */}
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          onBusyChange={setDirectoryBusy}
          side="right"
          onPick={(workspaceId) => {
            closeAddWorkspace()
            startVisibleSession(workspaceId, { clearPreviousDraft: false })
          }}
          onClose={() => { closeAddWorkspace() }}
        />
      </div>

      {/* The collapsed rail keeps search as its own 36px control. */}
      {!wide && <div className={css.search}>
        <Tooltip label={t('search')} shortcutKeys={searchShortcut?.keys}>
          <button
            type="button"
            className={css.searchButton}
            aria-label={t('search.sessions.aria')}
            aria-keyshortcuts={searchShortcut?.aria}
            onClick={() => {
              requestSearch()
            }}
          >
            <IconSearchOutlineRegular size={18} />
          </button>
        </Tooltip>
      </div>}

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea}>
        {wide && (normalizedQuery !== ''
          ? (
            <SearchResults
              usePanelInfo={usePanelInfo}
              useSessions={useSessions}
              useSessionStatus={useSessionStatus}
              open={openSearchResult}
              onUnarchive={onSessionUnarchive}
              workspaces={workspaces}
              archivedSessionIds={archivedSessionIds}
              archivedFilter={archivedFilter}
              query={normalizedQuery}
              remote={remoteSearch}
              resultLimit={searchResultLimit}
              visibleSessionIds={categorySessionIds}
              t={t}
            />
          )
          : groupBy === 'flat'
            ? (
              <FlatList
                usePanelInfo={usePanelInfo}
                list={categoryList}
                sessionIds={orderedFlatSessionIds}
                rowState={rowState}
                onLeaveArchivedOnly={leaveArchivedOnly}
                workspaceReady={workspaceReady}
                animationResetKey={animationResetKey}
                useSessionStatus={useSessionStatus}
                open={openVisibleSession}
                onSessionRenameRequest={requestSessionRename}
                renderSlot={renderSlot}
                setSessionOrder={saveSessionOrder}
                revealSessionId={revealSessionId}
                onSessionRevealed={acknowledgeSessionReveal}
                t={t}
              />
            )
            : (
              <SessionTree
                usePanelInfo={usePanelInfo}
                list={categoryList}
                shortcuts={shortcuts}
                useSessionStatus={useSessionStatus}
                onSessionRenameRequest={requestSessionRename}
                renderSlot={renderSlot}
                workspaces={orderedWorkspaces}
                ungroupedSessionIds={orderedUngroupedSessionIds}
                workspaceReady={workspaceReady}
                nestWorkspaces={groupBy === 'workspace-tree'}
                animationResetKey={animationResetKey}
                groupExpansion={groupExpansion}
                setGroupExpanded={actions.setGroupExpanded}
                setSessionOrder={saveSessionOrder}
                rowState={rowState}
                onLeaveArchivedOnly={leaveArchivedOnly}
                startSession={startVisibleSession}
                open={openVisibleSession}
                insertWorkspaceBefore={insertWorkspaceBefore}
                revealSessionId={revealSessionId}
                onSessionRevealed={acknowledgeSessionReveal}
                home={home}
                t={t}
                newSessionDisabledWorkspaceIds={newSessionDisabledWorkspaceIds}
                workspaceSections={activeCategory?.sections ?? []}
                sectionAddAvailable={directoryFlowAvailable}
                onSectionAdd={(section, anchor) => {
                  if (activeCategory === undefined) return
                  sectionPlusRef.current = anchor
                  const request = { categoryId: activeCategory.id, section }
                  sectionPickerRef.current = request
                  setSectionPicker(request)
                }}
                manageWorkspaces={activeCategory === undefined}
                manageableWorkspaceIds={manageableWorkspaceIds}
                {...activeCategory === undefined ? {} : { removeWorkspaceLabel: t('remove.workspace') }}
                {...activeCategory?.workspaceDetailsLabel === undefined
                  ? {}
                  : { workspaceDetailsLabel: activeCategory.workspaceDetailsLabel }}
                workspaceDetailsWorkspaceIds={new Set(activeCategory?.workspaceDetailsWorkspaceIds ?? [])}
                workspaceBadges={activeCategory?.workspaceBadges ?? []}
                onWorkspaceDetails={(workspaceId) => {
                  if (activeCategory !== undefined) openWorkspaceDetails(activeCategory.id, workspaceId)
                }}
                onWorkspaceBadgeAction={(workspaceId) => {
                  if (activeCategory !== undefined) {
                    void activateWorkspaceBadge(activeCategory.id, workspaceId)
                  }
                }}
                onRenameRequest={(workspaceId, currentTitle) => {
                  setRenameTarget({
                    workspaceId,
                    storedTitle: storedWorkspaces.find(w => w.workspaceId === workspaceId)?.title ?? currentTitle,
                    ...(activeCategory === undefined ? {} : { categoryId: activeCategory.id }),
                  })
                  setRenameDraft(currentTitle)
                  setRenameError(null)
                }}
                onDeleteRequest={(workspaceId, title) => {
                  setDeleteTarget({
                    workspaceId,
                    title,
                    ...(activeCategory === undefined ? {} : { categoryId: activeCategory.id }),
                  })
                  setDeleteError(null)
                }}
              />
            ))}
      </div>

      <WorkspacePickFlow
        t={t}
        open={sectionPicker !== null}
        anchorRef={sectionPlusRef}
        useWorkspaces={useWorkspaces}
        createWorkspace={async ({ path }) => {
          const request = sectionPickerRef.current
          if (request === null) return undefined
          const workspaceId = await addWorkspaceToCategory(request.categoryId, request.section.id, path)
          if (workspaceId === undefined) {
            sectionPickerRef.current = null
            return undefined
          }
          return { workspaceId }
        }}
        useDirectoryFlow={useDirectoryFlow}
        renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
        addOnly
        {...(sectionPickerRef.current?.section.initialPath === undefined
          ? {}
          : { initialPath: sectionPickerRef.current.section.initialPath })}
        side="right"
        onPick={(workspaceId) => {
          sectionPickerRef.current = null
          setSectionPicker(null)
          startVisibleSession(workspaceId)
        }}
        onClose={() => {
          // The menu closes before the directory chooser returns its path.
          setSectionPicker(null)
        }}
      />

      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          data-modal-autofocus
          disabled={renaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t(deleteTarget?.categoryId === undefined ? 'delete.workspace' : 'remove.workspace')}
        {...deleteTarget === null
          ? {}
          : { description: t(
            deleteTarget.categoryId === undefined ? 'delete.desc' : 'remove.desc',
            { name: deleteTarget.title },
          ) }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {t(deleteTarget?.categoryId === undefined ? 'delete.workspace' : 'remove.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{
          t(deleteTarget?.categoryId === undefined ? 'delete.pending' : 'remove.pending')
        }</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>
    </div>
  )
}
