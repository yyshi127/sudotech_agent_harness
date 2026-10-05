// The Host's native-onboarding setting must reach the assembled browser before its dialogs register.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, WELCOME_NOTICE_COPY, type WebScaffold,
  webClientProfile,
} from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/onboarding-native', import.meta.url))
const SIGNED_OUT_MENU_EXPECTED = join(SNAPSHOT_DIR, 'signed-out-menu.expected.md')
const MODE = webSnapshotMode()
const XIAOJING = webClientProfile() === 'xiaojing'
const WELCOME_TITLE = XIAOJING ? '初次使用说明' : WELCOME_NOTICE_COPY.zh.title
const WELCOME_CONTINUE = XIAOJING ? '开始使用' : WELCOME_NOTICE_COPY.zh.continueLabel
const MODELS_EXPECTED = XIAOJING ? 'models.xiaojing.expected.md' : 'models.expected.md'

describe.skipIf(MODE === 'record').each([false, true])('web e2e: native credential onboarding (desktop marker: %s)', (desktop) => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      deepSeekMissingCredential: true,
      welcomeNoticePending: true,
      ...desktop ? {} : { extraOverlayPath: fileURLToPath(new URL('./fixtures/onboarding-native/cordis.patch.yml', import.meta.url)) },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    // The shared menu golden uses the Linux shortcut profile on every test host.
    await page.addInitScript(() => { Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64' }) })
    if (desktop) await page.addInitScript(() => { Object.defineProperty(globalThis, 'dshDesktop', { value: { protocolVersion: 1 } }) })
    tripwire = watchConsole(page)
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the notice and Models settings without another credential dialog or credential write', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-native'))
    const credentialPath = join(scaffold.harnessHome, '.credentials.yaml')
    const credentials = await readFile(credentialPath, 'utf8')
    if (XIAOJING) {
      expect(scaffold.ctx.llm.listConfigurableProviders().map(provider => provider.provider)).not.toContain('deepseek-account')
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const welcome = page.getByRole('dialog', { name: WELCOME_TITLE })
    if (!desktop || XIAOJING) {
      await welcome.waitFor()
      if (XIAOJING) {
        const aria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
        await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'welcome.xiaojing.expected.md'), aria, MODE)
      }
      await welcome.getByRole('button', { name: WELCOME_CONTINUE }).click()
      await welcome.waitFor({ state: 'detached' })
    }

    for (const reload of [false, true]) {
      if (reload) {
        const warningsBefore = tripwire.warnings.length
        await page.reload({ waitUntil: 'load' })
        acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
      }
      const accountMenu = page.getByRole('button', { name: '账号菜单', exact: true })
      if (desktop && !XIAOJING) {
        await accountMenu.waitFor()
        expect(await accountMenu.textContent()).toBe('更多')
        const triggerBox = (await accountMenu.boundingBox())!
        expect(Math.abs(triggerBox.height - 32)).toBeLessThan(1)
        await accountMenu.click()
        const menu = page.getByRole('menu')
        await menu.waitFor()
        expect(await menu.getByRole('menuitem').allTextContents()).toEqual(['设置', '意见反馈', '登录'])
        const menuBox = (await menu.boundingBox())!
        expect(Math.abs(menuBox.width - 124)).toBeLessThan(1)
        expect(Math.abs(menuBox.height - 128)).toBeLessThan(1)
        expect(Math.abs(triggerBox.y - (menuBox.y + menuBox.height) - 4)).toBeLessThan(1)
        for (const row of await menu.getByRole('menuitem').all()) {
          const rowBox = (await row.boundingBox())!
          expect(Math.abs(rowBox.height - 40)).toBeLessThan(1)
          expect(Math.abs(menuBox.width - rowBox.width - 8)).toBeLessThan(1)
          const glyph = (await row.locator('svg').first().boundingBox())!
          expect(Math.abs(glyph.width - 16)).toBeLessThan(1)
          expect(Math.abs(glyph.height - 16)).toBeLessThan(1)
        }
        const menuAria = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
        await compareOrRefreshGolden(SIGNED_OUT_MENU_EXPECTED, menuAria, MODE)
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'detached' })
      } else {
        await page.getByRole('button', { name: '设置', exact: true }).waitFor()
        expect(await accountMenu.count()).toBe(0)
        expect(await page.getByRole('dialog', { name: '开始你的创作' }).count()).toBe(0)
        expect(await page.getByRole('button', { name: '登录', exact: true }).count()).toBe(0)
      }
      await openSettings(page, 'zh')
      const settings = page.getByRole('dialog', { name: '设置', exact: true })
      await settings.getByRole('button', { name: '模型', exact: true }).click()
      await settings.getByLabel('API 密钥', { exact: true }).waitFor()
      if (XIAOJING) {
        expect(await settings.getByText('DeepSeek Account', { exact: true }).count()).toBe(0)
        expect(await settings.getByRole('button', { name: '账号', exact: true }).count()).toBe(0)
      }
      expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)
      expect(await welcome.count()).toBe(0)
      expect(await readFile(credentialPath, 'utf8')).toBe(credentials)
      const aria = XIAOJING
        ? await settings.getByRole('heading', { name: '模型', exact: true }).locator('..').ariaSnapshot()
        : await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, MODELS_EXPECTED), aria, MODE)
      await page.keyboard.press('Escape')
    }
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['models.expected.md', 'signed-out-menu.expected.md', 'models.xiaojing.expected.md', 'welcome.xiaojing.expected.md'])
  })

  it.skipIf(!XIAOJING || !desktop)('saves an API key through Models and keeps account login absent after reload', async () => {
    await openSettings(page, 'zh')
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    const key = 'sk-xiaojing-onboarding-keyless-fixture'
    await settings.getByLabel('API 密钥', { exact: true }).fill(key)
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByLabel('API 密钥', { exact: true }).waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
    await page.getByRole('button', { name: '设置', exact: true }).waitFor()
    expect(await page.getByRole('dialog', { name: WELCOME_TITLE }).count()).toBe(0)
    expect(await page.getByRole('button', { name: '账号菜单', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: '登录', exact: true }).count()).toBe(0)
    const credential = await scaffold.ctx.credentials.describe('DEEPSEEK_API_KEY' as CredentialRef)
    expect(credential.configured).toBe(true)
    expect(await page.locator('body').innerText()).not.toContain(key)
    expect(tripwire.pageErrors).toEqual([])
  })
})
