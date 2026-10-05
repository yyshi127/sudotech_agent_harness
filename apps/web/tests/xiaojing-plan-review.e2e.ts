/** Product plan approval preserves the pending decision and the approved document across reload. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterEach, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { acknowledgeReloadConnectionLoss, fixtureUserPrompts, launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

let scaffold: WebScaffold | undefined
let browser: Browser | undefined

afterEach(async () => {
  try { await browser?.close() } finally { await scaffold?.close() }
  browser = undefined
  scaffold = undefined
})

it('restores a pending plan without approving it, then persists the explicit approval and final plan', async () => {
  const fixture = fileURLToPath(new URL('../../../snapshots/web/plan-review/session.v3.jsonl', import.meta.url))
  const prompts = fixtureUserPrompts(await readFile(fixture, 'utf8'))
  expect(prompts).toHaveLength(1)
  scaffold = await launchWebScaffold({ replayFixture: fixture, compareReplaySession: false })
  const events: SessionEvent[] = []
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  const errors = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const settled = scaffold.whenTurnSettled()
  const input = page.locator('[data-composer-input]').first()
  await input.fill(`/plan ${prompts[0]!}`)
  await input.press('Enter')
  const card = page.locator('[data-plan-review-key]')
  const preview = page.locator('[data-plan-preview]')
  await card.waitFor()
  expect(await page.locator('[data-question-key]').count()).toBe(0)
  await preview.waitFor()
  expect(await preview.getByRole('heading', { level: 1 }).textContent()).toContain('--greeting')
  expect(await page.locator('[data-plan-card]').count()).toBe(0)
  const warnings = errors.warnings.length
  await page.reload()
  acknowledgeReloadConnectionLoss(errors, warnings)
  await card.waitFor()
  await card.getByRole('button', { name: 'Open plan in sidebar' }).click()
  await preview.waitFor()
  expect(events.filter(event => event.type === 'turn/end')).toHaveLength(0)
  await card.getByRole('button', { name: 'Approve', exact: true }).click()
  await settled
  expect(events.filter(event => event.type === 'plan/mode').map(event => event.data.active)).toEqual([true, false])
  expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
  await page.getByText('DONE', { exact: true }).waitFor()
  await card.waitFor({ state: 'detached' })
  const finalPlan = page.locator('[data-plan-card]')
  await finalPlan.waitFor()
  expect(await finalPlan.locator('xpath=ancestor::*[@data-turn-tail]').count()).toBe(1)
  const reloadWarnings = errors.warnings.length
  await page.reload()
  acknowledgeReloadConnectionLoss(errors, reloadWarnings)
  await finalPlan.waitFor()
  await finalPlan.click()
  await preview.waitFor()
  expect(await preview.getByRole('heading', { level: 1 }).textContent()).toContain('--greeting')
  expect(await card.count()).toBe(0)
  expect(errors.pageErrors).toEqual([])
  expect(errors.warnings).toEqual([])
})
