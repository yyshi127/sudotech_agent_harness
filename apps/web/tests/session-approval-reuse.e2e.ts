/** Session authorization through the shipped Client, Host answerer, agent loop, and durable audit. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold,
  readPersistedEvents, recordFixture, webClientProfile, webSnapshotMode,
} from './scaffold.ts'
import { XIAOJING_REPLAY_PROVIDERS } from './xiaojing-replay-catalog.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/session-approval-reuse/session.v4.jsonl', import.meta.url))
const CATALOG = fileURLToPath(new URL('./fixtures/xiaojing-route-catalog/session.v4.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/session-approval-reuse/panel.expected.md', import.meta.url))
const STANDARD_PRESET = fileURLToPath(new URL('../../../packages/bundle/web-app/presets/standard.patch.yml', import.meta.url))
const TOOL = 'approval_fixture_read'

/** Exact readonly requests; the fixture producer assigns the reusable identity. */
function call(ordinal: number, range: 'first' | 'second'): ReplayEntry {
  const id = ToolCallId(`session-approval-${ordinal}`)
  const argumentsText = JSON.stringify({ range })
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: TOOL, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: TOOL, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] }
}

/** Final deterministic response after all actual approval outcomes. */
function answer(): ReplayEntry {
  const text = '审批测试已完成。'
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }
}

/** A second independent root Session must not consume the first Session's replay cursor. */
class NewSessionAdapter extends LlmAdapter {
  private calls = 0
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.calls++ === 0 ? call(5, 'first') : answer()
    if (entry.kind !== 'chunks') throw new Error('Expected authored chunks')
    yield* entry.chunks
  }
}

/** Omit unused platform catalogs while retaining the shipped preset and actual approval services. */
async function portablePreset(root: string): Promise<string> {
  const entry = loadOverlayPatches('session approval fixture', STANDARD_PRESET)
    .flatMap(patch => patch.insert ?? []).find(row => row.id === 'preset-standard')
  if (entry === undefined) throw new Error('Shipped standard preset is missing')
  const preset = entry.config as PresetDefinition
  const omitted = new Set(['tool-bash', 'tool-pwsh', 'tool-skill'])
  const plugins = preset.plugins.map(row => omitted.has(row.id ?? '') ? { ...row, disabled: true } : row)
  const path = join(root, 'preset.patch.yml')
  await writeFile(path, JSON.stringify([{ id: 'preset-standard', config: { ...preset, plugins } }]) + '\n')
  return path
}

/** Owned readonly fixture effect; rejected requests never reach the filesystem read. */
function readonlyTool(root: string, reads: string[], approval: ApprovalService): ToolDefinition {
  return {
    name: TOOL,
    description: 'Read one owned approval-test file after a mandatory human decision.',
    parameters: { type: 'object', properties: { range: { type: 'string', enum: ['first', 'second'] } }, required: ['range'], additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { range: { type: 'string' }, text: { type: 'string' }, outcome: { type: 'string' } },
        required: ['range', 'text', 'outcome'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (args === null || typeof args !== 'object' || !('range' in args)
        || (args.range !== 'first' && args.range !== 'second') || Object.keys(args).length !== 1) {
        throw new TypeError('Expected a known fixture range')
      }
      const agent = exec.agent
      if (agent === undefined) throw new Error('Approval fixture needs an actual agent')
      const range = args.range
      const label = range === 'first' ? '读取测试目录一' : '读取测试目录二'
      const outcome = await approval.requestMandatory({ agent, toolName: TOOL, callId: exec.callId,
        reason: `Read owned fixture range ${range}.`, displayReason: { en: `Read owned fixture range ${range}.`, zh: `申请${label}。` },
        reusable: { category: 'test:owned-file-read', scope: `fixture:${range}`, label: `Read fixture ${range}`,
          displayLabel: { en: `Read fixture ${range}`, zh: label } }, signal: exec.signal })
      if (outcome !== 'allowed-once') return { range, text: '', outcome }
      const text = await readFile(join(root, `${range}.txt`), { encoding: 'utf8', signal: exec.signal })
      reads.push(range)
      return { range, text, outcome }
    },
  }
}

/** Select an actual live Session through the Client's persisted selection. */
async function selectSession(page: Page, url: string, id: string): Promise<void> {
  await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, id)
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForSelector('[data-composer-input]', { timeout: 30_000 })
}

