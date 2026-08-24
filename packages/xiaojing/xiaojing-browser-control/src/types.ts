/** Browser-safe request, result, settings, and extension protocol vocabulary. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier for one browser page. */
export type BrowserPageId = Branded<'BrowserPageId'>

/**
 * Brand a browser page identifier at its owning package boundary.
 * @param id - Internal identifier text.
 * @returns Opaque page identifier.
 */
export function BrowserPageId(id: string): BrowserPageId {
  return id as BrowserPageId
}

/** Opaque identifier for one browser window. */
export type BrowserWindowId = Branded<'BrowserWindowId'>

/**
 * Brand a browser window identifier at its owning package boundary.
 * @param id - Internal identifier text.
 * @returns Opaque window identifier.
 */
export function BrowserWindowId(id: string): BrowserWindowId {
  return id as BrowserWindowId
}

/** Opaque identifier for one browser observation. */
export type BrowserObservationId = Branded<'BrowserObservationId'>

/**
 * Brand a browser observation identifier at its owning package boundary.
 * @param id - Internal identifier text.
 * @returns Opaque observation identifier.
 */
export function BrowserObservationId(id: string): BrowserObservationId {
  return id as BrowserObservationId
}

/** Opaque identifier for one target within a browser observation. */
export type BrowserTargetId = Branded<'BrowserTargetId'>

/**
 * Brand a browser target identifier at its owning package boundary.
 * @param id - Internal identifier text.
 * @returns Opaque target identifier.
 */
export function BrowserTargetId(id: string): BrowserTargetId {
  return id as BrowserTargetId
}

/** Browser implementation that owns a page. */
export type BrowserSurface = 'managed' | 'personal'

/** Route preference accepted from an explicit user instruction. */
export type BrowserSurfacePreference = 'auto' | BrowserSurface

/** Whether an open request may reuse a page or requires a new top-level window. */
export type BrowserDisposition = 'reuse' | 'new_window'

/** Browser operations exposed through the model-facing tool. */
export const BROWSER_ACTIONS = [
  'open',
  'observe',
  'act',
  'click',
  'fill',
  'type',
  'select',
  'check',
  'uncheck',
  'hover',
  'press',
  'scroll',
  'upload',
  'wait_for',
  'show',
  'tabs',
  'switch_tab',
  'close_tab',
] as const

/** One supported browser operation. */
export type BrowserAction = typeof BROWSER_ACTIONS[number]

/** Operations accepted inside one bounded batch. */
export const BROWSER_STEP_ACTIONS = [
  'click', 'fill', 'type', 'select', 'check', 'uncheck', 'hover', 'press', 'scroll', 'upload', 'wait_for',
] as const

/** One operation accepted inside a batch. */
export type BrowserStepAction = typeof BROWSER_STEP_ACTIONS[number]

/** A semantic target that may be resolved after an earlier batch step changes the page. */
export interface BrowserSemanticTarget {
  /** Semantic role, such as button, textbox, menuitem, or checkbox. */
  readonly role?: string
  /** Exact accessible name or visible label. */
  readonly name?: string
  /** Exact bounded dialog, row, form, or region context from an observation. */
  readonly context?: string
}

/** One action in an `act` request. */
export interface BrowserActStep {
  /** Operation to perform. */
  readonly action: BrowserStepAction
  /** Opaque target from the request's observation. */
  readonly targetId?: BrowserTargetId
  /** Semantic target for controls revealed by an earlier step. */
  readonly target?: BrowserSemanticTarget
  /** Text for fill/type/select or expected text for wait_for. */
  readonly value?: string
  /** Playwright key for press. */
  readonly key?: string
  /** Vertical scroll delta. */
  readonly deltaY?: number
  /** Absolute local paths for upload. */
  readonly paths?: readonly string[]
  /** URL expected after this step. */
  readonly expectedUrl?: string
  /** Visible text expected after this step. */
  readonly expectedText?: string
  /** Per-step wait bound. */
  readonly timeoutMs?: number
}

