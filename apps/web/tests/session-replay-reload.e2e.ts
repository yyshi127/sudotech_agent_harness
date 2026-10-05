/** Recorded-session recovery through Chromium and WebKit's native JSON validation. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureExpandedTurnProcessAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, selectedSessionFixture, watchConsole, webClientProfile, webSnapshotMode,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'
import { XIAOJING_REPLAY_PROVIDERS } from './xiaojing-replay-catalog.ts'

const XIAOJING = webClientProfile() === 'xiaojing'
const SNAPSHOT_DIR = fileURLToPath(new URL(
  XIAOJING ? '../../../snapshots/web/xiaojing-session-replay-reload' : '../../../snapshots/web/fresh-round-trip', import.meta.url,
))
const FIXTURE = join(SNAPSHOT_DIR, XIAOJING ? 'session.v4.jsonl' : 'session.v3.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui-expanded.expected.md')
const MODE = webSnapshotMode()

describe.skipIf(webSnapshotMode() === 'record')('web session replay', () => {
  it.each([{ name: 'Chromium', engine: chromium }, { name: 'WebKit', engine: webkit }])(
    '$name restores an active stream, a completed turn, and a reopened session', async ({ engine }) => {
      const scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: 'read-only',
        ...(XIAOJING ? { replayOverride: join(SNAPSHOT_DIR, 'replay.override.json'), replayProviders: XIAOJING_REPLAY_PROVIDERS } : {}),
      })
      onTestFinished(() => scaffold.close())
      const commands: Readonly<ToolExecutionResult>[] = []
      scaffold.ctx.on('tools/result', (exec, result) => { if (exec.name === 'pwsh') commands.push(result) })
      const release = Promise.withResolvers<undefined>()
      const reached = Promise.withResolvers<string>()
      let paused = false
      // Hold the recorded stream until the reloaded page has received its active baseline.
      const dispose = scaffold.ctx.on('llm/stream', async function* (_options, next) {
        for await (const chunk of next()) {
          yield chunk
          if (!paused && chunk.type === 'text-delta' && chunk.text.trim()) {
            paused = true
            reached.resolve(chunk.text.trim())
            await release.promise
          }
        }
      }, { prepend: true })
      onTestFinished(() => { release.resolve(undefined); dispose() })
      const browser = await engine.launch()
      onTestFinished(() => browser.close())
      const page = await newEnglishPage(browser)
      onTestFailed(() => saveFailureShot(page, `session-replay-reload-${engine.name()}`))
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl)
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      const prompts = fixtureUserPrompts(await readFile(await selectedSessionFixture(FIXTURE), 'utf8'))
      expect(prompts).toHaveLength(1)
      const input = page.locator('[data-composer-input][contenteditable="true"]').first()
      await input.fill(prompts[0]!)
      await input.press('Enter')
      const partial = await reached.promise
      const settled = scaffold.whenTurnSettled()
      try {
        const streaming = page.locator('[data-streaming="true"]').getByText(partial, { exact: true })
        await streaming.waitFor({ timeout: 15_000 })
        const warningStart = tripwire.warnings.length
        await page.reload()
        await streaming.waitFor({ timeout: 15_000 })
        acknowledgeReloadConnectionLoss(tripwire, warningStart)
        expect(tripwire.pageErrors).toEqual([])
      } finally {
        release.resolve(undefined)
        await settled
      }
      if (XIAOJING) {
        expect(commands).toHaveLength(1)
        const command = commands[0]!
        expect(command.isError).toBe(false)
        if (command.isError) throw new Error(command.error.message)
        expect(command.value).toMatchObject({ kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false,
          stdout: { text: 'WEB_E2E_OK\r\n', truncated: false }, stderr: { text: '', truncated: false },
        })
        if (MODE === 'refresh') await recordFixture(scaffold, await settled, FIXTURE)
      }
      await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
      const warningStart = tripwire.warnings.length
      await page.reload()
      await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
      acknowledgeReloadConnectionLoss(tripwire, warningStart)
      await compareOrRefreshGolden(UI_EXPECTED,
        await captureExpandedTurnProcessAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), XIAOJING ? MODE : 'replay')

      await page.getByRole('button', { name: 'New session', exact: true }).last().click()
      await page.getByText(XIAOJING ? 'Xiaojing Accounting, Your AI Workmate' : 'Into the Unknown', { exact: true }).waitFor()
      await page.getByRole('treeitem').filter({ has: page.getByText(XIAOJING ? 'Use the pwsh tool to' : 'Use the bash tool to', { exact: true }) }).click()
      await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
      await compareOrRefreshGolden(UI_EXPECTED,
        await captureExpandedTurnProcessAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), XIAOJING ? MODE : 'replay')
      if (XIAOJING) {
        await assertFixtureInventory(SNAPSHOT_DIR, ['session.v4.jsonl', 'replay.override.json', 'ui-expanded.expected.md'])
      }
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    },
  )
})
