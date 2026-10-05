/** Pure preference and display geometry helpers for the Xiaojing desktop companion. */

const COMPANION_WIDTH = 320
const COMPANION_HEIGHT = 380
const COMPANION_MARGIN = 16
const COMPANION_CHARACTER_SIZE = 280
const COMPANION_CHARACTER_RIGHT = 20
// All bundled character poses occupy less than 70% of their square image tile.
const COMPANION_VISIBLE_WIDTH = COMPANION_CHARACTER_SIZE * 0.7

/** Composer coordinates measured in the owned main renderer's CSS viewport. */
export interface DesktopCompanionLayout {
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly composerRight: number
  readonly composerTop: number
}

/**
 * Validate layout messages received over renderer IPC.
 * @param value - Untrusted renderer payload.
 * @returns Whether the payload contains finite composer coordinates inside a positive viewport.
 */
export function isCompanionLayout(value: unknown): value is DesktopCompanionLayout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!(['viewportWidth', 'viewportHeight', 'composerRight', 'composerTop'] as const)
    .every(key => typeof row[key] === 'number' && Number.isFinite(row[key]))) return false
  return Number(row.viewportWidth) > 0 && Number(row.viewportHeight) > 0
    && Number(row.composerRight) >= 0 && Number(row.composerRight) <= Number(row.viewportWidth)
    && Number(row.composerTop) >= 0 && Number(row.composerTop) <= Number(row.viewportHeight)
}

/**
 * Center the character in the composer gutter, or move it above a gutter too narrow for its visible artwork.
 * @param layout - Composer position and CSS viewport dimensions from the main preload.
 * @param content - Main-window content bounds in Electron screen coordinates.
 * @param scale - Saved character scale.
 * @param display - Display whose work area must contain the visible character.
 * @returns Transparent-window bounds; its unused canvas may extend beyond the main window.
 */
export function composerCompanionBounds(
  layout: DesktopCompanionLayout,
  content: DesktopCompanionBounds,
  scale: number,
  display: DesktopCompanionDisplay,
): DesktopCompanionBounds {
  const right = content.x + layout.composerRight * content.width / layout.viewportWidth
  const edge = content.x + content.width
  const visibleHalf = COMPANION_VISIBLE_WIDTH * scale / 2
  const narrow = edge - right < visibleHalf * 2 + COMPANION_MARGIN * 2
  const midpoint = (right + edge) / 2
  const desiredCenter = narrow ? Math.min(midpoint, edge - visibleHalf - COMPANION_MARGIN) : midpoint
  const area = display.workArea
  const center = Math.min(Math.max(desiredCenter, area.x + visibleHalf + COMPANION_MARGIN),
    area.x + area.width - visibleHalf - COMPANION_MARGIN)
  const desiredBottom = narrow
    ? content.y + layout.composerTop * content.height / layout.viewportHeight - COMPANION_MARGIN
    : content.y + content.height - 24
  const bottom = Math.min(Math.max(desiredBottom, area.y + COMPANION_CHARACTER_SIZE * scale + COMPANION_MARGIN),
    area.y + area.height - COMPANION_MARGIN)
  return {
    x: Math.round(center - (COMPANION_WIDTH - COMPANION_CHARACTER_RIGHT - COMPANION_CHARACTER_SIZE * scale / 2)) + 0,
    y: Math.round(bottom - COMPANION_HEIGHT) + 0,
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
  }
}

/** Default visual scale relative to the original desktop companion size. */
export const DEFAULT_COMPANION_SCALE = 0.5
/** Smallest visual scale accepted from desktop settings. */
export const MIN_COMPANION_SCALE = 0.3
/** Largest visual scale accepted from desktop settings. */
export const MAX_COMPANION_SCALE = 1

/** Content-free task state exposed to the companion renderer. */
export interface DesktopCompanionSnapshot {
  readonly state: 'idle' | 'thinking' | 'executing' | 'approval' | 'success' | 'failure'
  readonly activeTaskCount: number
  readonly approvalCount: number
  readonly weixinOnline: boolean
  readonly revision: number
}

/** Persisted desktop-companion preferences after validation. */
export interface DesktopCompanionPreferences {
  readonly schemaVersion: 1
  visible: boolean
  scale: number
  trayHintShown: boolean
  position?: { x: number; y: number; displayId: string | number }
}

