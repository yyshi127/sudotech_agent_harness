/** Account and Session menus share material and keep macOS backings aligned and scoped. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Locator } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, openSettings } from './support.ts'

const XIAOJING = webClientProfile() === 'xiaojing'
const expected = fileURLToPath(new URL(
  XIAOJING ? './expected/menu-material-xiaojing' : './expected/menu-material', import.meta.url,
))
const seed = new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url)
const SEED_ID = 'menu-material-session'

async function material(menu: Locator) {
  return menu.evaluate((node) => {
    const style = getComputedStyle(node)
    const background = getComputedStyle(node.querySelector(':scope > [aria-hidden="true"]')!)
    return { fill: background.backgroundColor, blur: background.backdropFilter, radius: style.borderRadius, shadow: style.boxShadow }
  })
}

it('shares menu transparency and blur across palettes and follows native menu bounds', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  await seedSession(scaffold, await readFile(seed, 'utf8'), SEED_ID)
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
  const tripwire = watchConsole(page)
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'dshDesktop', { value: { protocolVersion: 1 } })
  })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const account = page.getByRole('button', { name: 'Account menu', exact: true })
  let trigger = account
  if (XIAOJING) {
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    expect(await account.count()).toBe(0)
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Menu acceptance')
    await workspace.attachSession(SessionId(SEED_ID))
    const group = page.locator(`[data-row-key="workspace:${workspace.id}"][role="treeitem"]`)
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    const row = page.locator(`[data-row-key="session:${SEED_ID}"][role="treeitem"]`)
    await row.waitFor()
    trigger = row.locator('button[aria-label^="Session actions for "]')
  } else {
    await account.waitFor()
  }

  const results: Record<string, Awaited<ReturnType<typeof material>>> = {}
  const masks: Record<string, { fill: string; blur: string }> = {}
  for (const platform of ['web', 'darwin']) {
    for (const dark of [false, true]) {
      await page.evaluate(({ platform, dark }) => {
        if (platform === 'darwin') document.documentElement.dataset.platform = platform
        else delete document.documentElement.dataset.platform
        document.body.toggleAttribute('data-ds-dark-theme', dark)
      }, { platform, dark })
      const overlayFill = await page.evaluate(() => {
        const overlay = document.createElement('div')
        overlay.style.background = 'var(--dsw-specific-menu)'
        document.body.appendChild(overlay)
        try { return getComputedStyle(overlay).backgroundColor } finally { overlay.remove() }
      })
      expect(overlayFill).toBe(platform === 'darwin'
        ? dark ? 'rgba(48, 49, 54, 0.94)' : 'rgba(248, 249, 250, 0.94)'
        : dark ? 'rgba(67, 69, 74, 0.45)' : 'rgba(248, 249, 250, 0.58)')
      if (XIAOJING) await trigger.locator('xpath=ancestor::*[@role="treeitem"][1]').hover()
      await trigger.click()
      const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: XIAOJING ? 'Rename' : 'Settings', exact: true }) })
      await menu.waitFor()
      const appearance = await material(menu)
      expect(appearance).toMatchObject({
        fill: dark ? 'rgba(67, 69, 74, 0.45)' : 'rgba(248, 249, 250, 0.58)',
        blur: 'blur(40px) saturate(1.5)',
      })
      const stroke = XIAOJING
        ? dark ? 'rgba(184, 232, 221, 0.22)' : 'rgba(18, 164, 137, 0.08)'
        : dark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.04)'
      expect(appearance.shadow).toContain(`${stroke} 0px 0px 0px 0.5px`)
      results[`${platform}-${dark ? 'dark' : 'light'}`] = appearance
      const backing = page.locator('[data-menu-backing]')
      if (platform === 'darwin') {
        await backing.waitFor({ state: 'visible' })
        for (const height of [950, 1000]) {
          await page.setViewportSize({ width: 1440, height })
          await expect.poll(async () => {
            const card = await menu.boundingBox()
            const base = await backing.boundingBox()
            return card !== null && base !== null
              && Math.abs(card.x - base.x) < 1 && Math.abs(card.y - base.y) < 1
              && Math.abs(card.width - base.width) < 1 && Math.abs(card.height - base.height) < 1
          }).toBe(true)
        }
        expect(await backing.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none')
      } else {
        expect(await backing.isVisible()).toBe(false)
      }
      await page.keyboard.press('Escape')
      await expect.poll(() => backing.count()).toBe(0)
      if (XIAOJING) await openSettings(page, 'en')
      else {
        await account.click()
        await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
      }
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await settings.waitFor()
      if (XIAOJING) expect(await settings.getByRole('button', { name: 'Account', exact: true }).count()).toBe(0)
      const mask = await settings.locator('..').locator(':scope > [aria-hidden="true"]').evaluate((node) => {
        const style = getComputedStyle(node)
        return { fill: style.backgroundColor, blur: style.backdropFilter }
      })
      expect(mask).toEqual({ fill: dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.24)', blur: 'none' })
      masks[`${platform}-${dark ? 'dark' : 'light'}`] = mask
      await page.keyboard.press('Escape')
      await settings.waitFor({ state: 'hidden' })
    }
  }
  await compareOrRefreshGolden(join(expected, 'materials.expected.json'), JSON.stringify(results, null, 2), webSnapshotMode())
  await compareOrRefreshGolden(join(expected, 'modal-masks.expected.json'), JSON.stringify(masks, null, 2), webSnapshotMode())

  if (!XIAOJING) {
    const ungrouped = page.getByText('Ungrouped', { exact: true })
    const group = ungrouped.locator('xpath=ancestor::*[@aria-expanded][1]')
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await ungrouped.click()
  }
  const action = XIAOJING ? trigger : page.locator('button[aria-label^="Session actions for "]').first()
  await action.locator('xpath=ancestor::*[@role="treeitem"][1]').hover()
  await action.click()
  const sessionMenu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Rename', exact: true }) })
  await sessionMenu.waitFor()
  expect(await material(sessionMenu)).toEqual(results['darwin-dark'])
  await compareOrRefreshGolden(join(expected, XIAOJING ? 'session-menu-033.expected.md' : 'session-menu.expected.md'),
    await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), webSnapshotMode())
  await page.keyboard.press('Escape')
  await expect.poll(() => page.locator('[data-menu-backing]').count()).toBe(0)
  if (XIAOJING) await assertFixtureInventory(expected, [
    'materials.expected.json', 'modal-masks.expected.json', 'session-menu.expected.md', 'session-menu-033.expected.md',
  ])
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
