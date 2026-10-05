/** Keyless acceptance for enabling, inheriting, and revoking office automatic approvals. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, readPersistedEvents, recordFixture, watchConsole, webClientProfile, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'
import { XIAOJING_REPLAY_PROVIDERS } from './xiaojing-replay-catalog.ts'

const SNAPSHOTS = fileURLToPath(new URL('./expected/xiaojing-no-approval', import.meta.url))

/** Hold one real turn open until acceptance teardown cancels it. */
class ApprovalFixtureAdapter extends LlmAdapter {
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: 'Waiting for owned approval acceptance.' }
    const signal = options.signal
    if (signal === undefined) throw new Error('approval fixture requires a turn signal')
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
  }
}

describe.skipIf(webClientProfile() !== 'xiaojing')('web e2e: Xiaojing No approvals', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let owner: AgentHandle
  let tripwire: ReturnType<typeof watchConsole>
  const abort = new AbortController()

  beforeAll(async () => {
    await mkdir(SNAPSHOTS, { recursive: true })
    scaffold = await launchWebScaffold({ agentPresets: { default: 'standard' } })
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['owned-approval'], new ApprovalFixtureAdapter()))
    const cwd = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(cwd)
    owner = await scaffold.ctx.agents.create({
      sessionId: SessionId('office-approval-owner'), meta: { cwd, agentPreset: 'standard' },
      agentOptions: { provider: 'owned-approval', model: 'owned' },
    })
    owner.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Owned automatic approval acceptance.' }], source: { kind: 'user' } }))
    const deadline = Date.now() + 10_000
    while (owner.agent.status !== 'running') {
      if (Date.now() >= deadline) throw new Error('owned approval turn did not start')
      await new Promise<void>(resolve => setTimeout(resolve, 10))
    }
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.waitForSelector('[class*="frame"]')
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(cwd)
    if (workspace === undefined) throw new Error('owned approval workspace missing')
    await workspace.attachSession(owner.agent.session.id)
    await page.getByRole('treeitem', { name: /Owned automatic approval acceptance/ }).click()
  }, 60_000)

  afterAll(async () => {
    abort.abort()
    owner?.agent.cancel({ kind: 'user' })
    await owner?.agent.whenIdle()
    await browser?.close()
    await owner?.dispose()
    await scaffold?.close()
  })

  it('continues a pending approval, approves repeated operations, then restores interactive decisions', async () => {
    try {
      const request = () => ({ agent: owner.agent, toolName: 'owned_upload_fixture', reason: 'Upload only owned acceptance data.', signal: abort.signal })
      const first = scaffold.ctx.approval.requestMandatory(request())
      const panel = page.locator('[data-approval-key]')
      await panel.waitFor()
      const mode = page.getByRole('button', { name: /^Access mode, current:/ }).first()
      await mode.click()
      await page.getByRole('menuitem', { name: 'Automatic approval (experimental)', exact: true }).click()
      const confirmation = page.getByRole('dialog')
      await confirmation.waitFor()
      expect(await confirmation.getByRole('button', { name: 'Enable automatic approval', exact: true }).isEnabled()).toBe(false)
      await compareOrRefreshGolden(join(SNAPSHOTS, 'confirmation.expected.md'), await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
      await confirmation.getByRole('checkbox').check()
      await confirmation.getByRole('button', { name: 'Enable automatic approval', exact: true }).click()
      expect(await first).toBe('allowed-once')
      await expect.poll(() => panel.count()).toBe(0)
      await expect.poll(() => scaffold.ctx.permissionPresets.current(owner.agent.session)).toBe('xiaojing-no-approval')
      for (let index = 0; index < 30; index += 1) {
        const result = index % 2 === 0
          ? await scaffold.ctx.approval.request(request())
          : await scaffold.ctx.approval.requestMandatory({ ...request(), toolName: 'owned_delete_fixture' })
        expect(result).toBe('allowed-once')
      }
      expect(await panel.count()).toBe(0)
      expect(scaffold.ctx.permissionPresets.catalog().defaultOptions.some(option => option.value === 'xiaojing-no-approval')).toBe(false)
      await mode.click()
      await page.getByRole('menuitem', { name: 'Workspace Write', exact: true }).click()
      await expect.poll(() => scaffold.ctx.permissionPresets.current(owner.agent.session)).toBe('workspace-write')
      const revoked = scaffold.ctx.approval.requestMandatory(request())
      await panel.waitFor()
      await panel.getByRole('button', { name: 'Reject', exact: true }).click()
      expect(await revoked).toBe('rejected')
      await expect.poll(() => panel.count()).toBe(0)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } catch (error) {
      await saveFailureShot(page, 'xiaojing-no-approval')
      throw error
    }
  })
})

