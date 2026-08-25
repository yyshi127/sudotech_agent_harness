/** Pure preference and display geometry helpers for the Windows desktop companion. */

const COMPANION_WIDTH = 320
const COMPANION_HEIGHT = 380
const COMPANION_MARGIN = 16

/** Default visual scale relative to the original desktop companion size. */
export const DEFAULT_COMPANION_SCALE = 0.5

/** Smallest visual scale accepted from desktop settings. */
const MIN_COMPANION_SCALE = 0.3

/** Largest visual scale accepted from desktop settings. */
const MAX_COMPANION_SCALE = 1

/** Content-free state used before the local Host stream becomes readable. */
export const IDLE_COMPANION_SNAPSHOT = Object.freeze({
  state: 'idle', activeTaskCount: 0, approvalCount: 0, weixinOnline: false, revision: 0,
})

const STATES = new Set(['idle', 'thinking', 'executing', 'approval', 'success', 'failure'])

/** Validate an untrusted snapshot read from the loopback Host stream. */
export function isCompanionSnapshot(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return STATES.has(value.state)
    && Number.isSafeInteger(value.activeTaskCount) && value.activeTaskCount >= 0
    && Number.isSafeInteger(value.approvalCount) && value.approvalCount >= 0
    && typeof value.weixinOnline === 'boolean'
    && Number.isSafeInteger(value.revision) && value.revision >= 0
}

/** Normalize persisted preferences without trusting partial or future JSON. */
export function normalizeCompanionPreferences(value) {
  const row = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
  const position = typeof row.position === 'object' && row.position !== null && !Array.isArray(row.position)
    && Number.isFinite(row.position.x) && Number.isFinite(row.position.y)
    && (typeof row.position.displayId === 'number' || typeof row.position.displayId === 'string')
    ? { x: Math.round(row.position.x), y: Math.round(row.position.y), displayId: row.position.displayId }
    : undefined
  return {
    schemaVersion: 1,
    visible: typeof row.visible === 'boolean' ? row.visible : true,
    scale: isCompanionScale(row.scale) ? row.scale : DEFAULT_COMPANION_SCALE,
    trayHintShown: row.trayHintShown === true,
    ...(position === undefined ? {} : { position }),
  }
}

/** Return whether a renderer-provided visual scale is supported. */
export function isCompanionScale(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= MIN_COMPANION_SCALE && value <= MAX_COMPANION_SCALE
}

/** Return a bottom-right position inside the main window or display work area. */
export function defaultCompanionBounds(display, mainWindowBounds) {
  const area = mainWindowBounds !== undefined
    && mainWindowBounds.width >= COMPANION_WIDTH + COMPANION_MARGIN * 2
    && mainWindowBounds.height >= COMPANION_HEIGHT + COMPANION_MARGIN * 2
    ? mainWindowBounds
    : display.workArea
  const { x, y, width, height } = area
  return {
    x: x + width - COMPANION_WIDTH - COMPANION_MARGIN,
    y: y + height - COMPANION_HEIGHT - COMPANION_MARGIN,
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
  }
}

/** Keep a remembered position fully visible; otherwise anchor it in the main window. */
export function resolveCompanionBounds(preferences, displays, primaryDisplay, mainWindowBounds) {
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
