import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { chromium } from 'playwright-core'
import BrowserControl, {
  BROWSER_CONTROL_SETTINGS_NAMESPACE, isPrivateAddress, privateDestination,
} from '../src/index.ts'

const cleanup: Array<() => Promise<void>> = []
const execFileAsync = promisify(execFile)

class MemorySettings extends SettingsProvider {
  private readonly stored: Record<string, unknown> = {}

  override get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.stored))
  }

  protected persist(namespace: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.stored[namespace] = structuredClone(section)
    return Promise.resolve()
  }
}

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

describe('browser destination policy', () => {
  it('recognizes local, private, mapped, and public addresses', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('10.4.3.2')).toBe(true)
    expect(isPrivateAddress('172.31.1.1')).toBe(true)
    expect(isPrivateAddress('192.168.1.1')).toBe(true)
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('rejects non-http protocols and identifies localhost without DNS', async () => {
    await expect(privateDestination('file:///tmp/secret')).rejects.toThrow(/only http/u)
    await expect(privateDestination('http://localhost:3000')).resolves.toBe('localhost')
  })
})

const executable = chromium.executablePath()
const browserIt = process.platform === 'win32' || existsSync(executable) ? it : it.skip

describe('Playwright browser provider', () => {
  browserIt('projects semantic targets through the declared tsx ESM source launcher', async () => {
    const fixture = resolve(import.meta.dirname, 'fixtures/source-launch-smoke.ts')
    const root = resolve(import.meta.dirname, '../../../..')
    const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx/esm', fixture], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(stdout).toContain('source-launch-browser-ok')
  }, 30_000)

  browserIt('observes and operates semantic targets while invalidating stale observations', async () => {
    let serviceWorkerRequests = 0
    let hangingRequests = 0
    const server = createServer((request, response) => {
      if (request.url === '/hang') {
        hangingRequests += 1
        return
      }
      if (request.url === '/sw.js') {
        response.setHeader('content-type', 'application/javascript; charset=utf-8')
        response.end(`
          self.addEventListener('install', event => {
            self.skipWaiting()
            event.waitUntil(fetch('/worker-probe'))
          })
          self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
        `)
        return
      }
      if (request.url === '/worker-probe') {
        serviceWorkerRequests += 1
        response.end('worker ok')
        return
      }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html><html><body>
        <label>Name <input aria-label="Name"></label>
        <button id="submit">Submit</button>
        <button id="delete">Delete report</button>
        <a href="/popup" target="_blank">Open expense report</a>
        <p id="result"></p>
        <script>
          navigator.serviceWorker.register('/sw.js')
          document.querySelector('#submit').addEventListener('click', () => {
            document.querySelector('#result').textContent = 'Hello ' + document.querySelector('input').value
          })
          document.querySelector('#delete').addEventListener('click', () => {
            document.querySelector('#result').textContent = 'Deleted report'
          })
        </script>
      </body></html>`)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanup.push(async () => new Promise<void>((resolve) => {
      server.close(() => { resolve() })
    }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture server did not bind TCP')

    const profileDir = await mkdtemp(join(tmpdir(), 'xiaojing-browser-test-'))
    cleanup.push(() => rm(profileDir, { recursive: true, force: true }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService, { policy: 'never' })
    await ctx.plugin(MemorySettings)
    const chromeProfileDir = await mkdtemp(join(tmpdir(), 'xiaojing-chrome-browser-test-'))
    cleanup.push(() => rm(chromeProfileDir, { recursive: true, force: true }))
    const fiber = await ctx.plugin(BrowserControl, {
      profileDir,
      chromeProfileDir,
      ...existsSync(executable) ? { executablePath: executable } : {},
      headless: true,
      actionTimeoutMs: 5_000,
      navigationTimeoutMs: 10_000,
      maxTabs: 1,
    })
    let fiberDisposed = false
    cleanup.push(async () => {
      if (!fiberDisposed) await fiber.dispose()
    })

    const signal = new AbortController().signal
    const owner = SessionId('session-a')
    const otherOwner = SessionId('session-b')
    const service = ctx.xiaojingBrowserControl
    type TestPage = {
      locator(selector: string): { evaluate(fn: (element: Element) => void): Promise<void> }
    }
    type TestContext = {
      pages(): TestPage[]
      newPage(): Promise<unknown>
      close(): Promise<void>
    }
    const contextFor = (browser: 'edge' | 'chrome'): TestContext | undefined => (
      service as unknown as { runtimes: Map<string, { context?: TestContext }> }
    ).runtimes.get(browser)?.context
    const firstInterrupted = new AbortController()
    const firstHanging = ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/hang`,
    }, firstInterrupted.signal)
    setTimeout(() => { firstInterrupted.abort(new Error('first navigation interruption')) }, 100)
    await expect(firstHanging).rejects.toThrow(/first navigation interruption/u)

    const firstOpened = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    const openedContext = contextFor('edge')
    if (openedContext === undefined) throw new Error('browser fixture did not retain its persistent context')
    await openedContext.newPage()
    await ctx.xiaojingBrowserControl.run(owner, { action: 'close_tab' }, signal)
    const discovered = await ctx.xiaojingBrowserControl.run(owner, { action: 'tabs' }, signal)
    const discoveredPage = discovered.tabs?.[0]
    expect(discoveredPage?.url).toBe('about:blank')
    if (discoveredPage === undefined) throw new Error('browser fixture did not discover its existing blank tab')
    await openedContext.newPage()
    expect(openedContext.pages()).toHaveLength(2)
    const opened = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/?step=2`,
    }, signal)
    expect(opened.pageId).toBe(discoveredPage.id)
    expect(opened.pageId).not.toBe(firstOpened.pageId)
    expect(openedContext.pages()).toHaveLength(1)
    const reused = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/?step=3`,
    }, signal)
    expect(reused.pageId).toBe(opened.pageId)
    expect(openedContext.pages()).toHaveLength(1)
    const current = reused
    expect(current.text).toContain('Name')
    const workerDeadline = Date.now() + 5_000
    while (serviceWorkerRequests === 0 && Date.now() < workerDeadline) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(serviceWorkerRequests).toBeGreaterThan(0)
    const input = current.targets?.find(target => target.name === 'Name')
    expect(input?.actions).toContain('fill')
    if (current.observationId === undefined || input === undefined) throw new Error('browser fixture input was not observed')
    await expect(ctx.xiaojingBrowserControl.run(otherOwner, {
      action: 'fill', observationId: current.observationId, targetId: input.id, value: 'Wrong owner',
    }, signal)).rejects.toThrow(/another session/u)
    const openedPage = openedContext.pages()[0]
    if (openedPage === undefined) throw new Error('browser fixture did not retain its opened page')
    await openedPage.locator('input').evaluate((element) => { element.replaceWith(element.cloneNode(true)) })
    await expect(ctx.xiaojingBrowserControl.run(owner, {
      action: 'fill', observationId: current.observationId, targetId: input.id, value: 'Wrong row',
    }, signal)).rejects.toThrow(/changed.*observe again/u)
    const refreshed = await ctx.xiaojingBrowserControl.run(owner, { action: 'observe' }, signal)
    const refreshedInput = refreshed.targets?.find(target => target.name === 'Name')
    if (refreshed.observationId === undefined || refreshedInput === undefined) {
      throw new Error('browser fixture replacement input was not observed')
    }
    const filled = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'fill', observationId: refreshed.observationId, targetId: refreshedInput.id, value: 'Ada',
    }, signal)
    expect(filled.targets?.find(target => target.name === 'Name')?.value).toBe('Ada')
    await expect(ctx.xiaojingBrowserControl.run(owner, {
      action: 'click', observationId: current.observationId, targetId: input.id,
    }, signal)).rejects.toThrow(/missing|expired|stale/u)
    const submit = filled.targets?.find(target => target.name === 'Submit')
    if (filled.observationId === undefined || submit === undefined) throw new Error('browser fixture submit was not observed')
    await expect(ctx.xiaojingBrowserControl.approvalReason(owner, {
      action: 'click', observationId: filled.observationId, targetId: submit.id,
    })).resolves.toMatch(/high-impact/u)
    const submitted = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'click', observationId: filled.observationId, targetId: submit.id,
    }, signal)
    expect(submitted.text).toContain('Hello Ada')
    const destructive = submitted.targets?.find(target => target.name === 'Delete report')
    if (submitted.observationId === undefined || destructive === undefined) {
      throw new Error('browser fixture delete control was not observed')
    }
    const session = Session.create(owner)
    session.append('turn/start', { turn: 1 })
    const agent = { id: owner, session } as unknown as Agent
    const answered = vi.fn(() => Promise.resolve<'allowed-once'>('allowed-once'))
    ctx.on('approval/request', answered)
    const deleted = await ctx.tools.execute({
      signal,
      callId: CallId('browser-delete-under-never'),
      name: 'browser_control',
      arguments: {
        action: 'click',
        observation_id: submitted.observationId,
        target_id: destructive.id,
      },
      agent,
    })
    expect(deleted.error?.message).toBeUndefined()
    expect(deleted.isError).toBe(false)
    expect(answered).toHaveBeenCalledOnce()
    expect((await ctx.xiaojingBrowserControl.run(owner, { action: 'tabs' }, signal)).tabs).toHaveLength(1)

    const interrupted = new AbortController()
    const hanging = ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/hang`,
    }, interrupted.signal)
    setTimeout(() => { interrupted.abort(new Error('fixture navigation interruption')) }, 100)
    await expect(hanging).rejects.toThrow(/fixture navigation interruption/u)
    const recovered = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(recovered.text).toContain('Name')
    const popup = recovered.targets?.find(target => target.name === 'Open expense report')
    if (recovered.observationId === undefined || popup === undefined) throw new Error('browser fixture popup link was not observed')
    await expect(ctx.xiaojingBrowserControl.run(owner, {
      action: 'click', observationId: recovered.observationId, targetId: popup.id,
    }, signal)).resolves.toMatchObject({ action: 'click' })
    let boundedTabs = await ctx.xiaojingBrowserControl.run(owner, { action: 'tabs' }, signal)
    const popupDeadline = Date.now() + 2_000
    while (boundedTabs.truncated !== true && Date.now() < popupDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
      boundedTabs = await ctx.xiaojingBrowserControl.run(owner, { action: 'tabs' }, signal)
    }
    expect({ count: boundedTabs.tabs?.length, truncated: boundedTabs.truncated }).toEqual({ count: 1, truncated: true })

    const closing = ctx.xiaojingBrowserControl.close()
    await expect(ctx.xiaojingBrowserControl.run(otherOwner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)).rejects.toThrow(/is closing/u)
    await closing
    const reopened = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(reopened.text).toContain('Name')

    const expectedHangingRequests = hangingRequests + 1
    const closingActive = ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/hang`,
    }, signal)
    const closingQueued = ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    const closingResults = Promise.allSettled([closingActive, closingQueued])
    const hangingDeadline = Date.now() + 5_000
    while (hangingRequests < expectedHangingRequests && Date.now() < hangingDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(hangingRequests).toBe(expectedHangingRequests)

    await ctx.xiaojingBrowserControl.close()
    const [activeResult, queuedResult] = await closingResults
    expect(activeResult?.status).toBe('rejected')
    expect(queuedResult?.status).toBe('rejected')

    const recoveredAfterClose = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(recoveredAfterClose.text).toContain('Name')

    const currentContext = contextFor('edge')
    if (currentContext === undefined) throw new Error('browser fixture did not retain its persistent context')
    await currentContext.close()
    const recoveredAfterExternalClose = await service.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(recoveredAfterExternalClose.text).toContain('Name')

    const edgeContext = contextFor('edge')
    const chromeOverride = await service.run(owner, {
      action: 'open', browser: 'chrome', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(chromeOverride.browser).toBe('chrome')
    const chromeContext = contextFor('chrome')
    expect(chromeContext).toBeDefined()
    expect(contextFor('edge')).toBe(edgeContext)
    const defaultEdge = await service.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(defaultEdge.browser).toBe('edge')
    expect(contextFor('edge')).toBe(edgeContext)
    await ctx.settings.update(BROWSER_CONTROL_SETTINGS_NAMESPACE, { browser: 'chrome' })
    const chromeOpened = await service.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(chromeOpened.text).toContain('Name')
    expect(chromeOpened.browser).toBe('chrome')
    expect(contextFor('chrome')).toBe(chromeContext)

    const expectedDisposalRequests = hangingRequests + 1
    const disposalActive = service.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/hang`,
    }, signal)
    const disposalResult = Promise.allSettled([disposalActive])
    const disposalDeadline = Date.now() + 5_000
    while (hangingRequests < expectedDisposalRequests && Date.now() < disposalDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(hangingRequests).toBe(expectedDisposalRequests)

    await fiber.dispose()
    fiberDisposed = true
    expect((await disposalResult)[0]?.status).toBe('rejected')
    await expect(service.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)).rejects.toThrow(/plugin was unloaded/u)
  }, 30_000)
})
