/** Public request and result vocabulary for Xiaojing browser control. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier for one session-owned browser page. */
export type BrowserPageId = Branded<'BrowserPageId'>

/**
 * Brand a browser page identifier at its owning package boundary.
 * @param id - Raw identifier created by the browser provider.
 * @returns The same string as a browser page identifier.
 */
export function BrowserPageId(id: string): BrowserPageId {
  return id as BrowserPageId
}

/** Opaque identifier for one browser observation. */
export type BrowserObservationId = Branded<'BrowserObservationId'>

/**
 * Brand a browser observation identifier at its owning package boundary.
 * @param id - Raw identifier created by the browser provider.
 * @returns The same string as a browser observation identifier.
 */
export function BrowserObservationId(id: string): BrowserObservationId {
  return id as BrowserObservationId
}

/** Opaque identifier for one target within a browser observation. */
export type BrowserTargetId = Branded<'BrowserTargetId'>

/**
 * Brand a browser target identifier at its owning package boundary.
 * @param id - Raw identifier created by the browser provider.
 * @returns The same string as a browser target identifier.
 */
export function BrowserTargetId(id: string): BrowserTargetId {
  return id as BrowserTargetId
}

/** Browser operations exposed through the model-facing tool. */
export const BROWSER_ACTIONS = [
  'open',
  'observe',
  'click',
  'fill',
  'select',
  'press',
  'scroll',
  'upload',
  'tabs',
  'switch_tab',
  'close_tab',
] as const

/** One supported browser operation. */
export type BrowserAction = typeof BROWSER_ACTIONS[number]

/** Input accepted by {@link BrowserControl.run}. */
export interface BrowserActionRequest {
  /** Operation to perform. */
  readonly action: BrowserAction
  /** HTTP or HTTPS destination for `open`. */
  readonly url?: string
  /** Observation that issued `targetId`. */
  readonly observationId?: BrowserObservationId
  /** Opaque target identifier from the latest observation. */
  readonly targetId?: BrowserTargetId
  /** Text for `fill`, option value or label for `select`. */
  readonly value?: string
  /** Playwright keyboard key for `press`, such as `Enter` or `Control+L`. */
  readonly key?: string
  /** Vertical wheel delta for `scroll`. */
  readonly deltaY?: number
  /** Absolute local paths for `upload`. */
  readonly paths?: readonly string[]
  /** Opaque page identifier for tab operations. */
  readonly pageId?: BrowserPageId
}

/** One semantic interactive element in a browser observation. */
export interface BrowserTarget {
  /** Opaque identifier valid only for the containing observation. */
  readonly id: BrowserTargetId
  /** Semantic role inferred from the element. */
  readonly role: string
  /** Bounded accessible label or visible text. */
  readonly name: string
  /** Current non-secret value when useful. */
  readonly value?: string
  /** Whether browser semantics report the element disabled. */
  readonly disabled: boolean
  /** Whether a checkbox or radio target is selected. */
  readonly checked?: boolean
  /** Operations supported by this target. */
  readonly actions: string[]
}

/** One browser page visible to an owning session. */
export interface BrowserPageSummary {
  /** Opaque page identifier. */
  readonly id: BrowserPageId
  /** Current page URL. */
  readonly url: string
  /** Current document title. */
  readonly title: string
  /** Whether this is the session's active page. */
  readonly active: boolean
}

/** Canonical result returned by `browser_control`. */
export interface BrowserActionResult {
  /** Operation that produced the result. */
  readonly action: BrowserAction
  /** Short operational summary. */
  readonly summary: string
  /** Active page identifier, when a page exists. */
  readonly pageId?: BrowserPageId
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
  /** Session-owned pages for tab operations. */
  readonly tabs?: BrowserPageSummary[]
  /** Whether page text or targets were truncated by configured bounds. */
  readonly truncated?: boolean
}
