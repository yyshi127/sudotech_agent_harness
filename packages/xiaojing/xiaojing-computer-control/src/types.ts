/** Public request and result vocabulary for Xiaojing Windows computer control. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier for one application in a session-owned Windows catalog. */
export type ComputerAppId = Branded<'ComputerAppId'>

/**
 * Brand a Windows application identifier at its owning package boundary.
 * @param id - Raw identifier returned by the Windows helper.
 * @returns The same string as a Windows application identifier.
 */
export function ComputerAppId(id: string): ComputerAppId {
  return id as ComputerAppId
}

/** Opaque identifier for one listed Windows top-level window. */
export type ComputerWindowId = Branded<'ComputerWindowId'>

/**
 * Brand a Windows window identifier at its owning package boundary.
 * @param id - Raw identifier returned by the Windows helper.
 * @returns The same string as a Windows window identifier.
 */
export function ComputerWindowId(id: string): ComputerWindowId {
  return id as ComputerWindowId
}

/** Opaque identifier for one Windows UI Automation observation. */
export type ComputerObservationId = Branded<'ComputerObservationId'>

/**
 * Brand a Windows observation identifier at its owning package boundary.
 * @param id - Raw identifier returned by the Windows helper.
 * @returns The same string as a Windows observation identifier.
 */
export function ComputerObservationId(id: string): ComputerObservationId {
  return id as ComputerObservationId
}

/** Opaque identifier for one target within a Windows UI Automation observation. */
export type ComputerTargetId = Branded<'ComputerTargetId'>

/**
 * Brand a Windows target identifier at its owning package boundary.
 * @param id - Raw identifier returned by the Windows helper.
 * @returns The same string as a Windows target identifier.
 */
export function ComputerTargetId(id: string): ComputerTargetId {
  return id as ComputerTargetId
}

/** Windows operations exposed through the model-facing tool. */
export const COMPUTER_ACTIONS = [
  'list_apps',
  'launch_app',
  'list_windows',
  'observe',
  'invoke',
  'set_value',
  'toggle',
  'select',
  'focus',
  'press_key',
  'scroll',
  'wait',
] as const

/** One supported Windows operation. */
export type ComputerAction = typeof COMPUTER_ACTIONS[number]

/** Input accepted by {@link ComputerControl.run}. */
export interface ComputerActionRequest {
  /** Operation to perform. */
  readonly action: ComputerAction
  /** Optional installed-application name filter for `list_apps`. */
  readonly query?: string
  /** Opaque application identifier from `list_apps`. */
  readonly appId?: ComputerAppId
  /** Opaque window identifier from `list_windows`. */
  readonly windowId?: ComputerWindowId
  /** Observation that issued `targetId`. */
  readonly observationId?: ComputerObservationId
  /** Opaque UI Automation target identifier. */
  readonly targetId?: ComputerTargetId
  /** Text for `set_value`. */
  readonly value?: string
  /** Windows Forms SendKeys expression for `press_key`. */
  readonly key?: string
  /** Scroll direction. */
  readonly direction?: 'up' | 'down' | 'left' | 'right'
  /** Text to wait for inside the selected window. */
  readonly text?: string
  /** Wait timeout requested by the model, bounded by plugin configuration. */
  readonly timeoutMs?: number
}

/** One application discovered through the Windows Start application catalog. */
export interface ComputerApp {
  /** Opaque identifier valid only for the owning session's latest application listing. */
  readonly id: ComputerAppId
  /** Display name registered with Windows. */
  readonly name: string
}

/** One top-level desktop window. */
export interface ComputerWindow {
  /** Opaque identifier valid until the next window listing. */
  readonly id: ComputerWindowId
  /** Window title. */
  readonly title: string
  /** Owning Windows process identifier. */
  readonly processId: number
}

/** One semantic UI Automation element in an observation. */
export interface ComputerTarget {
  /** Opaque identifier valid only for the containing observation. */
  readonly id: ComputerTargetId
  /** UI Automation control type, such as Button or Edit. */
  readonly controlType: string
  /** Bounded accessible name. */
  readonly name: string
  /** Current non-secret value when the provider exposes one. */
  readonly value?: string
  /** Whether UI Automation reports the element enabled. */
  readonly enabled: boolean
  /** Supported semantic operations. */
  readonly actions: string[]
}

/** Canonical result returned by `computer_control`. */
export interface ComputerActionResult {
  /** Operation that produced the result. */
  readonly action: ComputerAction
  /** Short operational summary. */
  readonly summary: string
  /** Application display name for a completed launch. */
  readonly appName?: string
  /** Applications matching the latest catalog query. */
  readonly apps?: ComputerApp[]
  /** Current top-level window identifier. */
  readonly windowId?: ComputerWindowId
  /** Current top-level window title. */
  readonly windowTitle?: string
  /** Fresh observation identifier after a window operation. */
  readonly observationId?: ComputerObservationId
  /** Available top-level windows. */
  readonly windows?: ComputerWindow[]
  /** Fresh semantic controls. */
  readonly targets?: ComputerTarget[]
  /** Whether the control tree exceeded configured bounds. */
  readonly truncated?: boolean
}
