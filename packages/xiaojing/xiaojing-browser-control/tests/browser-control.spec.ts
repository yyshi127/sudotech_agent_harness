import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { chromium } from 'playwright-core'
import BrowserControl, { isPrivateAddress, privateDestination } from '../src/index.ts'

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

  browserIt('observes and operates semantic targets while invalidating stale observations', async () => {
    let serviceWorkerRequests = 0
    const server = createServer((request, response) => {
      if (request.url === '/hang') return
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
        <a href="/popup" target="_blank">Open expense report</a>
        <p id="result"></p>
        <script>
          navigator.serviceWorker.register('/sw.js')
          document.querySelector('#submit').addEventListener('click', () => {
            document.querySelector('#result').textContent = 'Hello ' + document.querySelector('input').value
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
    const fiber = await ctx.plugin(BrowserControl, {
      profileDir,
      ...process.platform === 'win32' ? {} : { executablePath: executable },
      headless: true,
      actionTimeoutMs: 5_000,
      navigationTimeoutMs: 10_000,
      maxTabs: 1,
    })
    cleanup.push(() => fiber.dispose())

    const signal = new AbortController().signal
    const owner = SessionId('session-a')
    const otherOwner = SessionId('session-b')
    const firstInterrupted = new AbortController()
    const firstHanging = ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}/hang`,
    }, firstInterrupted.signal)
    setTimeout(() => { firstInterrupted.abort(new Error('first navigation interruption')) }, 100)
    await expect(firstHanging).rejects.toThrow(/first navigation interruption/u)

    const opened = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(opened.text).toContain('Name')
    const workerDeadline = Date.now() + 5_000
    while (serviceWorkerRequests === 0 && Date.now() < workerDeadline) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(serviceWorkerRequests).toBeGreaterThan(0)
    const input = opened.targets?.find(target => target.name === 'Name')
    expect(input?.actions).toContain('fill')
    if (opened.observationId === undefined || input === undefined) throw new Error('browser fixture input was not observed')
    await expect(ctx.xiaojingBrowserControl.run(otherOwner, {
      action: 'fill', observationId: opened.observationId, targetId: input.id, value: 'Wrong owner',
    }, signal)).rejects.toThrow(/another session/u)
    const filled = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'fill', observationId: opened.observationId, targetId: input.id, value: 'Ada',
    }, signal)
    expect(filled.targets?.find(target => target.name === 'Name')?.value).toBe('Ada')
    await expect(ctx.xiaojingBrowserControl.run(owner, {
      action: 'click', observationId: opened.observationId, targetId: input.id,
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
    const boundedTabs = await ctx.xiaojingBrowserControl.run(owner, { action: 'tabs' }, signal)
    expect({ count: boundedTabs.tabs?.length, truncated: boundedTabs.truncated }).toEqual({ count: 1, truncated: true })

    await ctx.xiaojingBrowserControl.close()
    const reopened = await ctx.xiaojingBrowserControl.run(owner, {
      action: 'open', url: `http://127.0.0.1:${String(address.port)}`,
    }, signal)
    expect(reopened.text).toContain('Name')
  }, 30_000)
})