it.skipIf(webClientProfile() !== 'xiaojing')('reuses a UI-approved class only in the same target scope and Session', async () => {
  const mode = webSnapshotMode()
  if (mode === 'record') throw new Error('Session approval owns an authored keyless recording')
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-approval-'))
  const authoring = mode === 'refresh' && !existsSync(FIXTURE)
  const overlay = await portablePreset(root)
  const override = join(root, 'authoring.json')
  if (authoring) await writeFile(override, JSON.stringify([call(1, 'first'), call(2, 'first'), call(3, 'second'), call(4, 'second'), answer()]))
  const scaffold = await launchWebScaffold({ replayFixture: authoring ? CATALOG : FIXTURE,
    replayProviders: XIAOJING_REPLAY_PROVIDERS, extraOverlayPath: overlay,
    ...authoring ? { replayOverride: override, compareReplaySession: false } : {},
  })
  const browser = await chromium.launch()
  const reads: string[] = []
  try {
    const ctx = scaffold.ctx
    await writeFile(join(scaffold.workspaceCwd, 'first.txt'), 'FIRST')
    await writeFile(join(scaffold.workspaceCwd, 'second.txt'), 'SECOND')
    const workspace = await ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const create = async (id: string, provider: string, model: string) => {
      const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
        agentOptions: { provider, model }, setup: async (agentCtx) => {
          await ctx.agentPresets.mount(agentCtx, 'standard')
          agentCtx.inject(['approval'], (scope) => {
            scope.effect(() => scope.tools.register(readonlyTool(scaffold.workspaceCwd, reads, scope.approval)))
          })
        } })
      await workspace.attachSession(handle.agent.session.id)
      return handle
    }
    const first = await create('session-approval-reuse', 'deepseek-official', 'deepseek-flash')
    let activePage: Page | undefined
    try {
      const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } })
      activePage = page
      await selectSession(page, scaffold.authenticatedUrl, first.agent.session.id)
      const prompt = authoring ? '验证会话范围授权，读取测试目录一两次、目录二两次。' : fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]
      if (prompt === undefined) throw new Error('Missing primary fixture prompt')
      first.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      const panel = page.locator('[data-approval-key]')
      await panel.getByRole('button', { name: '始终允许' }).waitFor()
      expect(reads).toEqual([])
      expect(await panel.getByText('本会话适用范围：读取测试目录一', { exact: true }).count()).toBe(1)
      await mkdir(join(fileURLToPath(new URL('./expected', import.meta.url)), 'session-approval-reuse'), { recursive: true })
      await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd), mode)
      const evidence = process.env.DSH_APPROVAL_EVIDENCE_DIR
      if (evidence !== undefined) await page.screenshot({ path: join(evidence, 'session-approval-zh.png'), fullPage: true })
      await page.setViewportSize({ width: 480, height: 700 })
      const geometry = await panel.locator('button').evaluateAll(buttons => buttons.map((button) => {
        const r = button.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }))
      expect(geometry).toHaveLength(3)
      for (const r of geometry) {
        expect(r.left).toBeGreaterThanOrEqual(0)
        expect(r.right).toBeLessThanOrEqual(480)
        expect(r.top).toBeGreaterThanOrEqual(0)
        expect(r.bottom).toBeLessThanOrEqual(700)
      }
      if (evidence !== undefined) await page.screenshot({ path: join(evidence, 'session-approval-narrow.png'), fullPage: true })
      await page.setViewportSize({ width: 1280, height: 900 })
      await panel.getByRole('button', { name: '始终允许' }).click()
      await panel.getByText('本会话适用范围：读取测试目录二', { exact: true }).waitFor()
      expect(reads).toEqual(['first', 'first'])
      const previous = await panel.getAttribute('data-approval-key')
      await panel.getByRole('button', { name: '允许一次', exact: true }).click()
      await expect.poll(() => panel.getAttribute('data-approval-key')).not.toBe(previous)
      await panel.getByText('本会话适用范围：读取测试目录二', { exact: true }).waitFor()
      expect(reads).toEqual(['first', 'first', 'second'])
      await panel.getByRole('button', { name: '拒绝' }).click()
      await first.agent.whenIdle()
      await ctx.sessions.flush(first.agent.session)
      expect(reads).toEqual(['first', 'first', 'second'])
      const events = await readPersistedEvents(scaffold, first.agent.session.id)
      const decisions = events.flatMap(event => event.type === 'approval/decided' ? [event.data] : [])
      expect(decisions.map(decision => decision.outcome)).toEqual(['allowed-once', 'allowed-once', 'allowed-once', 'rejected'])
      expect(decisions.map(decision => decision.authorization?.kind)).toEqual(['session', 'reuse', undefined, undefined])
      expect(decisions.slice(0, 2).map(decision => decision.authorization)).toEqual([
        { category: 'test:owned-file-read', scope: 'fixture:first', label: 'Read fixture first', sessionId: first.agent.session.id, kind: 'session' },
        { category: 'test:owned-file-read', scope: 'fixture:first', label: 'Read fixture first', sessionId: first.agent.session.id, kind: 'reuse' },
      ])
      const context = events.flatMap(event => event.type === 'user/message'
        ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('\n')
      expect(context).toContain('A user-approved operation class and target scope may reuse authorization only within this session.')
      if (authoring) await recordFixture(scaffold, first.agent.session.id, FIXTURE)
      await page.close()

      const provider = 'session-approval-independent'
      ctx.effect(() => ctx.llm.registerAdapter([provider], new NewSessionAdapter()))
      const second = await create('session-approval-independent', provider, provider)
      try {
        const newPage = await browser.newPage({ locale: 'zh-CN' })
        await selectSession(newPage, scaffold.authenticatedUrl, second.agent.session.id)
        second.agent.followup(createUserMessage({ content: [{ type: 'text', text: '在独立会话读取测试目录一。' }], source: { kind: 'user' } }))
        const newPanel = newPage.locator('[data-approval-key]')
        await newPanel.getByRole('button', { name: '始终允许' }).waitFor()
        expect(reads).toEqual(['first', 'first', 'second'])
        await newPanel.getByRole('button', { name: '允许一次', exact: true }).click()
        await second.agent.whenIdle()
        await ctx.sessions.flush(second.agent.session)
        expect(reads).toEqual(['first', 'first', 'second', 'first'])
        const freshEvents = await readPersistedEvents(scaffold, second.agent.session.id)
        const freshDecisions = freshEvents.flatMap(event => event.type === 'approval/decided' ? [event.data] : [])
        expect(freshDecisions).toHaveLength(1)
        expect(freshDecisions[0]).toMatchObject({ outcome: 'allowed-once' })
        expect(freshDecisions[0]?.authorization).toBeUndefined()
        await newPage.close()
      } finally { await second.dispose() }
    } catch (error) {
      const evidence = process.env.DSH_APPROVAL_EVIDENCE_DIR
      if (evidence !== undefined) {
        await writeFile(join(evidence, 'failure-events.json'), JSON.stringify(first.agent.session.snapshotEvents(), null, 2))
        if (activePage !== undefined && !activePage.isClosed()) {
          await writeFile(join(evidence, 'failure-ui.txt'), await activePage.locator('body').innerText())
          await activePage.screenshot({ path: join(evidence, 'failure.png'), fullPage: true })
        }
      }
      throw error
    } finally { await first.dispose() }
  } finally {
    await browser.close()
    try { await scaffold.close() } finally { await rm(root, { recursive: true, force: true }) }
  }
})
