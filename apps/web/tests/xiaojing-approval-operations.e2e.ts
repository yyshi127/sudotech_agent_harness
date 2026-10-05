/** Actual product approval requesters through the shipped Web UI and durable Session audit. */
import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { installNativeBrowserGuard } from '../../../packages/xiaojing/xiaojing-browser-control/src/native-approval.ts'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold,
  readPersistedEvents, recordFixture, webClientProfile, webSnapshotMode,
} from './scaffold.ts'
import { XIAOJING_REPLAY_PROVIDERS } from './xiaojing-replay-catalog.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/xiaojing-approval-operations/session.v4.jsonl', import.meta.url))
const CATALOG = fileURLToPath(new URL('./fixtures/xiaojing-route-catalog/session.v4.jsonl', import.meta.url))
const STANDARD = fileURLToPath(new URL('../../../packages/bundle/web-app/presets/standard.patch.yml', import.meta.url))
const PREFIX = 'mcp__approval-owned-edge__'
const SCRIPT = PREFIX + 'browser_evaluate'
const FIRST = "Remove-Item 'first.txt' -Force"
const SECOND = "Remove-Item 'second.txt' -Force"

function call(ordinal: number, name: string, args: object): ReplayEntry {
  const id = ToolCallId(`approval-operation-${ordinal}`)
  const text = JSON.stringify(args)
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: text },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: text } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] }
}

function finish(): ReplayEntry {
  const text = '浏览器与命令审批测试已完成。'
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }
}

