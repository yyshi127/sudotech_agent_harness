/** Playwright-owned persistent Microsoft Edge adapter. */

import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { chromium } from 'playwright-core'
import type { BrowserContext, Page, Route } from 'playwright-core'
import { BrowserPageId, BrowserWindowId } from './types.ts'
import type { BrowserDisposition, BrowserPageId as PageId, BrowserWindowId as WindowId } from './types.ts'

/** Runtime configuration owned by the dedicated Edge route. */
export interface ManagedEdgeOptions {
  readonly profileDir: string
  readonly executablePath?: string
  readonly headless: boolean
  readonly actionTimeoutMs: number
  readonly navigationTimeoutMs: number
}

/** One globally discoverable page in the managed Edge profile. */
export interface ManagedPageRecord {
  readonly id: PageId
  readonly page: Page
  readonly windowId: Promise<WindowId>
}

interface BrowserRuntime {
  context: BrowserContext | undefined
  launch: Promise<BrowserContext> | undefined
  generation: number
}

/**
 * Locate Microsoft Edge when Playwright's channel lookup misses fixed Windows locations.
 * @returns The first available Edge executable, or undefined outside Windows or when Edge is absent.
 */
export async function findWindowsEdgeExecutable(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter((root): root is string => root !== undefined && root !== '')
  const standard = roots.map(root => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  for (const candidate of standard) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Missing fixed installation locations are expected while probing Edge.
    }
  }
  for (const root of roots) {
    const edgeCore = join(root, 'Microsoft', 'EdgeCore')
    let versions
    try {
      versions = await readdir(edgeCore, { withFileTypes: true })
    } catch {
      continue
    }
    const directories = versions.filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }))
    for (const version of directories) {
      const candidate = join(edgeCore, version, 'msedge.exe')
      try {
        await access(candidate)
        return candidate
      } catch {
        // Incomplete EdgeCore versions contribute no executable.
      }
    }
  }
  return undefined
}

/**
 * Close one page while preserving a headed persistent browser's final blank page.
 * @param page - Managed page to close.
 */
export async function closeManagedPage(page: Page): Promise<void> {
  if (page.isClosed()) return
  const context = page.context()
  if (context.pages().filter(candidate => !candidate.isClosed()).length === 1) {
    try {
      await context.newPage()
    } catch {
      // An exiting browser cannot accept the replacement blank page.
    }
  }
  try {
    await page.close({ runBeforeUnload: false })
  } catch {
    // A crashed or concurrently closed page has no resources left to release.
  }
}

/**
 * Race one Playwright operation against cancellation and contain a cancelled page.
 * @param page - Page owned by the operation.
 * @param signal - Task cancellation signal.
 * @param operation - Playwright operation to run.
 * @returns The operation result.
 */
export async function withManagedPageCancellation<T>(
  page: Page,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('browser operation cancelled')
  let remove = () => {}
  let closing: Promise<void> | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      closing = closeManagedPage(page)
      void closing.then(() => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('browser operation cancelled'))
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    remove = () => { signal.removeEventListener('abort', onAbort) }
  })
  try {
    return await Promise.race([operation(), aborted])
  } catch (error) {
    const cancellation = abortError(signal)
    if (cancellation !== undefined) {
      if (closing !== undefined) await closing
      throw cancellation
    }
    throw error
  } finally {
    remove()
  }
}

async function closeContext(context: BrowserContext): Promise<void> {
  try {
    await context.close()
  } catch {
    // A crashed or already closed browser has no remaining context resources.
  }
}

/** Dedicated Edge lifecycle, global page catalog, and top-level window creation. */
export class ManagedEdgeAdapter {
  private readonly runtime: BrowserRuntime = { context: undefined, launch: undefined, generation: 0 }
  private readonly closedContexts = new WeakSet<BrowserContext>()
  private readonly pagesById = new Map<PageId, ManagedPageRecord>()
  private readonly idsByPage = new WeakMap<Page, PageId>()
  private readonly windowsByPage = new WeakMap<Page, Promise<WindowId>>()
  private readonly fallbackWindow = BrowserWindowId(`bw-managed-${randomUUID()}`)

