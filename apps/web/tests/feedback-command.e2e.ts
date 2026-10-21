// Keyless assembled-browser coverage for the /feedback command over the
// shipped Web bundles and the real host wire. The command plane settles
// without a model turn: the host appends the log-only command/run +
// feedback/record + command/done lifecycle, and the transcript renders the
// acknowledgement with the session and anonymous user ids as a persistent
// command row.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureExpandedTurnProcessAria, captureStableAria,
  compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webClientProfile, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'
import { XIAOJING_REPLAY_PROVIDERS } from './xiaojing-replay-catalog.ts'

const XIAOJING = webClientProfile() === 'xiaojing'
const LEGACY_XIAOJING_DIR = fileURLToPath(new URL('./expected/feedback-command-xiaojing', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL(XIAOJING
  ? '../../../snapshots/web/xiaojing-feedback-command-033'
  : '../../../snapshots/web/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, XIAOJING ? 'session.v4.jsonl' : 'session.v3.jsonl')
const ACK_EXPECTED = join(XIAOJING ? LEGACY_XIAOJING_DIR : SNAPSHOT_DIR, 'ack.expected.md')
const ACK_EXPANDED_EXPECTED = join(XIAOJING ? LEGACY_XIAOJING_DIR : SNAPSHOT_DIR, 'ack-expanded.expected.md')
const MODE = webSnapshotMode()

const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe('web e2e: /feedback command acknowledgement', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      compareReplaySession: true,
      ...XIAOJING ? { replayProviders: XIAOJING_REPLAY_PROVIDERS } : {},
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 5 }),
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Fresh world: connecting a workspace births the blank session whose
    // live composer accepts the slash line.
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('drives the recorded prompt to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-drive'))
    if (MODE !== 'record') {
      // Drift guard: the committed fixture must carry exactly the drive prompt.
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    // Arm the turn-boundary waiter BEFORE sending, so a burst replay cannot
    // miss the turn/end that settles the recorded turn.
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 60_000)

  it.skipIf(MODE === 'record')('records feedback and renders the acknowledgement with session and anonymous user ids', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-command'))
    // The drive test settled the recorded turn: the transcript is active (a
    // command row does not render while a fresh session is still blank) and
    // the replayed reply is on screen.
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    const input = page.locator('[data-composer-input]').first()
    await input.fill('/feedback the diff view is unreadable')
    await input.press('Enter')
    await page.getByText(/Feedback recorded for session/).waitFor({ timeout: 10_000 })
    expect(await page.getByText(/Anonymous user: [0-9a-f-]+\.$/i).count()).toBe(1)
    await page.getByRole('button', { name: '6% of context used', exact: true }).waitFor()
    await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
    await expect.poll(() => page.getByRole('button', { name: 'Add files or run commands' }).isEnabled(), { timeout: 10_000 }).toBe(true)
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ACK_EXPECTED, snapshot, XIAOJING ? 'replay' : MODE)
    const expanded = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(ACK_EXPANDED_EXPECTED, expanded, XIAOJING ? 'replay' : MODE)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    if (XIAOJING) {
      await assertFixtureInventory(SNAPSHOT_DIR, ['session.v4.jsonl'])
      await assertFixtureInventory(LEGACY_XIAOJING_DIR, ['session.v4.jsonl', 'ack.expected.md', 'ack-expanded.expected.md'])
    } else {
      await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'ack.expected.md', 'ack-expanded.expected.md'])
    }
  })
})