it.skipIf(webClientProfile() !== 'xiaojing')('replays the logged office choice, automatic mandatory decisions, and model-visible authorization', async () => {
  const fixture = fileURLToPath(new URL('../../../snapshots/web/xiaojing-no-approval/session.v4.jsonl', import.meta.url))
  const catalog = fileURLToPath(new URL('./fixtures/xiaojing-route-catalog/session.v4.jsonl', import.meta.url))
  const authoring = webSnapshotMode() === 'refresh' && !existsSync(fixture)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-no-approval-recording-'))
  const override = join(directory, 'authoring.json')
  if (authoring) {
    const entries: ReplayEntry[] = ['delete', 'upload'].map((action, index) => {
      const id = ToolCallId(`automatic-operation-${index + 1}`)
      const name = 'owned_automatic_fixture'
      const args = JSON.stringify({ action })
      return { kind: 'chunks', chunks: [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ] }
    })
    const text = 'Owned deletion and upload approvals completed automatically.'
    entries.push({ kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] })
    await writeFile(override, JSON.stringify(entries))
  }
  const recorded = await launchWebScaffold({
    replayFixture: authoring ? catalog : fixture, replayProviders: XIAOJING_REPLAY_PROVIDERS,
    ...authoring ? { replayOverride: override, compareReplaySession: false } : {},
  })
  const effects: string[] = []
  const handle = await recorded.ctx.agents.create({
    sessionId: SessionId('office-auto-recorded'),
    meta: { cwd: recorded.workspaceCwd, agentPreset: 'standard' },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash' },
    setup: async (agentCtx, agent) => {
      await recorded.ctx.agentPresets.mount(agentCtx, 'standard')
      agentCtx.inject(['approval', 'tools'], (scope) => {
        scope.effect(() => scope.tools.register({
          name: 'owned_automatic_fixture', description: 'Requests approval for an owned fixture only; no external effects.',
          parameters: { type: 'object', properties: { action: { type: 'string', enum: ['delete', 'upload'] } }, required: ['action'] },
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
          execute: async (args) => {
            if (typeof args !== 'object' || args === null || !('action' in args)
              || args.action !== 'delete' && args.action !== 'upload') throw new Error('Unknown fixture action')
            const result = await scope.approval.requestMandatory({ agent, toolName: 'owned_automatic_fixture', reason: `Owned ${args.action} confirmation.` })
            if (result !== 'allowed-once') throw new Error(`Automatic approval failed: ${result}`)
            effects.push(args.action)
            return `Owned ${args.action} approved.`
          },
        }))
      })
    },
  })
  try {
    recorded.ctx.permissionPresets.set(handle.agent.session, 'xiaojing-no-approval')
    const prompt = authoring ? 'Complete the owned deletion and upload checks with automatic approvals.'
      : fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]
    if (prompt === undefined) throw new Error('Missing automatic approval prompt')
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    await recorded.ctx.sessions.flush(handle.agent.session)
    expect(effects).toEqual(['delete', 'upload'])
    const events = await readPersistedEvents(recorded, handle.agent.session.id)
    expect(events.flatMap(event => event.type === 'approval/decided' ? [event.data.outcome] : [])).toEqual(['allowed-once', 'allowed-once'])
    expect(events.some(event => event.type === 'user/message' && event.data.source.kind === 'runtime-context'
      && event.data.content.some(block => block.type === 'text' && block.text.includes('Ordinary and mandatory tool approvals are granted automatically')))).toBe(true)
    if (authoring) await recordFixture(recorded, handle.agent.session.id, fixture)
  } finally {
    await handle.dispose()
    await recorded.close()
    await rm(directory, { recursive: true, force: true })
  }
})
