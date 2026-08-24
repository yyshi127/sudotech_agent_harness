import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { chromium } from 'playwright-core'
import BrowserControl, { isPrivateAddress, privateDestination } from '../src/index.ts'
import { findWindowsEdgeExecutable } from '../src/managed-edge.ts'

const cleanup: Array<() => Promise<void>> = []
const execFileAsync = promisify(execFile)

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

  browserIt('personal Edge extension exposes and clicks delegated pointer tabs', async () => {
    const source = await readFile(resolve(import.meta.dirname, '../extension/service-worker.js'), 'utf8')
    const functionSource = (name: string, next: string): string => {
      const declaration = source.indexOf(`function ${name}(`)
      const start = source.slice(declaration - 6, declaration) === 'async ' ? declaration - 6 : declaration
      const end = source.indexOf(`\n}\n\n${next}`, declaration)
      if (declaration < 0 || end < 0) throw new Error(`extension function ${name} was not found`)
      return source.slice(start, end + 2)
    }
    const scanSource = functionSource('scanFrame', 'async function observe')
    const operateSource = functionSource('operateTarget', 'async function executeInFrame')
    const systemEdge = await findWindowsEdgeExecutable()
    const browser = await chromium.launch({
      headless: true,
      ...(systemEdge === undefined ? { executablePath: executable } : { executablePath: systemEdge }),
    })
    cleanup.push(async () => { await browser.close() })
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><html><body>
      <nav id="search-categories">
        <div id="custom-user-tab" style="cursor: pointer"><span>用户</span></div>
      </nav>
      <span id="selected-category"></span>
      <script>
        document.querySelector('#search-categories').addEventListener('click', event => {
          if (event.target.closest('#custom-user-tab')) {
            document.querySelector('#selected-category').textContent = 'Selected users'
          }
        })
      </script>
    </body></html>`)
    await page.addScriptTag({ content: `${scanSource}\n${operateSource}\n`
      + 'globalThis.__xiaojingScanFrame = scanFrame; globalThis.__xiaojingOperateTarget = operateTarget;' })
    const scan = await page.evaluate(() => {
      const runtime = globalThis as typeof globalThis & { __xiaojingScanFrame: (maxTargets: number, maxTextChars: number) => {
        targets: Array<{ role: string; name: string; context: string; inputType: string; ordinal: number }>
      } }
      return runtime.__xiaojingScanFrame(100, 2_000)
    })
    const users = scan.targets.filter(target => target.name === '用户')
    expect(users).toEqual([expect.objectContaining({ role: 'button', ordinal: 0 })])
    const outcome = await page.evaluate(async (descriptor) => {
      const runtime = globalThis as typeof globalThis & {
        __xiaojingOperateTarget: (command: unknown) => Promise<{ error?: string }>
      }
      return await runtime.__xiaojingOperateTarget({ action: 'click', descriptor })
    }, users[0])
    expect(outcome).not.toHaveProperty('error')
    await expect(page.locator('#selected-category').textContent()).resolves.toBe('Selected users')
  })

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
      if (request.url === '/frame') {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end('<!doctype html><html><body><label>Frame note <input aria-label="Frame note"></label></body></html>')
        return
      }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html><html><body>
        <label>Name <input aria-label="Name"></label>
        <form aria-label="Expense form">
          <label>Amount <input aria-label="Amount"></label>
          <label>Category <select aria-label="Category"><option>Office</option><option>Travel</option></select></label>
          <label>Department <select aria-label="Department"><option>Finance</option><option>Sales</option></select></label>
          <label><input type="checkbox" aria-label="Approved"> Approved</label>
          <label>Expense date <input type="date" aria-label="Expense date"></label>
          <label>Receipt <input type="file" aria-label="Receipt"></label>
          <label>Keyboard field <input aria-label="Keyboard field"></label>
          <div id="bulk-fields"></div>
        </form>
        <section role="region" aria-label="Invoice A"><button class="edit">Edit</button></section>
        <section role="region" aria-label="Invoice B"><button class="edit">Edit</button></section>
        <nav aria-label="Search categories">
          <div id="custom-user-tab" style="cursor: pointer"><span>用户</span></div>
        </nav>
        <span id="selected-category"></span>
        <iframe title="Expense details" src="/frame"></iframe>
        <div id="shadow-host"></div>
        <button id="increment">Increment once</button><span id="count">Count 0</span>
        <button id="hover-menu">Hover menu</button><span id="hover-state"></span>
        <button id="load-status">Load status</button><span id="delayed-status"></span>
        <button id="review">Go review</button>
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
          const shadow = document.querySelector('#shadow-host').attachShadow({ mode: 'open' })
          shadow.innerHTML = '<label>Shadow code <input aria-label="Shadow code"></label>'
          document.querySelector('#bulk-fields').innerHTML = Array.from({ length: 10 }, (_, index) =>
            '<label>Field ' + (index + 1) + '<input aria-label="Field ' + (index + 1) + '"></label>').join('')
          let count = 0
          document.querySelector('#increment').addEventListener('click', () => {
            count += 1
            document.querySelector('#count').textContent = 'Count ' + count
          })
          document.querySelector('#hover-menu').addEventListener('mouseover', () => {
            document.querySelector('#hover-state').textContent = 'Hover ready'
          })
          document.querySelector('input[aria-label="Keyboard field"]').addEventListener('keydown', event => {
            if (event.key === 'Enter') document.querySelector('#result').textContent = 'Pressed Enter'
          })
          document.querySelector('#load-status').addEventListener('click', () => {
            setTimeout(() => { document.querySelector('#delayed-status').textContent = 'Ready after load' }, 100)
          })
          document.querySelector('#review').addEventListener('click', () => history.pushState({}, '', '/review'))
          document.querySelector('#custom-user-tab').addEventListener('click', () => {
            document.querySelector('#selected-category').textContent = 'Selected users'
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
    const secrets = new Map<string, string>()
    ctx.provide('credentials', {
      resolve: async (ref: string) => secrets.has(ref) ? { value: secrets.get(ref) as string, source: 'memory' } : undefined,
      set: async (ref: string, value: string) => { secrets.set(ref, value) },
      unset: async (ref: string) => { secrets.delete(ref) },
    } as never)
    ctx.provide('connection', {
      rpc: { handle: () => () => Promise.resolve() },
    } as never)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService, { policy: 'never' })
    const fiber = await ctx.plugin(BrowserControl, {
      profileDir,
      ...existsSync(executable) ? { executablePath: executable } : {},
      headless: true,
      actionTimeoutMs: 5_000,
      navigationTimeoutMs: 10_000,
      maxTabs: 1,
      allowPrivateHosts: true,
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
      locator(selector: string): { evaluate<Result>(fn: (element: Element) => Result): Promise<Result> }
    }
    type TestContext = {
      pages(): TestPage[]
      newPage(): Promise<unknown>
      close(): Promise<void>
    }
    const browserContext = (): TestContext | undefined => (
      service as unknown as { managed: { runtime: { context?: TestContext } } }
    ).managed.runtime.context
    const firstInterrupted = new AbortController()
    const firstHanging = ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/hang`,
    }, firstInterrupted.signal)
    setTimeout(() => { firstInterrupted.abort(new Error('first navigation interruption')) }, 100)
    await expect(firstHanging).rejects.toThrow(/first navigation interruption/u)

    const firstOpened = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(firstOpened).not.toHaveProperty('browser')
    const openedContext = browserContext()
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
    let current = reused
    expect(current.text).toContain('Name')
    const workerDeadline = Date.now() + 5_000
    while (serviceWorkerRequests === 0 && Date.now() < workerDeadline) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(serviceWorkerRequests).toBeGreaterThan(0)
    const customUserTabs = current.targets?.filter(target => target.name === '用户') ?? []
    expect(customUserTabs).toHaveLength(1)
    expect(customUserTabs[0]).toMatchObject({ role: 'button', actions: ['click', 'hover'] })
    if (current.observationId === undefined || customUserTabs[0] === undefined) {
      throw new Error('custom text tab was not observed')
    }
    await ctx.xiaojingBrowserControl.run(owner, {
      action: 'click', observationId: current.observationId, targetId: customUserTabs[0].id,
    }, signal)
    current = await ctx.xiaojingBrowserControl.run(owner, { action: 'observe' }, signal)
    expect(current.text).toContain('Selected users')
    const input = current.targets?.find(target => target.name === 'Name')
    expect(input?.actions).toContain('fill')
    if (current.observationId === undefined || input === undefined) throw new Error('browser fixture input was not observed')
    await expect(ctx.xiaojingBrowserControl.run(otherOwner, {
      action: 'fill', observationId: current.observationId, targetId: input.id, value: 'Wrong owner',
    }, signal)).rejects.toThrow(/another session|no active Edge page/u)
    const openedPage = openedContext.pages()[0]
    if (openedPage === undefined) throw new Error('browser fixture did not retain its opened page')
    await openedPage.locator('input[aria-label="Name"]').evaluate((element) => { element.replaceWith(element.cloneNode(true)) })
    await expect(ctx.xiaojingBrowserControl.run(owner, {
      action: 'fill', observationId: current.observationId, targetId: input.id, value: 'Wrong row',
    }, signal)).resolves.toMatchObject({ action: 'fill' })
    const refreshed = await ctx.xiaojingBrowserControl.run(owner, { action: 'observe' }, signal)
    const refreshedInput = refreshed.targets?.find(target => target.name === 'Name')
    expect(refreshedInput?.value).toBe('Wrong row')
    if (refreshed.observationId === undefined || refreshedInput === undefined) {
      throw new Error('browser fixture replacement input was not observed')
    }
    await ctx.xiaojingBrowserControl.run(owner, {
      action: 'fill', observationId: refreshed.observationId, targetId: refreshedInput.id, value: 'Ada',
    }, signal)
    const filled = await ctx.xiaojingBrowserControl.run(owner, { action: 'observe' }, signal)
    expect(filled.targets?.find(target => target.name === 'Name')?.value).toBe('Ada')
    await expect(ctx.xiaojingBrowserControl.run(owner, {
      action: 'click', observationId: current.observationId, targetId: input.id,
    }, signal)).rejects.toThrow(/missing|expired|stale/u)
    const submit = filled.targets?.find(target => target.name === 'Submit')
    if (filled.observationId === undefined || submit === undefined) throw new Error('browser fixture submit was not observed')
    await expect(ctx.xiaojingBrowserControl.approvalReason(owner, {
      action: 'click', observationId: filled.observationId, targetId: submit.id,
    })).resolves.toMatch(/external-impact/u)
    await expect(ctx.xiaojingBrowserControl.run(owner, {
      action: 'click', observationId: filled.observationId, targetId: submit.id,
    }, signal)).rejects.toThrow(/approval path/u)
    const session = Session.create(owner)
    session.append('turn/start', { turn: 1 })
    const agent = { id: owner, session } as unknown as Agent
    const answered = vi.fn(() => Promise.resolve<'allowed-once'>('allowed-once'))
    ctx.on('approval/request', answered)
    const submitResult = await ctx.tools.execute({
      signal,
      callId: CallId('browser-submit'),
      name: 'browser_control',
      arguments: {
        action: 'act',
        observation_id: filled.observationId,
        steps: [
          { action: 'click', target_id: submit.id },
        ],
      },
      agent,
    })
    expect(submitResult.error?.message).toBeUndefined()
    expect(submitResult.isError).toBe(false)
    expect(answered).toHaveBeenCalledTimes(1)
    const submitted = await ctx.xiaojingBrowserControl.run(owner, { action: 'observe' }, signal)
    expect(submitted.text).toContain('Hello Ada')
    const destructive = submitted.targets?.find(target => target.name === 'Delete report')
    if (submitted.observationId === undefined || destructive === undefined) {
      throw new Error('browser fixture delete control was not observed')
    }
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
    expect(answered).toHaveBeenCalledTimes(2)
    expect((await ctx.xiaojingBrowserControl.run(owner, { action: 'tabs' }, signal)).tabs).toHaveLength(1)

    const complex = await ctx.xiaojingBrowserControl.run(owner, { action: 'observe' }, signal)
    const byName = (name: string) => complex.targets?.find(target => target.name === name)
    const amount = byName('Amount')
    const category = byName('Category')
    const approved = byName('Approved')
    const expenseDate = byName('Expense date')
    const receipt = byName('Receipt')
    const keyboardField = byName('Keyboard field')
    const frameNote = byName('Frame note')
    const shadowCode = byName('Shadow code')
    const increment = byName('Increment once')
    const hoverMenu = byName('Hover menu')
    const loadStatus = byName('Load status')
    const review = byName('Go review')
    const edits = complex.targets?.filter(target => target.name === 'Edit') ?? []
    expect(edits).toHaveLength(2)
    expect(new Set(edits.map(target => target.context)).size).toBe(2)
    if (complex.observationId === undefined || amount === undefined || category === undefined || approved === undefined
      || expenseDate === undefined || receipt === undefined || keyboardField === undefined || frameNote === undefined
      || shadowCode === undefined || increment === undefined || hoverMenu === undefined || loadStatus === undefined
      || review === undefined) {
      throw new Error('complex browser fixture targets were not observed')
    }
    const batched = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'act', observationId: complex.observationId,
      steps: [
        { action: 'fill', targetId: amount.id, value: '128.50' },
        { action: 'select', targetId: category.id, value: 'Travel' },
        { action: 'check', targetId: approved.id },
        { action: 'fill', targetId: expenseDate.id, value: '2026-08-24' },
        { action: 'fill', targetId: frameNote.id, value: 'Flight receipt' },
        { action: 'fill', targetId: shadowCode.id, value: 'A-001' },
        { action: 'hover', targetId: hoverMenu.id },
        { action: 'press', targetId: keyboardField.id, key: 'Enter' },
        { action: 'scroll', deltaY: 320 },
        { action: 'click', targetId: loadStatus.id },
        { action: 'wait_for', expectedText: 'Ready after load' },
        { action: 'click', targetId: increment.id },
        { action: 'click', targetId: review.id, expectedUrl: '/review' },
        { action: 'uncheck', targetId: approved.id },
        { action: 'click', target: { role: 'button', name: 'Missing action' } },
      ],
    }, signal)
    expect(batched).toMatchObject({ completedSteps: 14, failedStep: { index: 14, action: 'click' } })
    expect(batched.url).toContain('/review')
    expect(batched.text).toContain('Count 1')
    expect(batched.text).toContain('Hover ready')
    expect(batched.text).toContain('Pressed Enter')
    expect(batched.text).toContain('Ready after load')
    expect(batched.targets?.find(target => target.name === 'Amount')?.value).toBe('128.50')
    expect(batched.targets?.find(target => target.name === 'Category')?.value).toBe('Travel')
    expect(batched.targets?.find(target => target.name === 'Approved')?.checked).toBe(false)
    expect(batched.targets?.find(target => target.name === 'Expense date')?.value).toBe('2026-08-24')
    expect(batched.targets?.find(target => target.name === 'Frame note')?.value).toBe('Flight receipt')
    expect(batched.targets?.find(target => target.name === 'Shadow code')?.value).toBe('A-001')

    if (batched.observationId === undefined) throw new Error('batch result did not include a fresh observation')
    const currentReceipt = batched.targets?.find(target => target.name === 'Receipt')
    if (currentReceipt === undefined) throw new Error('receipt input was not observed after the batch')
    const receiptPath = join(profileDir, 'receipt.pdf')
    await writeFile(receiptPath, 'fixture receipt')
    const uploaded = await ctx.tools.execute({
      signal,
      callId: CallId('browser-upload'),
      name: 'browser_control',
      arguments: {
        action: 'upload',
        observation_id: batched.observationId,
        target_id: currentReceipt.id,
        paths: [receiptPath],
      },
      agent,
    })
    expect(uploaded.error?.message).toBeUndefined()
    expect(uploaded.isError).toBe(false)
    expect(answered).toHaveBeenCalledTimes(3)
    await expect(openedPage.locator('input[aria-label="Receipt"]').evaluate(element => (
      (element as HTMLInputElement).files?.[0]?.name
    ))).resolves.toBe('receipt.pdf')

    const afterUpload = await ctx.xiaojingBrowserControl.run(owner, { action: 'observe' }, signal)
    if (afterUpload.observationId === undefined) throw new Error('upload result did not produce a fresh observation')
    const bulkFields = Array.from({ length: 10 }, (_value, index) => {
      const name = `Field ${String(index + 1)}`
      const target = afterUpload.targets?.find(candidate => candidate.name === name)
      if (target === undefined) throw new Error(`${name} was not observed`)
      return target
    })
    const department = afterUpload.targets?.find(target => target.name === 'Department')
    const currentCategory = afterUpload.targets?.find(target => target.name === 'Category')
    if (department === undefined || currentCategory === undefined) throw new Error('bulk select targets were not observed')
    const bulkStarted = performance.now()
    const bulkResult = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'act', observationId: afterUpload.observationId,
      steps: [
        ...bulkFields.map((target, index) => ({ action: 'fill' as const, targetId: target.id, value: `V${String(index + 1)}` })),
        { action: 'select', targetId: currentCategory.id, value: 'Office' },
        { action: 'select', targetId: department.id, value: 'Sales' },
      ],
    }, signal)
    expect(bulkResult.completedSteps).toBe(12)
    expect(performance.now() - bulkStarted).toBeLessThan(5_000)

    const reusedPageId = bulkResult.pageId
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const samePage = await ctx.xiaojingBrowserControl.run(owner, {
        action: 'open', url: `http://127.0.0.1:${String(address.port)}/review`,
      }, signal)
      expect(samePage.pageId).toBe(reusedPageId)
    }
    expect(openedContext.pages()).toHaveLength(1)

    const separateWindow = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/separate`, disposition: 'new_window',
    }, signal)
    expect(separateWindow.pageId).not.toBe(reusedPageId)
    expect(separateWindow.windowId).not.toBe(bulkResult.windowId)
    expect(openedContext.pages()).toHaveLength(2)
    await ctx.xiaojingBrowserControl.run(owner, { action: 'close_tab' }, signal)
    expect(openedContext.pages()).toHaveLength(1)

    const ownerSession = Session.create(owner)
    const otherSession = Session.create(otherOwner)
    ctx.emit('session/event', ownerSession, { type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 2 } })
    const leased = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/review`,
    }, signal)
    ctx.emit('session/event', otherSession, { type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } })
    const isolated = await ctx.xiaojingBrowserControl.run(otherOwner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/review`,
    }, signal)
    expect(isolated.pageId).not.toBe(leased.pageId)
    expect(openedContext.pages()).toHaveLength(2)
    await ctx.xiaojingBrowserControl.run(otherOwner, { action: 'close_tab' }, signal)
    ctx.emit('session/event', otherSession, {
      type: 'turn/end', seq: 1, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } },
    })
    ctx.emit('session/event', ownerSession, {
      type: 'turn/end', seq: 1, time: Date.now(), data: { turn: 2, reason: { kind: 'completed' } },
    })
    expect(openedContext.pages()).toHaveLength(1)

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

    const currentContext = browserContext()
    if (currentContext === undefined) throw new Error('browser fixture did not retain its persistent context')
    await currentContext.close()
    const recoveredAfterExternalClose = await service.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(recoveredAfterExternalClose.text).toContain('Name')

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
