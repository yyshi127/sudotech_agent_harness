/** Recorded history stays in its product category through sidebar and New Session navigation. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webClientProfile, webSnapshotMode } from './scaffold.ts'
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
    const consultationBlankId = SessionId(await page.evaluate(() => {
      const value = JSON.parse(localStorage.getItem('dsh.sessions.current')!) as { sessionId: string }
      return value.sessionId
    }))
    for (let index = 0; index < 3; index++) {
      await tree.getByText('New Session', { exact: true }).click()
      await page.getByText('Xiaojing Accounting, Your AI Finance Assistant', { exact: true }).waitFor()
      expect(await page.evaluate(() => {
        const value = JSON.parse(localStorage.getItem('dsh.sessions.current')!) as { sessionId: string }
        return value.sessionId
      })).toBe(consultationBlankId)
      const agent = scaffold.ctx.agents.get(consultationBlankId)
      if (agent === undefined) throw new Error('Selected consultation Agent is missing')
      expect(scaffold.ctx.sessionProjections.stateOf(agent.session, 'agentPreset')).toBe('finance')
      expect(finance!.sessionIds).toContain(consultationBlankId)
      expect(await tree.getByText('Office history', { exact: true }).count()).toBe(0)
    }

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

it.skipIf(webClientProfile() !== 'xiaojing')('keeps a ledger blank session in Finance when reopened, revisited from Office, and reloaded', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({
    agentPresets: { definitions: [financePresetDefinition()], default: 'standard' },
  })
  let browser: Browser | undefined
  let failurePage: Awaited<ReturnType<typeof newEnglishPage>> | undefined
  try {
    const ledgerPath = join(scaffold.workspaceCwd, 'regression-ledger')
    await mkdir(ledgerPath)
    const created = await scaffold.ctx.xiaojingFinanceDomain.create({
      expectedRevision: 0, workspacePath: ledgerPath,
      client: {
        legalName: 'Ledger navigation regression company', shortName: 'Regression ledger',
        taxpayerType: 'general-vat', registeredRegion: 'Shanghai', accountingStandard: 'enterprise',
        chartMappings: [], externalSystemRefs: [],
      },
    })
    const ledger = await scaffold.ctx.workspaceRegistry.resolveByPath(ledgerPath)
    if (ledger === undefined) throw new Error('Regression ledger workspace is missing')
    const fixture = await readFile(SEED, 'utf8')
    const historyId = await seedSession({ ...scaffold, workspaceCwd: ledgerPath }, fixture, 'ledger-history', 'finance')
    await ledger.attachSession(historyId)
    await scaffold.ctx.sessionController.rename({ sessionId: historyId, title: 'Ledger history' })
    const officePath = join(scaffold.workspaceCwd, 'regression-office')
    await mkdir(officePath)
    const office = await scaffold.ctx.workspaceRegistry.create(officePath)
    await office.setTitle('Office regression')
    const officeId = await seedSession({ ...scaffold, workspaceCwd: officePath }, fixture, 'ledger-navigation-office', 'standard')
    await office.attachSession(officeId)
    await scaffold.ctx.sessionController.rename({ sessionId: officeId, title: 'Office history' })

    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    failurePage = page
    page.setDefaultTimeout(15_000)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'Finance Assistant', exact: true }).click()
    const tree = page.getByRole('tree', { name: 'Sessions' })
    const ledgerRow = tree.getByText('Regression ledger', { exact: true }).first()
      .locator('xpath=ancestor::*[@role="treeitem"][1]')
    await ledgerRow.hover()
    await page.getByRole('button', { name: 'New session in Regression ledger', exact: true }).click()
    const chooseLedger = page.getByRole('button', { name: 'Choose ledger', exact: true })
    await expect.poll(() => chooseLedger.textContent()).toBe('Regression ledger')
    const blankId = SessionId(await page.evaluate(() => {
      const value = JSON.parse(localStorage.getItem('dsh.sessions.current')!) as { sessionId: string }
      return value.sessionId
    }))
    const assertLedgerSelection = async (): Promise<void> => {
      await page.getByText('Xiaojing Accounting, Your AI Finance Assistant', { exact: true }).waitFor()
      await expect.poll(() => chooseLedger.textContent()).toBe('Regression ledger')
      expect(await page.evaluate(() => {
        const value = JSON.parse(localStorage.getItem('dsh.sessions.current')!) as { sessionId: string }
        return value.sessionId
      })).toBe(blankId)
      expect(ledger.sessionIds).toContain(blankId)
      const agent = scaffold.ctx.agents.get(blankId)
      if (agent === undefined) throw new Error('Selected ledger Agent is missing')
      expect(scaffold.ctx.sessionProjections.stateOf(agent.session, 'agentPreset')).toBe('finance')
      expect(await scaffold.ctx.xiaojingFinanceDomain.sessionContext(agent)).toMatchObject({
        state: 'ready', clientId: created.client.id,
      })
      expect(await tree.getByText('Ledger history', { exact: true }).isVisible()).toBe(true)
    }
    await assertLedgerSelection()
    for (let index = 0; index < 3; index++) {
      await tree.getByText('New Session', { exact: true }).click()
      await assertLedgerSelection()
    }

    await page.getByRole('button', { name: 'Office Companion', exact: true }).click()
    const officeRow = tree.getByText('Office regression', { exact: true })
      .locator('xpath=ancestor::*[@role="treeitem"][1]')
    if (await officeRow.getAttribute('aria-expanded') !== 'true') await officeRow.click()
    await tree.getByText('Office history', { exact: true }).click()
    await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click()
    await page.getByText('Xiaojing Accounting, Your AI Workmate', { exact: true }).waitFor()
    expect(await tree.getByText('Regression ledger', { exact: true }).count()).toBe(0)
    expect(await tree.getByText('Ledger history', { exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Finance Assistant', exact: true }).click()
    if (await ledgerRow.getAttribute('aria-expanded') !== 'true') await ledgerRow.click()
    await ledgerRow.hover()
    await page.getByRole('button', { name: 'New session in Regression ledger', exact: true }).click()
    await assertLedgerSelection()
    await page.reload({ waitUntil: 'load' })
    await assertLedgerSelection()
    expect(scaffold.ctx.workspaceRegistry.list().filter(workspace => workspace.sessionIds.includes(blankId))
      .map(workspace => workspace.id)).toEqual([ledger.id])
    expect(office.sessionIds).toContain(officeId)
    expect(ledger.sessionIds).not.toContain(officeId)
    const expectedDirectory = fileURLToPath(new URL('./snapshots/xiaojing-workspace-categories', import.meta.url))
    await mkdir(expectedDirectory, { recursive: true })
    await compareOrRefreshGolden(join(expectedDirectory, 'ledger-navigation.expected.md'),
      await captureStableAria(page, '[role="tree"][aria-label="Sessions"]', scaffold.workspaceCwd, { normalizeAge: true }),
      webSnapshotMode())
    expect(tripwire.pageErrors).toEqual([])
  } catch (error) {
    if (failurePage !== undefined && !failurePage.isClosed()) {
      console.error(`ledger navigation failure: ${await failurePage.locator('body').innerText()}`)
      await saveFailureShot(failurePage, 'web-e2e-xiaojing-ledger-navigation')
    }
    throw error
  } finally {
    await browser?.close()
    await scaffold.close()
  }
})