  /** @param guardRoute - Network policy called for every managed Edge request. */
  constructor(
    private readonly ctx: Context,
    private readonly options: ManagedEdgeOptions,
    private readonly guardRoute: (route: Route) => Promise<void>,
  ) {}

  /** Whether the dedicated Edge process is currently connected. */
  get running(): boolean {
    return this.runtime.context !== undefined
  }

  /**
   * Lazily start Edge and return its persistent context.
   * @returns The live persistent Edge context.
   */
  async browser(): Promise<BrowserContext> {
    const runtime = this.runtime
    if (runtime.context !== undefined) return runtime.context
    if (runtime.launch !== undefined) return await runtime.launch
    const generation = runtime.generation
    const launch = this.launchBrowser().then(async (context) => {
      if (generation !== runtime.generation || this.closedContexts.has(context)) {
        await closeContext(context)
        throw new Error('managed Edge launch was cancelled or closed during startup')
      }
      runtime.context = context
      this.syncPages(context)
      return context
    })
    runtime.launch = launch
    try {
      return await launch
    } finally {
      if (runtime.launch === launch) runtime.launch = undefined
    }
  }

  /**
   * Return every currently open managed page without assigning it to a session.
   * @param start - Whether to start Edge when it is not running.
   * @returns Live globally discoverable managed pages.
   */
  async pages(start = false): Promise<ManagedPageRecord[]> {
    const context = start ? await this.browser() : this.runtime.context
    if (context !== undefined) this.syncPages(context)
    return [...this.pagesById.values()].filter(record => !record.page.isClosed())
  }

  /**
   * Resolve one managed page by its opaque global identifier.
   * @param id - Global managed-page identifier.
   * @returns The live page record, or undefined after it closes.
   */
  page(id: PageId): ManagedPageRecord | undefined {
    const record = this.pagesById.get(id)
    return record === undefined || record.page.isClosed() ? undefined : record
  }