function fixtureTool(name: string, execute: ToolDefinition['execute']): ToolDefinition {
  return { name, description: 'Owned approval acceptance fixture; never evaluates arbitrary code.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, function: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] }, execute }
}

it.skipIf(webClientProfile() !== 'xiaojing')('reuses native script and shell approvals from the actual product requesters', async () => {
  const mode = webSnapshotMode()
  if (mode === 'record') throw new Error('This scenario owns an authored keyless recording')
  const root = await mkdtemp(join(tmpdir(), 'dsh-approval-operations-'))
  const authoring = mode === 'refresh' && !existsSync(FIXTURE)
  const row = loadOverlayPatches('approval operation fixture', STANDARD)
    .flatMap(patch => patch.insert ?? []).find(entry => entry.id === 'preset-standard')
  if (row === undefined) throw new Error('Missing standard preset')
  const preset = row.config as PresetDefinition
  const omitted = new Set(['tool-bash', 'tool-pwsh', 'tool-skill'])
  const overlay = join(root, 'preset.patch.yml')
  await writeFile(overlay, JSON.stringify([{ id: 'preset-standard', config: { ...preset,
    plugins: preset.plugins.map(plugin => omitted.has(plugin.id ?? '') ? { ...plugin, disabled: true } : plugin) } }]) + '\n')
  const override = join(root, 'authoring.json')
  if (authoring) await writeFile(override, JSON.stringify([
    call(1, SCRIPT, { function: '() => document.title' }),
    call(2, SCRIPT, { function: '() => location.href' }),
    call(3, 'pwsh', { command: FIRST }), call(4, 'pwsh', { command: FIRST }),
    call(5, 'pwsh', { command: SECOND }), finish(),
  ]))
  const scaffold = await launchWebScaffold({ replayFixture: authoring ? CATALOG : FIXTURE,
    replayProviders: XIAOJING_REPLAY_PROVIDERS, extraOverlayPath: overlay,
    ...authoring ? { replayOverride: override, compareReplaySession: false } : {},
  })
  const browser = await chromium.launch()
  const effects: string[] = []
  try {
    await writeFile(join(scaffold.workspaceCwd, 'first.txt'), 'FIRST')
    await writeFile(join(scaffold.workspaceCwd, 'second.txt'), 'SECOND')
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const handle = await scaffold.ctx.agents.create({ sessionId: SessionId('xiaojing-approval-operations'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash' },
      setup: async (agentCtx, agent) => {
        await scaffold.ctx.agentPresets.mount(agentCtx, 'standard')
        agentCtx.inject(['approval', 'tools'], (scope) => {
          installNativeBrowserGuard(scope, { prefix: PREFIX, browser: 'edge', surface: 'existing', owner: agent, allowPrivateHosts: true })
          scope.effect(() => scope.tools.register(fixtureTool(SCRIPT, async () => { effects.push('script'); return 'Owned browser result' })))
          scope.effect(() => scope.tools.register(fixtureTool('pwsh', async (args) => {
            if (typeof args !== 'object' || args === null || !('command' in args) || args.command !== FIRST && args.command !== SECOND) {
              throw new Error('Only fixed owned fixture files can be removed')
            }
            const file = args.command === FIRST ? 'first.txt' : 'second.txt'
            await rm(join(scaffold.workspaceCwd, file), { force: true })
            effects.push(file)
            return 'Owned file removed'
          })))
        })
      } })
    try {
      await workspace.attachSession(handle.agent.session.id)
      const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } })
      await page.addInitScript((id) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id })) }, handle.agent.session.id)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.waitForSelector('[data-composer-input]')
      const prompt = authoring ? '验证浏览器脚本和相同命令的始终允许，拒绝不同文件的删除。' : fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]
      if (prompt === undefined) throw new Error('Missing fixture prompt')
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      const panel = page.locator('[data-approval-key]')
      await panel.getByRole('button', { name: '始终允许', exact: true }).waitFor()
      await panel.getByText('执行浏览器脚本或坐标操作，可能读取或修改网页内容', { exact: true }).waitFor()
      expect(await panel.innerText()).toContain('整个浏览器的脚本执行')
      expect(effects).toEqual([])
      const golden = (name: string) => fileURLToPath(new URL(`./expected/xiaojing-approval-operations/${name}.expected.md`, import.meta.url))
      await mkdir(fileURLToPath(new URL('./expected/xiaojing-approval-operations', import.meta.url)), { recursive: true })
      await compareOrRefreshGolden(golden('script'), await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd), mode)
      const evidence = process.env.DSH_APPROVAL_EVIDENCE_DIR
      if (evidence !== undefined) await panel.screenshot({ path: join(evidence, 'browser-script-approval.png') })
      await panel.getByRole('button', { name: '始终允许', exact: true }).click()
      await panel.getByText(/删除操作需要二次确认/u).first().waitFor()
      expect(effects).toEqual(['script', 'script'])
      expect(await panel.innerText()).toContain('同一命令，工作目录')
      await compareOrRefreshGolden(golden('command'), await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd), mode)
      if (evidence !== undefined) await panel.screenshot({ path: join(evidence, 'shell-deletion-approval.png') })
      await panel.getByRole('button', { name: '始终允许', exact: true }).click()
      await panel.getByText(/删除操作需要二次确认.*second\.txt/u).first().waitFor()
      expect(effects).toEqual(['script', 'script', 'first.txt', 'first.txt'])
      await panel.getByRole('button', { name: '拒绝', exact: true }).click()
      await handle.agent.whenIdle()
      await scaffold.ctx.sessions.flush(handle.agent.session)
      expect(effects).toEqual(['script', 'script', 'first.txt', 'first.txt'])
      await expect(access(join(scaffold.workspaceCwd, 'first.txt'))).rejects.toThrow()
      expect(await readFile(join(scaffold.workspaceCwd, 'second.txt'), 'utf8')).toBe('SECOND')
      const events = await readPersistedEvents(scaffold, handle.agent.session.id)
      const decisions = events.flatMap(event => event.type === 'approval/decided' ? [event.data] : [])
      expect(decisions.map(decision => decision.outcome)).toEqual(['allowed-once', 'allowed-once', 'allowed-once', 'allowed-once', 'rejected'])
      expect(decisions.map(decision => decision.authorization?.kind)).toEqual(['session', 'reuse', 'session', 'reuse', undefined])
      expect(decisions[0]?.authorization?.category).toBe('xiaojing:browser:script')
      expect(decisions[2]?.authorization?.category).toBe('xiaojing:shell:delete:pwsh')
      if (authoring) await recordFixture(scaffold, handle.agent.session.id, FIXTURE)
      await page.close()
    } catch (error) {
      const evidence = process.env.DSH_APPROVAL_EVIDENCE_DIR
      if (evidence !== undefined) {
        await writeFile(join(evidence, 'operation-failure.txt'), String(error))
        await writeFile(join(evidence, 'operation-failure-events.json'), JSON.stringify(handle.agent.session.snapshotEvents(), null, 2))
      }
      throw error
    } finally { await handle.dispose() }
  } finally {
    await browser.close()
    try { await scaffold.close() } finally { await rm(root, { recursive: true, force: true }) }
  }
})
