// Keyless browser e2e: the shipped DeepSeek adapter stays mounted while its
// credential is absent, both ordered steps share the shipped modal chrome,
// and the inline key write lands in an isolated harness home without a reload
// or model call.
import { randomBytes } from 'node:crypto'
import { assertModelInputLayout } from './model-input-layout.ts'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webClientProfile, webSnapshotMode, type WebScaffold,
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_COPY, WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
} from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const XIAOJING = webClientProfile() === 'xiaojing'
const SNAPSHOT_DIR = fileURLToPath(new URL(XIAOJING
  ? './expected/onboarding-deepseek-config-xiaojing'
  : './expected/onboarding-deepseek-config', import.meta.url))
const WELCOME_EXPECTED = join(SNAPSHOT_DIR, 'welcome.expected.md')
const SIGN_IN_EXPECTED = join(SNAPSHOT_DIR, 'sign-in.expected.md')
const MISSING_EXPECTED = join(SNAPSHOT_DIR, 'missing.expected.md')
const MODELS_EXPECTED = join(SNAPSHOT_DIR, 'models.expected.md')
const DEFAULT_MODELS_EXPECTED = join(SNAPSHOT_DIR, 'default-models.expected.md')
const MODE = webSnapshotMode()
const WELCOME_TITLE = XIAOJING ? '初次使用说明' : WELCOME_NOTICE_COPY.zh.title
const WELCOME_CONTINUE = XIAOJING ? '开始使用' : WELCOME_NOTICE_COPY.zh.continueLabel
const XIAOJING_GUIDE_PARAGRAPHS = [
  '1. 获取 API Key：注册或登录 DeepSeek 开放平台，进入“API keys”页面，创建并复制 API Key。 打开 DeepSeek 开放平台',
  '2. 设置 API Key：打开左下角“设置”→“模型”，找到 DeepSeek 并点击“编辑”，将密钥粘贴到“API 密钥”，然后点击“保存”。',
  '3. 更换 API Key：回到同一位置，输入新的 API Key 并保存，原密钥会被替换。',
  '4. 安全提示：API Key 属于敏感信息，请勿通过聊天、截图或文件分享给他人。',
]

