/** Windows PTC dispatches through real PowerShell and retains code and subcall results after reload. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterEach, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, expandOwningTurnProcess, newEnglishPage } from './support.ts'

let scaffold: WebScaffold | undefined
let browser: Browser | undefined
let fixtureDirectory: string | undefined

afterEach(async () => {
  try { await browser?.close() } finally {
    try { await scaffold?.close() } finally {
      if (fixtureDirectory !== undefined) await rm(fixtureDirectory, { recursive: true, force: true })
      scaffold = undefined
      browser = undefined
      fixtureDirectory = undefined
    }
  }
})

it.skipIf(process.platform !== 'win32')('runs PowerShell and catches a failed read inside PTC, then restores nested output and source', async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'xiaojing-ptc-'))
  const override = join(fixtureDirectory, 'replay.json')
  const fixture = fileURLToPath(new URL('../../../snapshots/web/ptc-round/session.v3.jsonl', import.meta.url))
  const callId = ToolCallId('ptc-windows-acceptance')
  const code = `const shell = await tools.pwsh({ command: "Write-Output 'XIAOJING_PTC_OK'", description: 'Windows PTC output' });
let missing = false;
try { await tools.read({ file_path: 'missing.txt' }); } catch { missing = true; }
return { output: shell.stdout.text.trim(), missing };`
  const args = JSON.stringify({ description: 'Windows PTC acceptance', code })
  const entries: ReplayEntry[] = [
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: callId, name: 'run_code', argumentsDelta: args },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'run_code', arguments: args } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'XIAOJING_PTC_DONE' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'XIAOJING_PTC_DONE' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ]
  await writeFile(override, JSON.stringify(entries))
  scaffold = await launchWebScaffold({ agentPresets: { default: 'ptc' }, replayFixture: fixture, replayOverride: override, compareReplaySession: false })
  const events: SessionEvent[] = []
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  const errors = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const settled = scaffold.whenTurnSettled()
  const input = page.locator('[data-composer-input]').first()
  await input.fill('Run Windows PTC acceptance')
  await input.press('Enter')
  await settled
  const dispatches = events.filter(event => event.type === 'tool/ptc-dispatch')
  expect(dispatches.map(event => event.data.name)).toEqual(['pwsh', 'read'])
  expect(dispatches.map(event => event.data.isError)).toEqual([false, true])
  expect(JSON.stringify(dispatches[0]!.data.content)).toContain('XIAOJING_PTC_OK')
  for (const event of dispatches) expect(event.data.rootCallId).toBe(callId)
  const result = events.find(event => event.type === 'tool/result' && event.data.message.source.callId === callId)
  if (result?.type !== 'tool/result') throw new Error('PTC result was not logged')
  const outcome = result.data.message
  expect(outcome.isError).toBe(false)
  const output = outcome.content.find(block => block.type === 'text')
  if (output?.type !== 'text') throw new Error('PTC completion has no text result')
  expect(output.text).toContain(JSON.stringify({ output: 'XIAOJING_PTC_OK', missing: true }, null, 2))

  for (const reload of [false, true]) {
    if (reload) {
      const warnings = errors.warnings.length
      await page.reload()
      acknowledgeReloadConnectionLoss(errors, warnings)
    }
    await page.getByText('XIAOJING_PTC_DONE', { exact: true }).waitFor()
    const nested = page.locator('[data-subcalls]').first()
    await expandOwningTurnProcess(page, nested)
    const shell = nested.locator('[data-tool="pwsh"]').first()
    await shell.waitFor()
    expect(await shell.getAttribute('data-state')).toBe('ok')
    expect(await nested.locator('[data-state="error"]').count()).toBe(1)
    const disclosure = shell.locator('[data-disclosure-row]')
    if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click()
    await shell.locator('[data-terminal]').getByText('XIAOJING_PTC_OK', { exact: true }).waitFor()
  }
  await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
  await page.locator('tr[data-kind="tool"]').filter({ hasText: 'run_code' }).first().click()
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  expect(await page.locator('[data-line-numbers] pre').textContent()).toBe(code)
  expect(errors.pageErrors).toEqual([])
  expect(errors.warnings).toEqual([])
})
