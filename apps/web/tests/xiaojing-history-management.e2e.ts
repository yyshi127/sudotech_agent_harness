/** Product history navigation over read-only recorded content and real Workspace persistence. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

let scaffold: WebScaffold | undefined
let browser: Browser | undefined
afterAll(async () => {
  try { await browser?.close() } finally {
    await scaffold?.close()
    scaffold = undefined
    browser = undefined
  }
})

it('renames, searches, pins, archives, restores, reorders and exports Office history', async () => {
  scaffold = await launchWebScaffold({})
  const host = scaffold
  const workspace = await host.ctx.workspaceRegistry.create(host.workspaceCwd)
  await workspace.setTitle('History acceptance')
  const source = fileURLToPath(new URL('../../../snapshots/web/message-feedback-protocol/session.v3.jsonl', import.meta.url))
  const fixture = await readFile(source, 'utf8')
  const [headerLine, ...logLines] = fixture.trimEnd().split('\n')
  const header: unknown = JSON.parse(headerLine!)
  if (typeof header !== 'object' || header === null || !('createdAt' in header) || typeof header.createdAt !== 'number') {
    throw new Error('History fixture header needs a numeric creation time')
  }
  // Detached seed copies use distinct clocks; the committed source stays byte-identical.
  const rebasedFixture = `${JSON.stringify({ ...header, createdAt: 0 })}\n${logLines.join('\n')}\n`
  const now = Date.now()
  const titles = ['Acceptance Alpha', 'Acceptance Beta', 'Acceptance Gamma']
  const ids = []
  for (const [index, title] of titles.entries()) {
    const id = await seedSession(host, rebasedFixture, `xiaojing-history-${index}`, 'standard', { createdAt: now - (index + 1) * 60_000 })
    await workspace.attachSession(id)
    await host.ctx.sessionController.rename({ sessionId: id, title })
    ids.push(id)
  }
  browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  page.setDefaultTimeout(15_000)
  const tripwire = watchConsole(page)
  onTestFailed(async () => {
    console.error(await page.locator('body').innerText())
    await saveFailureShot(page, 'xiaojing-history-management')
  })
  await page.goto(host.authenticatedUrl)
  await page.getByRole('button', { name: 'Office Companion', exact: true }).click()
  const tree = page.getByRole('tree', { name: 'Sessions', exact: true })
  const group = tree.getByText(workspace.title, { exact: true })
    .locator('xpath=ancestor::*[@role="treeitem"][1]')
  await group.waitFor()
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  const row = (title: string) => tree.getByRole('treeitem').filter({
    has: page.locator('button[aria-label^="Session actions for "]'),
    hasText: title,
  })
  const action = async (title: string, name: string) => {
    const target = row(title)
    await target.hover()
    await target.getByRole('button', { name: `Session actions for ${title}`, exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  await expect.poll(async () => {
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    return await row(titles[0]!).isVisible()
  }, { timeout: 15_000 }).toBe(true)
  for (const title of titles) await row(title).waitFor()
  await row(titles[0]!).click()
  await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor()
  await page.getByText('Give one useful answer.', { exact: true }).waitFor()
  await action(titles[0]!, 'Rename')
  const rename = page.getByRole('dialog', { name: 'Rename session', exact: true })
  await rename.getByLabel('Session name').fill('Renamed Alpha')
  await rename.getByRole('button', { name: 'Rename', exact: true }).click()
  await row('Renamed Alpha').waitFor()
  expect(await row(titles[0]!).count()).toBe(0)

  await page.getByRole('button', { name: 'Search sessions', exact: true }).click()
  const search = page.getByPlaceholder('Search session names', { exact: true })
  await search.fill('Renamed Alpha')
  const results = page.getByRole('tree', { name: 'Search results', exact: true })
  await expect.poll(() => results.getByRole('treeitem').count()).toBe(1)
  expect(await results.innerText()).toContain('Renamed Alpha')
  await search.fill('No matching acceptance history')
  await expect.poll(() => results.getByRole('treeitem').count()).toBe(0)
  await search.fill('')
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await row(titles[1]!).waitFor()
  await action(titles[1]!, 'Pin session')
  await expect.poll(() => host.ctx.workspaceRegistry.pinnedSessionIds).toEqual([ids[1]])
  await page.getByRole('button', { name: 'View options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'In one list', exact: true }).click()
  await expect.poll(() => tree.getByRole('treeitem').first().innerText()).toContain(titles[1]!)

  const warningStart = tripwire.warnings.length
  await page.reload()
  acknowledgeReloadConnectionLoss(tripwire, warningStart)
  await row('Renamed Alpha').waitFor()
  await expect.poll(() => tree.getByRole('treeitem').first().innerText()).toContain(titles[1]!)
  await action(titles[1]!, 'Archive session')
  await expect.poll(() => row(titles[1]!).count()).toBe(0)
  expect(host.ctx.workspaceRegistry.archivedSessionIds).toContain(ids[1])
  expect(host.ctx.workspaceRegistry.pinnedSessionIds).not.toContain(ids[1])
  await page.getByRole('button', { name: 'View options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archived only', exact: true }).click()
  await row(titles[1]!).waitFor()
  expect(await row('Renamed Alpha').count()).toBe(0)
  await action(titles[1]!, 'Unarchive session')
  await expect.poll(() => host.ctx.workspaceRegistry.archivedSessionIds).toEqual([])
  await page.getByRole('button', { name: 'View options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Hide archived', exact: true }).click()
  await row(titles[1]!).waitFor()
  const restoreWarnings = tripwire.warnings.length
  await page.reload()
  acknowledgeReloadConnectionLoss(tripwire, restoreWarnings)
  for (const title of ['Renamed Alpha', ...titles.slice(1)]) await row(title).waitFor()
  const orderedTitles = ['Renamed Alpha', ...titles.slice(1)]
  const order = async () => (await tree.getByRole('treeitem').filter({
    has: page.locator('button[aria-label^="Session actions for "]'),
  }).allTextContents()).map(text => orderedTitles.find(title => text.includes(title)))
  const pickOrder = async (name: string) => {
    await page.getByRole('button', { name: 'View options', exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  await pickOrder('Last updated')
  await expect.poll(order).toEqual(orderedTitles)
  await pickOrder('Manual')
  await row(titles[2]!).dragTo(row('Renamed Alpha'), { targetPosition: { x: 30, y: 3 } })
  const manualTitles = [titles[2], 'Renamed Alpha', titles[1]]
  await expect.poll(order).toEqual(manualTitles)
  const manualWarnings = tripwire.warnings.length
  await page.reload()
  acknowledgeReloadConnectionLoss(tripwire, manualWarnings)
  await expect.poll(order).toEqual(manualTitles)
  await pickOrder('Last updated')
  await expect.poll(order).toEqual(orderedTitles)
  const recencyWarnings = tripwire.warnings.length
  await page.reload()
  acknowledgeReloadConnectionLoss(tripwire, recencyWarnings)
  await expect.poll(order).toEqual(orderedTitles)
  const response = await page.request.get(new URL(`/api/session.export?sessionId=${ids[0]!}`, host.authenticatedUrl).href)
  expect(response.status()).toBe(200)
  const exportedFiles = unzipSync(await response.body())
  expect(Object.keys(exportedFiles)).toHaveLength(1)
  const exported = strFromU8(Object.values(exportedFiles)[0]!)
  expect(exported).toContain(ids[0]!)
  expect(exported).toContain('Give one useful answer.')
  expect(exported).toContain('A useful answer.')
  expect((await host.ctx.sessionPersistence.list()).map(item => item.header.id)).toEqual(expect.arrayContaining(ids))
  expect(await readFile(source, 'utf8')).toBe(fixture)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
}, 120_000)