  /**
   * Open a tab, or a true top-level window when explicitly requested.
   * @param disposition - Whether a reusable tab or new top-level window is required.
   * @param signal - Task cancellation signal.
   * @returns The created or reused blank page record.
   */
  async create(disposition: BrowserDisposition, signal: AbortSignal): Promise<ManagedPageRecord> {
    const context = await this.browser()
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('browser operation cancelled')
    }
    if (disposition !== 'new_window') {
      const blank = context.pages().find(page => !page.isClosed() && page.url() === 'about:blank')
      return this.track(blank ?? await context.newPage())
    }
    const seed = context.pages().find(page => !page.isClosed()) ?? await context.newPage()
    const created = context.waitForEvent('page', { timeout: this.options.navigationTimeoutMs })
    const session = await context.newCDPSession(seed)
    try {
      await session.send('Target.createTarget', { url: 'about:blank', newWindow: true })
      return this.track(await created)
    } finally {
      await session.detach().catch(() => undefined)
    }
  }

  /**
   * Bring one managed page to the front only for an explicit show operation.
   * @param record - Managed page to show.
   */
  async show(record: ManagedPageRecord): Promise<void> {
    await record.page.bringToFront()
  }

  /**
   * Close one managed page and remove it from the global catalog.
   * @param record - Managed page to close.
   * @param signal - Task cancellation signal.
   */
  async closePage(record: ManagedPageRecord, signal: AbortSignal): Promise<void> {
    await withManagedPageCancellation(record.page, signal, () => record.page.close({ runBeforeUnload: false }))
    this.drop(record.page)
  }

  /** Cancel startup, close Edge, and clear all ephemeral page identities. */
  async close(): Promise<void> {
    const context = this.runtime.context
    const launch = this.runtime.launch
    this.runtime.generation += 1
    this.runtime.context = undefined
    this.runtime.launch = undefined
    this.pagesById.clear()
    if (context !== undefined) await closeContext(context)
    if (launch !== undefined) {
      const launched = await launch.catch(() => undefined)
      if (launched !== undefined && launched !== context) await closeContext(launched)
    }
  }

  private async launchBrowser(): Promise<BrowserContext> {
    await mkdir(this.options.profileDir, { recursive: true })
    const common = {
      headless: this.options.headless,
      viewport: null,
      acceptDownloads: true,
      timeout: this.options.navigationTimeoutMs,
    } as const
    let context: BrowserContext | undefined
    const configured = this.options.executablePath
    if (configured !== undefined) {
      try {
        context = await chromium.launchPersistentContext(this.options.profileDir, {
          ...common,
          executablePath: configured,
        })
      } catch (error) {
        throw new AggregateError([error], 'browser-control could not start the configured Microsoft Edge runtime')
      }
    }
    try {
      context ??= await chromium.launchPersistentContext(this.options.profileDir, { ...common, channel: 'msedge' })
    } catch (channelError) {
      const errors: unknown[] = [channelError]
      const executable = await findWindowsEdgeExecutable()
      if (executable !== undefined) {
        try {
          context = await chromium.launchPersistentContext(this.options.profileDir, { ...common, executablePath: executable })
        } catch (error) {
          errors.push(error)
        }
      }
      if (context === undefined) throw new AggregateError(errors, 'browser-control could not start Microsoft Edge')
    }
    const live = context
    live.setDefaultTimeout(this.options.actionTimeoutMs)
    live.setDefaultNavigationTimeout(this.options.navigationTimeoutMs)
    live.on('close', () => { this.browserClosed(live) })
    await live.route('**/*', async (route) => {
      try {
        await this.guardRoute(route)
      } catch (error) {
        this.ctx.logger.warn('browser-control blocked a request after route-policy failure: %s', String(error))
        await route.abort('blockedbyclient').catch(() => undefined)
      }
    })
    live.on('page', (page) => { this.track(page) })
    this.ctx.logger.info('browser-control started dedicated Microsoft Edge')
    return live
  }

  private syncPages(context: BrowserContext): void {
    for (const page of context.pages()) {
      if (!page.isClosed()) this.track(page)
    }
  }

  private track(page: Page): ManagedPageRecord {
    const existingId = this.idsByPage.get(page)
    const existing = existingId === undefined ? undefined : this.pagesById.get(existingId)
    if (existing !== undefined) return existing
    const record: ManagedPageRecord = {
      id: BrowserPageId(`bp-managed-${randomUUID()}`),
      page,
      windowId: this.windowId(page),
    }
    this.pagesById.set(record.id, record)
    this.idsByPage.set(page, record.id)
    page.on('close', () => { this.drop(page) })
    return record
  }

  private windowId(page: Page): Promise<WindowId> {
    const existing = this.windowsByPage.get(page)
    if (existing !== undefined) return existing
    const resolved = page.context().newCDPSession(page).then(async (session) => {
      try {
        const response = await session.send('Browser.getWindowForTarget') as { windowId?: number }
        return response.windowId === undefined
          ? this.fallbackWindow
          : BrowserWindowId(`bw-managed-${String(response.windowId)}`)
      } catch {
        return this.fallbackWindow
      } finally {
        await session.detach().catch(() => undefined)
      }
    })
    this.windowsByPage.set(page, resolved)
    return resolved
  }

  private drop(page: Page): void {
    const id = this.idsByPage.get(page)
    if (id !== undefined) this.pagesById.delete(id)
  }

  private browserClosed(context: BrowserContext): void {
    this.closedContexts.add(context)
    if (this.runtime.context !== context) return
    this.runtime.context = undefined
    for (const record of [...this.pagesById.values()]) {
      if (record.page.context() === context) this.drop(record.page)
    }
  }
}

function abortError(signal: AbortSignal): Error | undefined {
  if (!signal.aborted) return undefined
  return signal.reason instanceof Error ? signal.reason : new Error('browser operation cancelled')
}
