/** Historical Messages provider replay preserves its recorded identity and DeepSeek model group. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, selectedSessionFixture, watchConsole, webClientProfile, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const WINDOWS_XIAOJING = webClientProfile() === 'xiaojing' && process.platform === 'win32'
const LEGACY_XIAOJING_DIR = fileURLToPath(new URL('./expected/deepseek-messages-chat-xiaojing', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL(WINDOWS_XIAOJING
  ? '../../../snapshots/web/xiaojing-deepseek-messages-chat-033'
  : '../../../snapshots/web/deepseek-messages-chat', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, WINDOWS_XIAOJING ? 'session.v4.jsonl' : 'session.v3.jsonl')
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: DeepSeek Messages conversation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let replayFixture: string

  beforeAll(async () => {
    replayFixture = await selectedSessionFixture(FIXTURE, false)
    scaffold = await launchWebScaffold({
      compareReplaySession: true,
      replayFixture,
      paceMs: 5,
      replayProviders: [{
        id: 'deepseek-messages', name: 'DeepSeek',
        models: [{
          id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
          contextWindow: 1_000_000, defaultMaxTokens: 256_000,
          reasoningEfforts: ['off', 'low', 'high', 'max'], defaultReasoningEffort: 'high',
        }],
      }],
    })
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'deepseek-messages', model: 'deepseek-v4-flash' })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('replays the historical Messages provider while displaying DeepSeek in the model selector', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-deepseek-messages-chat'))
    const prompts = fixtureUserPrompts(await readFile(replayFixture, 'utf8'))
    expect(prompts).toHaveLength(1)
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'deepseek-messages', model: 'deepseek-v4-flash' })
    await page.getByRole('button', { name: /^选择模型/ }).click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByText('DeepSeek', { exact: true }).waitFor()
    await page.getByRole('button', { name: /^选择模型/ }).click()
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(prompts[0]!)
    await input.press('Enter')
    const sessionId = await settled
    const session = scaffold.ctx.sessions.get(sessionId)!
    expect(session.requestHeader()?.config.provider).toBe('deepseek-messages')
    await page.getByText('MESSAGES_WEB_READY', { exact: true }).waitFor()
    await compareOrRefreshGolden(join(WINDOWS_XIAOJING ? LEGACY_XIAOJING_DIR : SNAPSHOT_DIR, 'ui.expected.md'),
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), WINDOWS_XIAOJING ? 'replay' : MODE)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the recorded-session inventory closed', async () => {
    if (WINDOWS_XIAOJING) {
      await assertFixtureInventory(SNAPSHOT_DIR, ['session.v4.jsonl'])
      await assertFixtureInventory(LEGACY_XIAOJING_DIR, ['session.v4.jsonl', 'ui.expected.md'])
    } else {
      await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'ui.expected.md'])
    }
  })
})
