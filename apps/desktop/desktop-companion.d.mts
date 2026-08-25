/** Content-free task state exposed to the Electron desktop companion. */
export interface DesktopCompanionSnapshot {
  state: 'idle' | 'thinking' | 'executing' | 'approval' | 'success' | 'failure'
  activeTaskCount: number
  approvalCount: number
  weixinOnline: boolean
  revision: number
}

/** Persisted desktop-companion preference document after validation. */
export interface DesktopCompanionPreferences {
  schemaVersion: 1
  visible: boolean
  scale: number
  trayHintShown: boolean
  position?: { x: number; y: number; displayId: string | number }
}

/** Minimal Electron display fields used by geometry helpers. */
export interface DesktopCompanionDisplay {
  id: string | number
  workArea: { x: number; y: number; width: number; height: number }
}

/** Companion window bounds in physical screen coordinates. */
export interface DesktopCompanionBounds {
  x: number
  y: number
  width: number
  height: number
}

export const IDLE_COMPANION_SNAPSHOT: Readonly<DesktopCompanionSnapshot>
export const DEFAULT_COMPANION_SCALE: 0.5
export const MIN_COMPANION_SCALE: 0.3
export const MAX_COMPANION_SCALE: 1
export function isCompanionSnapshot(value: unknown): value is DesktopCompanionSnapshot
export function isCompanionScale(value: unknown): value is number
export function normalizeCompanionPreferences(value: unknown): DesktopCompanionPreferences
export function defaultCompanionBounds(
  display: DesktopCompanionDisplay,
  mainWindowBounds?: DesktopCompanionBounds,
): DesktopCompanionBounds
export function resolveCompanionBounds(
  preferences: Pick<DesktopCompanionPreferences, 'position'>,
  displays: readonly DesktopCompanionDisplay[],
  primaryDisplay: DesktopCompanionDisplay,
  mainWindowBounds?: DesktopCompanionBounds,
): DesktopCompanionBounds