describe.skipIf(MODE === 'record')('web e2e: first-run DeepSeek credential setup', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const browserConsole: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true, welcomeNoticePending: true })
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    page.on('console', message => browserConsole.push(message.text()))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('stores a key write-only and observes configured state without restarting', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-deepseek-config'))
    const welcome = page.getByRole('dialog', { name: WELCOME_TITLE })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)
    if (XIAOJING) {
      expect(await page.locator('html').getAttribute('data-dsh-client-build-profile')).toBe('xiaojing')
      expect(await welcome.getByRole('paragraph').allTextContents()).toEqual(XIAOJING_GUIDE_PARAGRAPHS)
      expect(await welcome.getByRole('link', { name: '打开 DeepSeek 开放平台', exact: true }).getAttribute('href'))
        .toBe('https://platform.deepseek.com/')
      expect(await page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title, exact: true }).count()).toBe(0)
      expect(await page.getByRole('button', { name: '账号菜单', exact: true }).count()).toBe(0)
    } else {
      for (const paragraph of WELCOME_NOTICE_COPY.zh.body.split('\n\n')) {
        expect(await welcome.getByText(paragraph, { exact: true }).count()).toBe(1)
      }
    }
    expect(await welcome.getByRole('button').allTextContents()).toEqual([
      WELCOME_CONTINUE,
    ])
    const welcomeAria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(WELCOME_EXPECTED, welcomeAria, MODE)

    // Observation is not acknowledgement: the exact version is persisted
    // only by the explicit action, so a reload still presents this dialog.
    const firstReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, firstReloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })

    await welcome.getByRole('button', { name: WELCOME_CONTINUE }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })

    const signIn = page.getByRole('dialog', { name: '开始使用', exact: true })
    if (XIAOJING) {
      expect(await signIn.count()).toBe(0)
    } else {
      await signIn.waitFor({ timeout: 15_000 })
      await compareOrRefreshGolden(SIGN_IN_EXPECTED,
        await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)
      await signIn.getByRole('button', { name: '添加 API Key', exact: true }).click()
    }
    const credentialStep = page.getByRole('dialog', { name: '添加一个 API Key 开始使用' })
    await credentialStep.waitFor({ timeout: 15_000 })
    const keyInput = credentialStep.getByLabel('API 密钥', { exact: true })
    await keyInput.waitFor({ timeout: 10_000 })
    const initial = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MISSING_EXPECTED, initial, MODE)

    const secret = `dsh_onboarding_${randomBytes(12).toString('hex')}`
    await keyInput.fill(secret)
    await credentialStep.getByRole('button', { name: '保存并继续' }).click()
    await credentialStep.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)

    const stored = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(stored.includes(`DEEPSEEK_API_KEY: ${secret}`)).toBe(true)
    expect((await page.content()).includes(secret)).toBe(false)
    expect((await page.locator('body').ariaSnapshot()).includes(secret)).toBe(false)
    expect(browserConsole.some(line => line.includes(secret))).toBe(false)

    const acknowledgedSettings = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(acknowledgedSettings).toContain(`${WELCOME_NOTICE_ACK_FIELD}: ${WELCOME_NOTICE_VERSION}`)

    // The ordinary Models surface reuses the refreshed join and exposes the
    // configured write-only placeholder without a reload.
    await openSettings(page, 'zh')
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    const deepSeekRow = settings.getByText('DeepSeek', { exact: true }).first()
    await deepSeekRow.waitFor({ timeout: 10_000 })
    await deepSeekRow.locator('xpath=ancestor::li').getByRole('button', { name: '编辑' }).click()
    const configuredInput = settings.getByLabel('API 密钥', { exact: true })
    await configuredInput.waitFor({ timeout: 10_000 })
    await expect.poll(
      () => configuredInput.getAttribute('placeholder'),
      { timeout: 10_000 },
    ).toBe('留空使用已保存凭据')

    const secondReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, secondReloadWarnings)
    await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
    expect(await page.getByRole('dialog', { name: WELCOME_TITLE }).count()).toBe(0)
    expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)

    // An old acknowledgement means materially revised copy: welcome returns,
    // while the already-configured provider step remains complete.
    await scaffold.ctx.settings.mutate(WELCOME_NOTICE_SETTINGS_NAMESPACE, [{
      op: 'set', path: [WELCOME_NOTICE_ACK_FIELD], value: 'previous-copy-version',
    }])
    const thirdReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, thirdReloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })
    await welcome.getByRole('button', { name: WELCOME_CONTINUE }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)

    expect((await page.content()).includes(secret)).toBe(false)
    expect((await page.locator('body').ariaSnapshot()).includes(secret)).toBe(false)
    expect(browserConsole.some(line => line.includes(secret))).toBe(false)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('never paints the takeover chrome on a configured reload, even with the settings join held open', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-configured-reload'))
    // Regression pin for the reload flash: both steps are satisfied, yet each
    // must load private facts before deciding not to show. Dialog chrome lives
    // inside each visible branch, so the deciding window paints and blocks
    // nothing. Holding settings/describe widens that window from loopback
    // RTT scale to a deterministic hundreds of milliseconds, removing all
    // timing dependence from the sampler assertions below.
    //
    // The sampler init script persists across this shared page's later
    // navigations (init scripts re-run per navigation); that stays harmless
    // because no later scenario in this file legitimately shows the
    // takeover, and only this test reads __takeoverSightings.
    await page.addInitScript((welcomeTitle: string) => {
      const sightings: string[] = []
      ;(window as unknown as { __takeoverSightings: string[] }).__takeoverSightings = sightings
      setInterval(() => {
        if (document.querySelector(
          `[role="dialog"][aria-label="${welcomeTitle}"], `
          + '[role="dialog"][aria-label="开始使用"], '
          + '[role="dialog"][aria-label="添加一个 API Key 开始使用"]',
        ) !== null) {
          sightings.push('chrome')
        }
        if (document.getElementById('root')?.inert === true) sightings.push('inert')
      }, 8)
    }, WELCOME_TITLE)
    // EVERY settings/describe issued before the release is held — not just
    // the first — so the pin cannot silently collapse back to loopback
    // timing if a second boot-time consumer of the join ever appears.
    let released = false
    const heldRoutes: Array<() => void> = []
    const releaseDescribe = (): void => {
      released = true
      for (const resolve of heldRoutes.splice(0)) resolve()
    }
    await page.route('**/api/settings/describe', async (route) => {
      if (!released) await new Promise<void>((resolve) => { heldRoutes.push(resolve) })
      await route.continue()
    })
    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'commit' })
    await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
    // The app is painted and interactive while the steps are still deciding.
    await page.waitForTimeout(600)
    releaseDescribe()
    await page.waitForTimeout(400)
    await page.unroute('**/api/settings/describe')
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
    expect(await page.evaluate(() =>
      (window as unknown as { __takeoverSightings: string[] }).__takeoverSightings)).toEqual([])
    expect(await page.getByRole('dialog', { name: WELCOME_TITLE }).count()).toBe(0)
    expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('configures arbitrary DeepSeek models and prompts after the selected model is removed', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-deepseek-models'))
    // Opened here rather than inherited: the credential test reloads the page
    // after configuring the key, so nothing carries an open dialog across.
    await openSettings(page, 'zh')
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    const deepSeek = settings.getByText('DeepSeek', { exact: true }).first()
    await deepSeek.waitFor({ timeout: 10_000 })
    await deepSeek.locator('xpath=ancestor::li').getByRole('button', { name: '编辑' }).click()
    await settings.getByText('自定义设置').click()
    expect(await settings.getByLabel('模型 ID 1').inputValue()).toBe('deepseek-flash')
    expect(await settings.getByLabel('显示名称 1').inputValue()).toBe('DeepSeek-V4.1-Flash')
    expect(await settings.getByLabel('模型 ID 2').inputValue()).toBe('deepseek-v4-pro')
    expect(await settings.getByRole('button', { name: /删除模型/ }).count()).toBe(2)
    await settings.getByRole('button', { name: '模型选项 1' }).click()
    expect(await settings.getByRole('group', { name: '输入类型 1' }).getByRole('checkbox', { name: '图片' }).isChecked()).toBe(true)
    await assertModelInputLayout(page, settings)
    const defaultModels = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DEFAULT_MODELS_EXPECTED, defaultModels, MODE)
    await settings.getByLabel('显示名称 1').fill('Configured Flash')
    await settings.getByRole('group', { name: '输入类型 1' }).getByRole('checkbox', { name: '图片' }).uncheck()
    if (XIAOJING) {
      await settings.getByLabel('模型 ID 2').fill('configured-secondary')
      await settings.getByLabel('显示名称 2').fill('Configured Secondary')
      expect(await settings.getByRole('button', { name: /删除模型/ }).count()).toBe(2)
    }
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByLabel('模型 ID 1').waitFor({ state: 'detached', timeout: 15_000 })
    // The save notice settles the directory refresh before Edit clears it for the next draft.
    await settings.getByText('已保存 DeepSeek (deepseek-official)。', { exact: true }).waitFor({ timeout: 15_000 })
    const savedDefaults = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(savedDefaults).toContain('id: deepseek-flash')
    expect(savedDefaults).toContain('inputModalities:')
    expect(savedDefaults).toContain('- text')
    expect(savedDefaults).toContain('systemPromptUpdate: in-history')
    await expect(scaffold.ctx.llm.resolveModelInfo('deepseek-official', 'deepseek-flash')).resolves.toMatchObject({
      name: 'Configured Flash', inputModalities: ['text'], systemPromptUpdate: 'in-history',
    })
    if (XIAOJING) {
      expect(savedDefaults).toContain('id: configured-secondary')
      expect(savedDefaults).toContain('name: Configured Secondary')
      expect((await scaffold.ctx.llm.listModels('deepseek-official')).map(model => model.id))
        .toEqual(['deepseek-flash', 'configured-secondary'])
      await expect(scaffold.ctx.llm.resolveModelInfo('deepseek-official', 'configured-secondary')).resolves.toMatchObject({
        name: 'Configured Secondary', inputModalities: ['text'],
      })
      const reloadWarnings = tripwire.warnings.length
      await page.reload({ waitUntil: 'load' })
      acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
      await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
      expect(await page.getByRole('dialog', { name: WELCOME_TITLE }).count()).toBe(0)
      expect(await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).count()).toBe(0)
      expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)
      await openSettings(page, 'zh')
      await settings.waitFor({ timeout: 10_000 })
      await settings.getByRole('button', { name: '模型', exact: true }).click()
      await deepSeek.waitFor({ timeout: 10_000 })
    } else {
      await expect(scaffold.ctx.llm.resolveModelInfo('deepseek-official', 'deepseek-v4-pro')).resolves.toMatchObject({
        name: 'DeepSeek-V4-Pro', inputModalities: ['text'],
      })
    }
    await deepSeek.locator('xpath=ancestor::li').getByRole('button', { name: '编辑' }).click()
    await settings.getByText('自定义设置').click()
    if (XIAOJING) {
      expect(await settings.getByLabel('模型 ID 1').inputValue()).toBe('deepseek-flash')
      expect(await settings.getByLabel('显示名称 1').inputValue()).toBe('Configured Flash')
      expect(await settings.getByLabel('模型 ID 2').inputValue()).toBe('configured-secondary')
      expect(await settings.getByLabel('显示名称 2').inputValue()).toBe('Configured Secondary')
    }
    for (let index = 0; index < 2; index++) {
      await settings.getByRole('button', { name: /删除模型/ }).first().click()
    }
    await settings.getByRole('button', { name: '添加模型', exact: true }).click()
    const customModelId = settings.getByLabel('模型 ID 1')
    await customModelId.fill('private-preview')
    await settings.getByLabel('显示名称 1').fill('Private Preview')
    await settings.getByRole('button', { name: '模型选项 1' }).click()
    await settings.getByLabel('上下文窗口 1').fill('131072')
    await settings.getByLabel('最大输出 token 数 1').fill('64K')
    expect(await settings.getByRole('group', { name: '输入类型 1' }).getByRole('checkbox', { name: '图片' }).isChecked()).toBe(false)
    await settings.getByRole('group', { name: '输入类型 1' }).getByRole('checkbox', { name: '图片' }).check()

    await expect.poll(
      () => settings.getByLabel('API 密钥', { exact: true }).getAttribute('placeholder'),
      { timeout: 10_000 },
    ).toBe('留空使用已保存凭据')
    const modelEditor = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MODELS_EXPECTED, modelEditor, MODE)
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await customModelId.waitFor({ state: 'detached', timeout: 15_000 })
    await settings.getByText('已保存 DeepSeek (deepseek-official)。', { exact: true }).waitFor({ timeout: 15_000 })

    const document = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(document).toContain('id: private-preview')
    expect(document).toContain('name: Private Preview')
    expect(document).toContain('contextWindow: 131072')
    expect(document).toContain('maxTokens: 64000')
    expect(document).not.toContain('id: deepseek-flash')
    if (XIAOJING) {
      expect(document).not.toContain('id: configured-secondary')
      expect((await scaffold.ctx.llm.listModels('deepseek-official')).map(model => model.id)).toEqual(['private-preview'])
    }
    await expect(scaffold.ctx.llm.resolveModelInfo('deepseek-official', 'private-preview')).resolves.toMatchObject({
      inputModalities: ['text', 'image'],
    })
    await deepSeek.locator('xpath=ancestor::li').getByRole('button', { name: '编辑' }).click()
    await settings.getByText('自定义设置').click()
    await settings.getByRole('button', { name: '模型选项 1' }).click()
    expect(await settings.getByRole('group', { name: '输入类型 1' }).getByRole('checkbox', { name: '图片' }).isChecked()).toBe(true)
    await settings.getByRole('button', { name: '取消', exact: true }).click()

    await page.keyboard.press('Escape')
    // A connected Workspace is what puts a live composer — and its model
    // trigger — on the page; the scaffold boots without one.
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'model-fallback-e2e', false)

    const modelTrigger = page.getByRole('button', { name: '请选择模型', exact: true })
    await modelTrigger.waitFor({ timeout: 10_000 })
    await modelTrigger.click()
    expect(await page.getByText('Configured Flash', { exact: true }).count()).toBe(0)
    await page.getByRole('menuitemradio', { name: 'Private Preview' }).waitFor({ timeout: 10_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('shows an empty model list after removing the API key without replacing the saved default', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-model-catalog-empty'))
    await page.keyboard.press('Escape')
    const selection = scaffold.ctx.agentDefaultModel.currentSelection()
    await scaffold.ctx.credentials.unset(credentialRef('DEEPSEEK_API_KEY'))
    const seat = page.getByRole('button', { name: '请选择模型', exact: true })
    await seat.waitFor()
    await seat.click()
    const picker = page.getByRole('group', { name: '模型与推理等级' })
    await picker.getByText('暂无可用模型', { exact: true }).waitFor()
    expect(await picker.getByRole('menuitemradio').count()).toBe(0)
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual(selection)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'empty.expected.md'), await picker.ariaSnapshot(), MODE)
    await seat.press('Escape')
    await picker.waitFor({ state: 'hidden' })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(
      SNAPSHOT_DIR,
      ['welcome.expected.md', ...XIAOJING ? [] : ['sign-in.expected.md'], 'missing.expected.md', 'models.expected.md', 'default-models.expected.md', 'empty.expected.md'],
    )
  })
})
