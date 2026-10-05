/** Product queue admission, occurrence edits, stop preservation, and durable FIFO delivery. */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterEach, expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog, type ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

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

it('edits and removes queued occurrences, preserves them on stop and delivers each surviving message once', async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'xiaojing-queue-'))
  const readyFile = join(fixtureDirectory, 'ready')
  const overridePath = join(fixtureDirectory, 'replay.json')
  const fixture = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
  const recorded = deriveReplayScript(parseSessionLog(await readFile(fixture, 'utf8')))
  expect(recorded).toHaveLength(1)
  const replay: ReplayEntry[] = [{ kind: 'hang', readyFile }, recorded[0]!, recorded[0]!, recorded[0]!]
  await writeFile(overridePath, JSON.stringify(replay))
  const events: SessionEvent[] = []
  scaffold = await launchWebScaffold({ replayFixture: fixture, replayOverride: overridePath, compareReplaySession: false })
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  const errors = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const input = page.locator('[data-composer-input]').first()
  const submit = async (text: string) => {
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    await input.fill(text)
    await input.press('Enter')
  }
  const stopped = scaffold.whenTurnSettled()
  await submit('Active Windows queue acceptance')
  await expect.poll(() => existsSync(readyFile)).toBe(true)
  await submit('Remove this occurrence')
  await expect.poll(() => page.getByRole('button', { name: 'Remove queued message' }).count()).toBe(1)
  await submit('Edit this occurrence')
  const header = page.getByRole('button', { name: '2 queued messages', exact: true })
  await header.waitFor()
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click()
  const editRow = page.locator('[data-queue-dock] li', { hasText: 'Edit this occurrence' })
  await editRow.getByRole('button', { name: 'Edit queued message' }).click()
  await page.getByRole('textbox', { name: 'Edit queued message' }).fill('Edited\nWindows queue occurrence')
  const saved = page.waitForResponse('**/api/session/updateQueue')
  await page.getByRole('button', { name: 'Save queued message' }).click()
  expect((await saved).ok()).toBe(true)
  await page.getByText('Edited Windows queue occurrence', { exact: true }).waitFor()
  const removed = page.waitForResponse('**/api/session/updateQueue')
  await page.locator('[data-queue-dock] li', { hasText: 'Remove this occurrence' })
    .getByRole('button', { name: 'Remove queued message' }).click()
  expect((await removed).ok()).toBe(true)
  await expect.poll(() => page.getByText('Remove this occurrence', { exact: true }).count()).toBe(0)
  await submit('Preserve the tail')
  await expect.poll(() => page.getByRole('button', { name: 'Remove queued message' }).count()).toBe(2)
  await page.getByRole('button', { name: 'Stop generating' }).click()
  await stopped
  await expect.poll(() => page.getByRole('button', { name: 'Stop generating' }).count()).toBe(0)
  expect(await page.getByRole('button', { name: 'Remove queued message' }).count()).toBe(2)
  await submit('Wake the queue')
  await expect.poll(() => events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : []), { timeout: 15_000 })
    .toEqual(['aborted', 'completed', 'completed', 'completed'])
  const delivered = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
    ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []) : [])
  expect(delivered).toEqual(['Active Windows queue acceptance', 'Edited\nWindows queue occurrence', 'Preserve the tail', 'Wake the queue'])
  await expect.poll(() => page.locator('[data-queue-dock]').count()).toBe(0)
  await page.reload()
  for (const text of ['Edited\nWindows queue occurrence', 'Preserve the tail', 'Wake the queue']) {
    await page.locator('[data-chat-flow-kind="user"]').filter({ hasText: text }).waitFor()
  }
  expect(errors.pageErrors).toEqual([])
  expect(errors.warnings).toEqual([])
}, 90_000)
