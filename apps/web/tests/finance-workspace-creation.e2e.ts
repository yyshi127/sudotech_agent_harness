/** Directory selection must reach customer details before creating a ledger's files. */
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterEach, expect, it, vi } from 'vitest'
import { launchWebScaffold, watchConsole, webClientProfile } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'
import { newEnglishPage } from './support.ts'

afterEach(() => { vi.unstubAllEnvs() })

it.skipIf(webClientProfile() !== 'xiaojing')('opens customer details after folder selection and provisions the saved ledger', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({
    agentPresets: {
      definitions: [financePresetDefinition()],
      default: 'standard',
    },
  })
  let browser: Browser | undefined
  try {
    const clientPath = join(scaffold.workspaceCwd, 'new-ledger')
    await mkdir(clientPath)
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    page.setDefaultTimeout(15_000)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'Finance Assistant', exact: true }).click()

    const chooseFolder = async () => {
      await page.getByRole('button', { name: 'Add ledger workspace', exact: true }).click()
      const picker = page.getByRole('dialog', { name: 'Select Workspace Directory' })
      await picker.getByRole('button', { name: 'Edit path', exact: true }).click()
      const pathInput = picker.getByRole('textbox', { name: 'Edit path', exact: true })
      await pathInput.fill(clientPath)
      await page.keyboard.press('Enter')
      await pathInput.waitFor({ state: 'detached' })
      await picker.getByRole('button', { name: 'Open', exact: true }).click()
      const details = page.getByRole('dialog', { name: 'New ledger', exact: true })
      await details.waitFor()
      return details
    }

    const canceled = await chooseFolder()
    await canceled.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    await canceled.waitFor({ state: 'hidden' })
    expect(await readdir(clientPath)).toEqual([])
    expect(await scaffold.ctx.workspaceRegistry.resolveByPath(clientPath)).toBeUndefined()

    const details = await chooseFolder()
    await details.getByLabel('Legal entity name', { exact: true }).fill('Ledger creation regression company')
    await details.getByLabel('Short name', { exact: true }).fill('Regression ledger')
    await details.getByRole('combobox', { name: /^Taxpayer type/ }).selectOption('general-vat')
    await details.getByRole('combobox', { name: /^Accounting standard/ }).selectOption('enterprise')
    await details.getByLabel('Registered region', { exact: true }).fill('Shanghai')
    await details.getByRole('button', { name: 'Save', exact: true }).click()
    await details.waitFor({ state: 'hidden' })
    await page.getByRole('tree', { name: 'Sessions' }).getByText('Regression ledger', { exact: true }).waitFor()
    expect((await readdir(clientPath)).filter(name => /^\d\d-/.test(name)).sort()).toEqual([
      '00-客户档案', '01-财务政策', '02-原始资料', '03-会话作业', '04-成果输出', '05-归档',
    ])
    const saved = await readFile(join(clientPath, '00-客户档案', '客户档案快照.json'), 'utf8')
    expect(saved).toContain('Ledger creation regression company')
    expect(saved).toContain('general-vat')
    expect((await scaffold.ctx.workspaceRegistry.resolveByPath(clientPath))?.title).toBe('Regression ledger')
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    await scaffold.close()
  }
})