/** Minimal Electron display fields used by geometry helpers. */
export interface DesktopCompanionDisplay {
  readonly id: string | number
  readonly workArea: DesktopCompanionBounds
}

/** Companion window bounds in physical screen coordinates. */
export interface DesktopCompanionBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Content-free state used before the local Host stream becomes readable. */
export const IDLE_COMPANION_SNAPSHOT: Readonly<DesktopCompanionSnapshot> = Object.freeze({
  state: 'idle', activeTaskCount: 0, approvalCount: 0, weixinOnline: false, revision: 0,
})
const STATES = new Set<DesktopCompanionSnapshot['state']>(['idle', 'thinking', 'executing', 'approval', 'success', 'failure'])

/** Validate an untrusted snapshot read from the loopback Host stream. */
export function isCompanionSnapshot(value: unknown): value is DesktopCompanionSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.state === 'string' && STATES.has(row.state as DesktopCompanionSnapshot['state'])
    && Number.isSafeInteger(row.activeTaskCount) && Number(row.activeTaskCount) >= 0
    && Number.isSafeInteger(row.approvalCount) && Number(row.approvalCount) >= 0
    && typeof row.weixinOnline === 'boolean'
    && Number.isSafeInteger(row.revision) && Number(row.revision) >= 0
}

/** Return whether a renderer-provided visual scale is supported. */
export function isCompanionScale(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= MIN_COMPANION_SCALE && value <= MAX_COMPANION_SCALE
}

/** Normalize persisted preferences without trusting partial or future JSON. */
export function normalizeCompanionPreferences(value: unknown): DesktopCompanionPreferences {
  const row: Record<string, unknown> = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const candidate = row.position
  const position = typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
    ? candidate as Record<string, unknown> : undefined
  const validPosition = position !== undefined
    && typeof position.x === 'number' && Number.isFinite(position.x)
    && typeof position.y === 'number' && Number.isFinite(position.y)
    && (typeof position.displayId === 'number' || typeof position.displayId === 'string')
    ? { x: Math.round(position.x), y: Math.round(position.y), displayId: position.displayId }
    : undefined
  return {
    schemaVersion: 1,
    visible: typeof row.visible === 'boolean' ? row.visible : true,
    scale: isCompanionScale(row.scale) ? row.scale : DEFAULT_COMPANION_SCALE,
    trayHintShown: row.trayHintShown === true,
    ...(validPosition === undefined ? {} : { position: validPosition }),
  }
}

/** Return a bottom-right position inside the main window or display work area. */
export function defaultCompanionBounds(
  display: DesktopCompanionDisplay,
  mainWindowBounds?: DesktopCompanionBounds,
): DesktopCompanionBounds {
  const area = mainWindowBounds !== undefined
    && mainWindowBounds.width >= COMPANION_WIDTH + COMPANION_MARGIN * 2
    && mainWindowBounds.height >= COMPANION_HEIGHT + COMPANION_MARGIN * 2
    ? mainWindowBounds : display.workArea
  return {
    x: area.x + area.width - COMPANION_WIDTH - COMPANION_MARGIN,
    y: area.y + area.height - COMPANION_HEIGHT - COMPANION_MARGIN,
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
  }
}

/** Keep a remembered position fully visible; otherwise anchor it in the main window. */
export function resolveCompanionBounds(
  preferences: Pick<DesktopCompanionPreferences, 'position'>,
  displays: readonly DesktopCompanionDisplay[],
  primaryDisplay: DesktopCompanionDisplay,
  mainWindowBounds?: DesktopCompanionBounds,
): DesktopCompanionBounds {
  const position = preferences.position
  if (position === undefined) return defaultCompanionBounds(primaryDisplay, mainWindowBounds)
  const display = displays.find(candidate => String(candidate.id) === String(position.displayId)) ?? primaryDisplay
  const { x, y, width, height } = display.workArea
  return {
    x: Math.min(Math.max(position.x, x), x + width - COMPANION_WIDTH),
    y: Math.min(Math.max(position.y, y), y + height - COMPANION_HEIGHT),
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
  }
}
