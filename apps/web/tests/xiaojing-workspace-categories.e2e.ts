/** Recorded history stays in its product category through sidebar and New Session navigation. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterEach, expect, it, vi } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, webClientProfile } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/message-feedback-protocol/session.v3.jsonl', import.meta.url))
afterEach(() => { vi.unstubAllEnvs() })

it.skipIf(webClientProfile() !== 'xiaojing')('keeps Finance history out of ordinary Ungrouped and creates sessions in the selected category', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({
    agentPresets: {
      definitions: [financePresetDefinition()],
      default: 'standard',
    },
  })
  let browser: Browser | undefined
  let failurePage: Awaited<ReturnType<typeof newEnglishPage>> | undefined
  try {
    const officePath = join(scaffold.workspaceCwd, 'office')
    await mkdir(officePath)
    const office = await scaffold.ctx.workspaceRegistry.create(officePath)
    await office.setTitle('Office project')
    const fixture = await readFile(SEED, 'utf8')
    const ordinaryId = await seedSession({ ...scaffold, workspaceCwd: office.path }, fixture, 'category-office', 'standard')
    await office.attachSession(ordinaryId)
    const ungroupedId = await seedSession(scaffold, fixture, 'category-ungrouped', 'standard')
    await scaffold.ctx.sessionController.rename({ sessionId: ordinaryId, title: 'Office history' })
    await scaffold.ctx.sessionController.rename({ sessionId: ungroupedId, title: 'Ungrouped history' })

    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    failurePage = page
    page.setDefaultTimeout(15_000)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByText('Xiaojing Accounting, Your AI Workmate', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Finance Assistant', exact: true }).click()
    await page.getByText('Xiaojing Accounting, Your AI Finance Assistant', { exact: true }).waitFor()
    const finance = scaffold.ctx.workspaceRegistry.list().find(workspace => workspace.id !== office.id)
    expect(finance).toBeDefined()
    const greetingId = await seedSession({ ...scaffold, workspaceCwd: finance!.path }, fixture, 'category-greeting', 'finance')
    await finance!.attachSession(greetingId)
    await scaffold.ctx.sessionController.rename({ sessionId: greetingId, title: 'Greeting' })
    await page.reload()
    await page.getByText('Xiaojing Accounting, Your AI Finance Assistant', { exact: true }).waitFor()

    const tree = page.getByRole('tree', { name: 'Sessions' })
    const newSession = page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' })
    const titles = ['Office history', 'Ungrouped history', 'Greeting']
    const visibleHistory = async () => {
      const visible = await Promise.all(titles.map(async title => ({
        title, visible: await tree.getByText(title, { exact: true }).isVisible(),
      })))
      return visible.filter(row => row.visible).map(row => row.title)
    }
    const expandGroup = async (title: string) => {
      const row = tree.getByText(title, { exact: true }).first().locator('xpath=ancestor::*[@role="treeitem"][1]')
      await row.waitFor()
      if (await row.getAttribute('aria-expanded') !== 'true') await row.click()
    }
    await page.getByRole('button', { name: 'Office Companion', exact: true }).click()
    await expandGroup('Office project')
    await expandGroup('Ungrouped')
    await expect.poll(visibleHistory).toEqual(['Office history', 'Ungrouped history'])
    await tree.getByText('Ungrouped history', { exact: true }).click()
    await newSession.click()
    await page.getByText('Xiaojing Accounting, Your AI Workmate', { exact: true }).waitFor()
    expect(await tree.getByText('Greeting', { exact: true }).count()).toBe(0)

    await page.getByRole('button', { name: 'Finance Assistant', exact: true }).click()
    await expandGroup(finance!.title)
    await expect.poll(visibleHistory).toEqual(['Greeting'])
    expect(await tree.getByText('Ungrouped', { exact: true }).count()).toBe(0)
    await tree.getByText('Greeting', { exact: true }).click()
    await newSession.click()
    await page.getByText('Xiaojing Accounting, Your AI Finance Assistant', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Office Companion', exact: true }).click()
    await newSession.click()
    await page.getByText('Xiaojing Accounting, Your AI Workmate', { exact: true }).waitFor()
    await expect.poll(visibleHistory).toEqual(['Office history', 'Ungrouped history'])
    expect(finance!.sessionIds).toContain(greetingId)
    expect(office.sessionIds).toContain(ordinaryId)
    expect(office.sessionIds).not.toContain(greetingId)
    expect(tripwire.pageErrors).toEqual([])
  } catch (error) {
    if (failurePage !== undefined && !failurePage.isClosed()) {
      console.error(`workspace categories failure: ${await failurePage.locator('body').innerText()}`)
      await saveFailureShot(failurePage, 'web-e2e-xiaojing-workspace-categories')
    }
    throw error
  } finally {
    await browser?.close()
    await scaffold.close()
  }
})