/** Input accepted by {@link import('./index.ts').BrowserControl.run}. */
export interface BrowserActionRequest {
  /** Operation to perform. */
  readonly action: BrowserAction
  /** HTTP or HTTPS destination for `open`, or URL expected by `wait_for`. */
  readonly url?: string
  /** Preferred route. `personal` and `managed` are honored only when the user explicitly requested one. */
  readonly surface?: BrowserSurfacePreference
  /** Page reuse is the default; `new_window` creates another top-level window on the selected route. */
  readonly disposition?: BrowserDisposition
  /** Observation that issued `targetId`. */
  readonly observationId?: BrowserObservationId
  /** Opaque target identifier from the latest observation. */
  readonly targetId?: BrowserTargetId
  /** Semantic target used by a single action. */
  readonly target?: BrowserSemanticTarget
  /** Text for fill/type/select or expected text for wait_for. */
  readonly value?: string
  /** Playwright keyboard key for press, such as `Enter` or `Control+L`. */
  readonly key?: string
  /** Vertical wheel delta for scroll. */
  readonly deltaY?: number
  /** Absolute local paths for upload. */
  readonly paths?: readonly string[]
  /** Opaque page identifier for tab operations. */
  readonly pageId?: BrowserPageId
  /** Bounded ordered steps for `act`. */
  readonly steps?: readonly BrowserActStep[]
  /** Visible text expected by wait_for. */
  readonly expectedText?: string
  /** Per-operation wait bound. */
  readonly timeoutMs?: number
}

/** One semantic interactive element in a browser observation. */
export interface BrowserTarget {
  /** Opaque identifier valid only for the containing observation. */
  readonly id: BrowserTargetId
  /** Semantic role inferred from the element. */
  readonly role: string
  /** Bounded accessible label or visible text. */
  readonly name: string
  /** Dialog, table-row, form, or region context that distinguishes repeated labels. */
  readonly context?: string
  /** Current non-secret value when useful. */
  readonly value?: string
  /** Whether browser semantics report the element disabled. */
  readonly disabled: boolean
  /** Whether a checkbox or radio target is selected. */
  readonly checked?: boolean
  /** Operations supported by this target. */
  readonly actions: BrowserStepAction[]
}

/** One browser page visible to the requesting session. */
export interface BrowserPageSummary {
  /** Opaque page identifier. */
  readonly id: BrowserPageId
  /** Implementation that owns the page. */
  readonly surface: BrowserSurface
  /** Opaque top-level window identifier. */
  readonly windowId: BrowserWindowId
  /** Current page URL. */
  readonly url: string
  /** Current document title. */
  readonly title: string
  /** Whether this is the session's active page. */
  readonly active: boolean
}

/** Failed batch step returned without replaying any completed step. */
export interface BrowserFailedStep {
  /** Zero-based step index. */
  readonly index: number
  /** Operation that failed. */
  readonly action: BrowserStepAction
  /** User-safe failure. */
  readonly error: string
}

/** Canonical result returned by `browser_control`. */
export interface BrowserActionResult {
  /** Operation that produced the result. */
  readonly action: BrowserAction
  /** Short operational summary. */
  readonly summary: string
  /** Implementation used by the operation. */
  readonly surface?: BrowserSurface
  /** Active page identifier, when a page exists. */
  readonly pageId?: BrowserPageId
  /** Active top-level window identifier. */
  readonly windowId?: BrowserWindowId
  /** Current page URL. */
  readonly url?: string
  /** Current document title. */
  readonly title?: string
  /** Fresh observation identifier after a page operation. */
  readonly observationId?: BrowserObservationId
  /** Bounded visible page text. */
  readonly text?: string
  /** Fresh semantic targets. */
  readonly targets?: BrowserTarget[]
  /** Pages discoverable across both Edge routes. */
  readonly tabs?: BrowserPageSummary[]
  /** Number of successful batch steps. */
  readonly completedSteps?: number
  /** First failed batch step. */
  readonly failedStep?: BrowserFailedStep
  /** Whether page text or targets were truncated by configured bounds. */
  readonly truncated?: boolean
}

/** Personal Edge extension lifecycle shown in settings. */
export type PersonalEdgeState = 'not-connected' | 'pairing' | 'connected' | 'incompatible' | 'error'

/** Sanitized browser-control status returned only to the loopback Client. */
export interface BrowserControlStatus {
  /** Dedicated Playwright route status. */
  readonly managed: {
    readonly enabled: true
    readonly running: boolean
  }
  /** Optional personal Edge route status. */
  readonly personal: {
    readonly state: PersonalEdgeState
    readonly extensionId: string
    readonly connected: boolean
    readonly paired: boolean
    readonly version?: string
    readonly pairingCode?: string
    readonly pairingExpiresAt?: number
    readonly error?: string
  }
}
