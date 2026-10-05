// Session-header background jobs driven by a real `ctx.jobs` entry. No model
// call is involved.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JobId } from '@deepseek-ai/dsh-jobs'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webClientProfile, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/background-job-list', import.meta.url))
const XIAOJING = webClientProfile() === 'xiaojing'
const NATIVE = XIAOJING && process.platform === 'win32'
const EXPECTED_DIR = NATIVE ? fileURLToPath(new URL('./expected/background-job-list-xiaojing', import.meta.url)) : SNAPSHOT_DIR
const RUNNING_EXPECTED = join(EXPECTED_DIR, 'running.expected.md')
const SETTLED_EXPECTED = join(EXPECTED_DIR, 'settled.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'background-job-list-web-e2e'
// A hold on a barrier file the test owns in the job's cwd: the process never
// exits on its own, so no CI stall can settle it before the scenario kills it.
// The bounded loop only caps an orphan's lifetime if the runner dies before
// `afterAll` releases the barrier.
const RELEASE = '.background-job-list.release'
const TOOL = NATIVE ? 'pwsh' : 'bash'
const COMMAND = NATIVE
  ? `for ($attempt = 0; $attempt -lt 3000; $attempt++) { if (Test-Path -LiteralPath '${RELEASE}') { break }; Start-Sleep -Milliseconds 200 }`
  : `for _ in $(seq 1 3000); do [ -e ${RELEASE} ] && break; sleep 0.2; done`

/**
 * Wait for opening a session to publish its live Agent.
 * @param scaffold - the booted web scaffold.
 * @param sessionId - the opened session's identity.
 * @returns the registered Agent instance.
 */
async function liveAgent(scaffold: WebScaffold, sessionId: SessionId): Promise<Agent> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const found = scaffold.ctx.agents.get(sessionId)
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`opening session "${sessionId}" published no live Agent`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe.skipIf(MODE === 'record')('web e2e: background job list', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let agent: Agent

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    if (XIAOJING) {
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Background acceptance')
      await workspace.attachSession(SessionId(SEED_ID))
      const group = page.locator(`[data-row-key="workspace:${workspace.id}"][role="treeitem"]`)
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
      await page.locator(`[data-row-key="workspace:${workspace.id}"][aria-expanded="true"]`).waitFor()
      await page.locator(`[data-row-key="session:${SEED_ID}"][role="treeitem"]`).click()
    } else {
      const groupRow = page.locator('[role="treeitem"]').first()
      await groupRow.waitFor({ timeout: 15_000 })
      await groupRow.click()
      const sessionRow = page.locator('[role="treeitem"]').nth(1)
      await sessionRow.waitFor({ timeout: 10_000 })
      await sessionRow.click()
    }

    // Opening the session drives the Host's ordinary Agent resolution; the
    // job owner must be that exact live instance, never a second one.
    // `expect.poll` is test-scoped, so this hook polls by hand.
    agent = await liveAgent(scaffold, SessionId(SEED_ID))
  }, 120_000)

  afterAll(async () => {
    if (scaffold !== undefined) await writeFile(join(scaffold.workspaceCwd, RELEASE), '')
    await browser?.close()
    await scaffold?.close()
  })

  it('shows a running background job in the header without a refresh, then kills it from the two-press stop control', async () => {
    let phase = 'running'
    onTestFailed(() => saveFailureShot(page, `web-e2e-background-job-${phase}`))
    // Polling for zero would pass at t=0 before delivery and prove nothing.
    const trigger = page.getByRole('button', { name: '1 background job running' })
    expect(await trigger.count()).toBe(0)

    const started = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('background-job-list-e2e'),
      name: TOOL,
      arguments: { command: COMMAND, description: 'Hold a background slot open', run_in_background: true },
      agent,
    })
    const reported = started.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(started.isError, reported).toBe(false)
    const matched = new RegExp(`\\b${TOOL}-\\d+\\b`).exec(reported)
    if (matched === null) throw new Error(`background ${TOOL} reported no job id: ${reported}`)
    const jobId = JobId(matched[0])
    if (started.isError) throw new Error(reported)
    expect(started.value).toMatchObject({ kind: 'background', jobId })
    expect(scaffold.ctx.jobs.get(jobId, agent.id).status).toBe('running')

    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    const row = page.getByRole('list', { name: 'Background jobs' }).getByRole('listitem').first()
    await row.waitFor({ timeout: 10_000 })
    await expect.poll(() => row.textContent()).toContain(COMMAND)

    const running = await captureStableAria(page, '[class*="menu"]', scaffold.workspaceCwd, { runningJobs: 'keep' })
    await compareOrRefreshGolden(RUNNING_EXPECTED, running, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])

    phase = 'settled'
    // The whole human path: arm, confirm, job.kill, registry kill, jobs
    // frames flipping the row — no registry call from the test.
    const stop = page.locator('[data-kill-state]')
    await stop.waitFor({ timeout: 10_000 })
    await stop.click()
    await expect.poll(() => stop.getAttribute('data-kill-state')).toBe('armed')
    await stop.click()

    // Exact: the running trigger's name ('1 background job running') contains this label.
    const idle = page.getByRole('button', { name: '1 background job', exact: true })
    await idle.waitFor({ timeout: 20_000 })
    // The unclaimed report's reason lands in the settled row's detail.
    await expect.poll(
      () => page.getByRole('list', { name: 'Background jobs' }).textContent(),
      { timeout: 15_000 },
    ).toContain('cancelled by the user')
    expect(scaffold.ctx.jobs.get(jobId, agent.id).status).toBe('killed')

    const settled = await captureStableAria(page, '[class*="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SETTLED_EXPECTED, settled, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['running.expected.md', 'settled.expected.md'])
    if (NATIVE) await assertFixtureInventory(EXPECTED_DIR, ['running.expected.md', 'settled.expected.md'])
  })
})
