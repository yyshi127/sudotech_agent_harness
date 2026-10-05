/** Client-safe status and Host runtime registration for native browser settings. @module */

/** Browser brand selected by an operator. */
export type NativeBrowser = 'edge' | 'chrome'

/** Permission, setup, and live connection states shown by the settings page. */
export type NativeBrowserState = 'disabled' | 'setup-required' | 'ready' | 'connecting' | 'connected' | 'disconnected'

/** Sanitized status of one browser; installation paths and page contents stay on the Host. */
export interface NativeBrowserStatus {
  browser: NativeBrowser
  /** Null when installation metadata could not be inspected. */
  installed: boolean | null
  enabled: boolean
  setupReady: boolean
  state: NativeBrowserState
  error?: string
}

/** Status returned by the native browser settings RPC. */
export interface NativeBrowserControlStatus {
  /** Host can open and verify the browser's settings page; other platforms retain manual setup. */
  canOpenSettings: boolean
  browsers: NativeBrowserStatus[]
}

/** Host-only installation metadata used to open the browser's own settings page. */
export interface NativeBrowserInstallation {
  installed: boolean
  setupReady: boolean
  executablePath?: string
}

/** Runtime callbacks keep browser connections owned by their exact live Agents. */
export interface NativeBrowserSettingsRuntime {
  /**
   * Inspect installation and native debugging readiness without connecting to tabs.
   * @param browser - browser to inspect.
   * @param signal - operator request cancellation.
   * @returns metadata without reading browser credentials or tab contents.
   */
  inspect(browser: NativeBrowser, signal: AbortSignal): Promise<NativeBrowserInstallation>
  /**
   * Read the last observed native connection state.
   * @param browser - browser whose live connections are observed.
   * @returns live state, or undefined when no connection has been acquired.
   */
  state(browser: NativeBrowser): 'connecting' | 'connected' | 'disconnected' | undefined
  /**
   * Cancel and release this browser's existing-tab connections without closing the browser.
   * @param browser - browser whose access the operator revoked.
   * @returns after pending operations and connection cleanup settle.
   */
  revoke(browser: NativeBrowser): Promise<void>
}

/** Product settings consumed by the native browser runtime. */
export interface NativeBrowserSettingsService {
  /**
   * Read the operator's persisted permission to control existing tabs.
   * @param browser - browser brand to check.
   * @returns whether existing-tab control is enabled.
   */
  enabled(browser: NativeBrowser): boolean
  /**
   * Register the active native runtime, excluding simultaneous replacements.
   * @param runtime - installation, connection-state, and revocation callbacks.
   * @returns disposer that removes only this registration.
   */
  registerRuntime(runtime: NativeBrowserSettingsRuntime): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Operator settings for controlling already-open Chrome and Edge tabs. */
    xiaojingNativeBrowserSettings: NativeBrowserSettingsService
  }
}
