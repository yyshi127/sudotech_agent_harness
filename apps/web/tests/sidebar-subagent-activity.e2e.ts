/** Delegated activity follows its idle owner independently of sidebar hover actions. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionId as SessionIdValue } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/sidebar-subagent-activity', import.meta.url))
const RUNNING_OWNER_EXPECTED = join(SNAPSHOT_DIR, 'owner-running.expected.md')
const WAITING_OWNER_EXPECTED = join(SNAPSHOT_DIR, 'owner-waiting.expected.md')
const SETTLED_OWNER_EXPECTED = join(SNAPSHOT_DIR, 'owner-settled.expected.md')
const MODE = webSnapshotMode()
const HOLD_PROVIDER = 'web-test-hold'
const HOLD_MODEL = 'hold'

/** Model stub that completes the owner turn, then holds its delegated child open. */
class StagedAdapter extends LlmAdapter {
  activeCalls = 0
  private calls = 0

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const call = this.calls++
    if (call !== 1) {
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const signal = options.signal
    if (signal === undefined) throw new Error('staged Web adapter requires a turn signal')
    this.activeCalls += 1
    try {
      await new Promise<never>((_resolve, reject) => {
        const abort = (): void => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('holding Web adapter aborted'))
        }
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      })
    } finally {
      this.activeCalls -= 1
    }
  }
}

async function waitForRunningChild(
  scaffold: WebScaffold,
  adapter: StagedAdapter,
  childId: SessionIdValue,
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (adapter.activeCalls !== 1 || scaffold.ctx.agents.get(childId)?.status !== 'running') {
    if (Date.now() >= deadline) throw new Error('held child did not enter its running model call')
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

describe('web e2e: sidebar subagent activity', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let parentHandle: AgentHandle
  let childId: SessionIdValue
  let adapter: StagedAdapter
  let tripwire: ReturnType<typeof watchConsole>
  const approvalAbort = new AbortController()

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    adapter = new StagedAdapter()
    scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter([HOLD_PROVIDER], adapter),
      'sidebar subagent activity staged adapter',
    )
    const cwd = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(cwd)
    parentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('sidebar-activity-owner'),
      meta: { cwd },
      agentOptions: { provider: HOLD_PROVIDER, model: HOLD_MODEL },
    })
    parentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Delegate a background job.' }],
      source: { kind: 'user' },
    }))
    await parentHandle.agent.whenIdle()
    const started = await scaffold.ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'sidebar activity child',
      signal: new AbortController().signal,
      request: {
        prompt: [{ type: 'text', text: 'Hold this delegated task open.' }],
        parent: parentHandle.agent,
      },
    })
    childId = started.childId
    await waitForRunningChild(scaffold, adapter, childId)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(cwd)
    if (workspace === undefined) throw new Error('connected Web workspace was not registered')
    await workspace.attachSession(parentHandle.agent.session.id)
  }, 60_000)

  afterAll(async () => {
    const failures: unknown[] = []
    approvalAbort.abort()
    const child = childId === undefined ? undefined : scaffold?.ctx.agents.get(childId)
    if (child !== undefined) {
      child.cancel({ kind: 'user' })
      await child.whenIdle().catch((error: unknown) => failures.push(error))
    }
    await browser?.close().catch((error: unknown) => failures.push(error))
    await parentHandle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'sidebar subagent activity teardown failed')
  })

  it('shows a delegated approval on its idle owner and clears activity when the child settles', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-subagent-activity'))
    const sidebar = page.getByRole('tree', { name: 'Sessions' })
    const ownerRow = sidebar.getByRole('treeitem', { name: /Delegate a background job/ })
    const captureActivity = async (hovered: boolean): Promise<string> => {
      if (hovered) await ownerRow.hover()
      else await page.mouse.move(0, 0)
      await expect.poll(() => ownerRow.getByRole('button').count()).toBe(hovered ? 3 : 0)
      return await captureStableAria(page, '[role="tree"][aria-label="Sessions"]', scaffold.workspaceCwd)
    }
    await ownerRow.waitFor({ timeout: 10_000 })
    expect(parentHandle.agent.status).toBe('idle')
    await compareOrRefreshGolden(
      RUNNING_OWNER_EXPECTED,
      await captureActivity(false),
      MODE,
    )
    expect(await ownerRow.locator('[data-state="ongoing"]').count()).toBe(1)
    await ownerRow.click()
    const runningTrigger = page.getByRole('button', { name: '1 subagent running' })
    await runningTrigger.waitFor({ timeout: 10_000 })
    expect(await runningTrigger.locator('[data-state="ongoing"]').count()).toBe(1)

    const child = scaffold.ctx.agents.get(childId)
    if (child === undefined) throw new Error('held child disappeared before its approval')
    const decision = scaffold.ctx.approval.requestMandatory({
      agent: child,
      toolName: 'sidebar_approval_fixture',
      reason: 'Decide the owned sidebar acceptance request.',
      signal: approvalAbort.signal,
    })
    await expect.poll(() => ownerRow.locator('[data-state="warning"]').count()).toBe(1)
    expect(await ownerRow.locator('[data-state="ongoing"]').count()).toBe(0)
    expect(parentHandle.agent.status).toBe('idle')
    await compareOrRefreshGolden(
      WAITING_OWNER_EXPECTED,
      await captureActivity(false),
      MODE,
    )
    const waiting = page.getByRole('button', { name: 'Child Waiting for approval: sidebar activity child' })
    await waiting.waitFor()
    await waiting.click()
    const panel = page.locator('[data-approval-key]')
    await panel.getByRole('button', { name: 'Reject', exact: true }).click()
    expect(await decision).toBe('rejected')
    await expect.poll(() => panel.count()).toBe(0)
    child.cancel({ kind: 'user' })
    await child.whenIdle()
    await parentHandle.agent.whenIdle()
    await ownerRow.click()
    await expect.poll(() => ownerRow.locator('[data-state="warning"], [data-state="ongoing"]').count()).toBe(0)
    expect(await waiting.count()).toBe(0)
    expect(await runningTrigger.count()).toBe(0)
    await compareOrRefreshGolden(
      SETTLED_OWNER_EXPECTED,
      await captureActivity(true),
      MODE,
    )
    await assertFixtureInventory(SNAPSHOT_DIR, ['owner-running.expected.md', 'owner-waiting.expected.md', 'owner-settled.expected.md'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
