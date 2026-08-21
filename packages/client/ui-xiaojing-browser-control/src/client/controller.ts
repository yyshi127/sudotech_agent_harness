/** Reactive browser preference controller over the Host settings namespace. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Settings namespace owned by the Host browser-control plugin. */
export const BROWSER_CONTROL_SETTINGS_NAMESPACE = 'xiaojing-browser-control'

/** Browsers the product lets a user select. */
export type BrowserKind = 'edge' | 'chrome'

/** Browser-control settings fields exposed to this page. */
export interface BrowserControlSettings {
  /** Installed browser used for subsequent automation work. */
  browser: BrowserKind
}

/** State rendered by the standalone browser-control settings page. */
export interface BrowserControlView {
  status: 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  browser: BrowserKind
  writable: boolean
  error: string | null
}

/**
 * Narrow a Host settings section to the browser preference this client understands.
 *
 * @param section - Untrusted settings namespace value received from the Host.
 * @returns The supported browser preference, or `undefined` for an incompatible value.
 */
export function decodeBrowserControlSettings(section: unknown): BrowserControlSettings | undefined {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
  const browser = (section as { browser?: unknown }).browser
  return browser === 'edge' || browser === 'chrome' ? { browser } : undefined
}

/** Mirrors the Host setting and serializes explicit browser choices. */
export class BrowserControlSettingsController {
  /** uSES-safe view source consumed by the slot renderer. */
  readonly store: SnapshotStore<BrowserControlView> = createSnapshotStore<BrowserControlView>({
    status: 'loading', browser: 'edge', writable: false, error: null,
  })

  private saving = false
  private readonly unsubscribe: () => void

  /** @param scope - bound browser-control settings namespace. */
  constructor(private readonly scope: SettingsScope<BrowserControlSettings>) {
    this.unsubscribe = scope.subscribe(() => { this.derive() })
    this.derive()
  }

  /**
   * Persist one explicit browser choice.
   *
   * @param browser - Browser used for subsequent automation operations.
   */
  async select(browser: BrowserKind): Promise<void> {
    const current = this.store.getSnapshot()
    if (this.saving || (current.status === 'ready' && current.browser === browser)) return
    if (!current.writable) {
      this.store.update((view) => {
        view.status = 'error'
        view.error = 'browser settings are not writable'
      })
      return
    }
    this.saving = true
    this.store.update((view) => {
      view.status = 'saving'
      view.browser = browser
      view.error = null
    })
    try {
      await this.scope.set('browser', browser)
    } catch (error) {
      this.store.update((view) => {
        view.status = 'error'
        view.error = error instanceof Error ? error.message : String(error)
      })
      return
    } finally {
      this.saving = false
    }
    this.derive()
  }

  /** Stop following the settings scope. */
  dispose(): void {
    this.unsubscribe()
  }

  private derive(): void {
    if (this.saving) return
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status === 'loading') {
      this.store.set({ status: 'loading', browser: 'edge', writable: false, error: null })
      return
    }
    if (snapshot.status === 'unavailable' || snapshot.value === undefined) {
      this.store.set({ status: 'unavailable', browser: 'edge', writable: false, error: null })
      return
    }
    this.store.set({
      status: 'ready',
      browser: snapshot.value.browser,
      writable: snapshot.writable,
      error: null,
    })
  }
}
