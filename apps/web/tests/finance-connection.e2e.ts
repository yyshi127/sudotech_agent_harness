/** Real Xiaojing Host, generated Remote, and browser verification; only the vendor network is mocked. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Locator, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

async function verifyConnectionIcon(row: Locator, connected: boolean): Promise<void> {
  const button = row.getByRole('button', { name: /^(连接账套|重新连接账套|正在验证连接和账套) ·/ })
  const layout = await button.evaluate((element) => {
    const title = element.previousElementSibling
    const status = element.nextElementSibling
    const icon = element.querySelector('svg')
    if (title === null || status === null || icon === null) throw new Error('Connection icon or adjacent labels are missing')
    const rotation = new DOMMatrix(getComputedStyle(icon).transform)
    const box = element.getBoundingClientRect()
    return {
      title: title.textContent,
      nextRole: status.getAttribute('role'),
      afterTitle: box.left >= title.getBoundingClientRect().right,
      beforeStatus: box.right <= status.getBoundingClientRect().left,
      degrees: Math.round(Math.atan2(rotation.b, rotation.a) * 180 / Math.PI),
    }
  })
  expect(layout).toEqual({ title: '数豆科技', nextRole: 'status', afterTitle: true, beforeStatus: true, degrees: connected ? 45 : 0 })
  if (connected) {
    const brand = row.getByRole('status').locator('img[src="/youcheng-finance-logo.png"]')
    expect(await brand.count()).toBe(1)
    expect(await brand.evaluate((element) => {
      const box = element.parentElement?.getBoundingClientRect()
      return { width: box?.width, height: box?.height, overflow: getComputedStyle(element.parentElement!).overflow }
    })).toEqual({ width: 16, height: 16, overflow: 'hidden' })
    expect(await row.getByRole('status').locator('[data-state="done"]').count()).toBe(0)
    await button.hover()
    expect(await brand.count()).toBe(1)
  } else {
    expect(await row.locator('img[src="/youcheng-finance-logo.png"]').count()).toBe(0)
  }
}

async function verifyEditorLayout(page: Page, dialog: Locator): Promise<void> {
  const fields = dialog.getByRole('region', { name: '帐套信息内容' })
  const save = dialog.getByRole('button', { name: '保存', exact: true })
  const cancel = dialog.getByRole('button', { name: '取消', exact: true })
  const viewports = [
    { width: 1366, height: 768 },
    { width: 1024, height: 600 },
    { width: 390, height: 640 },
    { width: 640, height: 360 },
  ]
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    const environment = await dialog.getByRole('combobox', { name: 'API 环境', exact: true }).boundingBox()
    const address = await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).boundingBox()
    if (environment === null || address === null) throw new Error('API configuration fields are missing')
    if (viewport.width > 640) {
      expect(Math.abs(environment.y - address.y)).toBeLessThanOrEqual(1)
      expect(address.x).toBeGreaterThanOrEqual(environment.x + environment.width)
    } else {
      expect(address.y).toBeGreaterThanOrEqual(environment.y + environment.height)
    }
    for (const element of [dialog, save, cancel.first(), cancel.last()]) {
      const box = await element.boundingBox()
      if (box === null) throw new Error('Editor control is missing')
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    }
    const before = await save.boundingBox()
    const overflow = await fields.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      return { vertical: element.scrollHeight > element.clientHeight, horizontal: element.scrollWidth > element.clientWidth }
    })
    expect(overflow).toEqual({ vertical: true, horizontal: false })
    expect(await save.boundingBox()).toEqual(before)
    expect(await dialog.getByText('有成报销连接', { exact: true }).count()).toBe(0)
    expect(await dialog.getByLabel('报销 AppKey', { exact: true }).count()).toBe(0)
    expect(await dialog.getByLabel('报销 AppSecret', { exact: true }).count()).toBe(0)
    expect(await dialog.getByRole('button', { name: '保存报销配置', exact: true }).count()).toBe(0)
    expect(await dialog.getByRole('button', { name: '验证报销连接', exact: true }).count()).toBe(0)
    await dialog.getByRole('combobox', { name: '绑定账套', exact: true }).scrollIntoViewIfNeeded()
    const selection = await dialog.getByRole('combobox', { name: '绑定账套', exact: true }).boundingBox()
    const body = await fields.boundingBox()
    if (selection === null || body === null) throw new Error('Scrollable fields are missing')
    expect(selection.y).toBeGreaterThanOrEqual(body.y)
    expect(selection.y + selection.height).toBeLessThanOrEqual(body.y + body.height)
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await fields.evaluate((element) => { element.scrollTop = 0 })
  const artifactDirectory = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
  await mkdir(artifactDirectory, { recursive: true })
  await page.screenshot({ path: join(artifactDirectory, 'finance-client-editor-desktop.png') })
  await fields.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await page.screenshot({ path: join(artifactDirectory, 'finance-client-editor-accounts-desktop.png') })
  await page.setViewportSize({ width: 390, height: 640 })
  await fields.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await page.screenshot({ path: join(artifactDirectory, 'finance-client-editor-accounts-mobile.png') })
  await fields.evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: join(artifactDirectory, 'finance-client-editor-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 1100 })
}

it.skipIf(webClientProfile() !== 'xiaojing')('verifies one saved Youcheng ledger and renders success and mismatch through the real UI', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  vi.stubEnv('XIAOJING_FINANCE_WORKSPACE_ROOT', undefined)
  const agentPresets = {
    default: 'standard',
    definitions: [financePresetDefinition()],
  }
  const scaffold = await launchWebScaffold({ agentPresets })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  let vendorCalls = 0
  let accountAvailable = true
  let accessDenied = false
  let networkFailure = false
  let waitForVendor: Promise<void> | undefined
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
    if (networkFailure) throw new TypeError('Failed to fetch (internal)')
    await waitForVendor
    vendorCalls += 1
    if (accessDenied) return new Response('private vendor details', { status: 403 })
    expect(init?.method).toBe('POST')
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
    if (url.pathname === '/auth/getAccessToken.rjson') {
      expect(JSON.parse(init.body)).toEqual({ appKey: 'snapshot-app-key', appSecret: 'snapshot-app-secret' })
      return Response.json({ result: 100, data: 'snapshot-token' })
    }
    expect(url.pathname).toBe('/finance/auxiliary/queryAccountList.rjson')
    expect([{}, { setOfBooksId: '35581' }]).toContainEqual(JSON.parse(init.body))
    return Response.json({ result: 100, data: [
      { id: 'unrelated', sobName: '其他企业' }, ...accountAvailable ? [{ id: '35581', sobName: '数豆' }] : [],
    ] })
  }))
  try {
    const clientDirectory = join(scaffold.workspaceCwd, 'connection-client')
    await mkdir(clientDirectory)
    const created = await scaffold.ctx.xiaojingFinanceDomain.create({
      expectedRevision: 0, workspacePath: clientDirectory,
      client: { legalName: '数豆科技', shortName: '数豆科技', taxpayerType: 'general-vat', registeredRegion: '苏州', accountingStandard: 'small-enterprise', financePolicyNotes: '费用按部门归集。', chartMappings: [], externalSystemRefs: [] },
    })
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1100 } })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '财务助手', exact: true }).click()
    await page.getByText('账套', { exact: true }).first().waitFor()
    expect(await page.getByText('客户', { exact: true }).count()).toBe(0)
    await page.getByText('数豆科技', { exact: true }).first().waitFor()
    const openDetails = async (): Promise<void> => {
      const actions = page.getByRole('button', { name: '工作区“数豆科技”的操作' })
      await page.getByText('数豆科技', { exact: true }).first().hover()
      await actions.click()
      expect(await page.getByRole('menuitem').allTextContents()).toEqual(['帐套信息', '重命名', '移除工作区'])
      await page.getByRole('menuitem', { name: '帐套信息', exact: true }).click()
    }
    await openDetails()
    const dialog = page.getByRole('dialog', { name: '编辑帐套信息' })
    await dialog.waitFor()
    await dialog.getByRole('combobox', { name: '财务系统', exact: true }).selectOption('youcheng')
    expect(await dialog.getByLabel(/^API 地址/).inputValue()).toBe('https://cwdata.yiqiyun.com')
    expect(await dialog.getByLabel(/^API 地址/).getAttribute('readonly')).not.toBeNull()
    expect(await dialog.getByRole('textbox', { name: '账套 ID', exact: true }).count()).toBe(0)
    await dialog.getByLabel('AppKey', { exact: true }).fill('snapshot-app-key')
    await dialog.getByLabel('AppSecret', { exact: true }).fill('snapshot-app-secret')
    expect(await dialog.getByRole('button', { name: '保存', exact: true }).isDisabled()).toBe(true)
    await dialog.getByRole('button', { name: '验证并获取账套', exact: true }).click()
    await dialog.getByRole('option', { name: '数豆 · ID 35581', exact: true }).waitFor({ state: 'attached' })
    expect((await scaffold.ctx.xiaojingFinanceDomain.read(created.client.id)).client.financeSystem).toBeUndefined()
    expect(await dialog.getByRole('combobox', { name: '绑定账套', exact: true }).inputValue()).toBe('')
    await dialog.getByRole('combobox', { name: '绑定账套', exact: true }).selectOption('35581')
    expect(await dialog.getByRole('combobox', { name: '绑定账套', exact: true }).inputValue()).toBe('35581')
    expect(await dialog.getByRole('textbox', { name: '财务政策备注', exact: true }).count()).toBe(0)
    await dialog.locator('summary').click()
    expect(await dialog.getByLabel('财务政策备注', { exact: true }).inputValue()).toBe('费用按部门归集。')
    await verifyEditorLayout(page, dialog)
    await dialog.locator('summary').click()
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    const status = page.getByRole('status', { name: /最近一次鉴权和账套核验成功/ })
    await status.waitFor()
    expect(await status.textContent()).toContain('数豆')
    await verifyConnectionIcon(page.getByRole('treeitem').filter({ has: status }).first(), true)
    const source = await readFile(join(scaffold.harnessHome, 'finance', 'clients-v1.json'), 'utf8')
    expect(source).not.toMatch(/snapshot-app-secret|snapshot-token/)
    expect((await scaffold.ctx.xiaojingFinanceDomain.read(created.client.id)).client.financeSystem)
      .toMatchObject({ accountCode: '35581', environment: 'test' })
    expect((await scaffold.ctx.xiaojingFinanceDomain.read(created.client.id)).client.financePolicyNotes).toBe('费用按部门归集。')
    await openDetails()
    expect(await dialog.getByLabel('AppSecret', { exact: true }).inputValue()).toBe('')
    await dialog.getByRole('button', { name: '验证并获取账套', exact: true }).click()
    await dialog.getByRole('option', { name: '其他企业 · ID unrelated', exact: true }).waitFor({ state: 'attached' })
    await dialog.getByRole('combobox', { name: '绑定账套', exact: true }).selectOption('unrelated')
    await dialog.getByRole('button', { name: '取消', exact: true }).last().click()
    expect((await scaffold.ctx.xiaojingFinanceDomain.read(created.client.id)).client.financeSystem)
      .toMatchObject({ accountCode: '35581' })
    await openDetails()
    networkFailure = true
    await dialog.getByRole('button', { name: '验证并获取账套', exact: true }).click()
    const friendlyFailure = dialog.getByText('网络请求失败，请检查网络后重新验证', { exact: true })
    await friendlyFailure.waitFor()
    expect(await friendlyFailure.isVisible()).toBe(true)
    expect(await dialog.getByText(/Failed to fetch|internal/u).count()).toBe(0)
    networkFailure = false
    await dialog.getByRole('button', { name: '验证并获取账套', exact: true }).click()
    await dialog.getByRole('option', { name: '数豆 · ID 35581', exact: true }).waitFor({ state: 'attached' })
    await dialog.getByRole('combobox', { name: '绑定账套', exact: true }).selectOption('35581')
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-connection/editor.expected.md', import.meta.url)), snapshot, webSnapshotMode())
    accountAvailable = false
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    const failed = page.getByRole('status', { name: /未能唯一匹配此账套 ID/ })
    await failed.waitFor()
    expect(await failed.locator('[data-state="error"]').count()).toBe(1)
    expect(await page.getByRole('status', { name: /核验成功/ }).count()).toBe(0)
    expect(vendorCalls).toBe(10)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    expect(await page.getByRole('button', { name: '客户管理', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: '客户帐套管理', exact: true }).count()).toBe(0)

    // Dispose the Host but retain its owned files until the restarted Host finishes.
    await scaffold.ctx.fiber.dispose()
    const restarted = await launchWebScaffold({ harnessHome: scaffold.harnessHome, agentPresets })
    try {
      await page.goto(restarted.authenticatedUrl)
      await page.getByRole('button', { name: '财务助手', exact: true }).click()
      const idle = page.getByRole('status', { name: /尚未验证；可点击名称旁的连接图标核验账套/ })
      await idle.waitFor()
      expect(await idle.textContent()).toBe('数豆')
      expect(vendorCalls).toBe(10)
      const saved = await readFile(join(restarted.harnessHome, 'finance', 'clients-v1.json'), 'utf8')
      const row = page.getByRole('treeitem').filter({ has: page.getByRole('button', { name: /^连接账套 · 数豆科技 · ID 35581$/ }) }).first()
      await verifyConnectionIcon(row, false)
      const expanded = await row.getAttribute('aria-expanded')
      const takeRowSnapshot = async (): Promise<string> =>
        (await row.ariaSnapshot()).replace(/ · ID 35581 · \d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}/gu, ' · ID 35581 · <checked-at>')
      const stages = [`## Unverified\n\n${await takeRowSnapshot()}`]

      const pending = Promise.withResolvers<undefined>()
      waitForVendor = pending.promise
      try {
        await row.getByRole('button', { name: /^连接账套/ }).click()
        const checking = page.getByRole('button', { name: /^正在验证连接和账套 · 数豆科技/ })
        await checking.waitFor()
        expect(await checking.isDisabled()).toBe(true)
        await verifyConnectionIcon(page.getByRole('treeitem').filter({ has: checking }).first(), false)
        stages.push(`## Checking\n\n${await page.getByRole('treeitem').filter({ has: checking }).first().ariaSnapshot()}`)
      } finally {
        waitForVendor = undefined
        pending.resolve(undefined)
      }
      await expect.poll(() => vendorCalls).toBe(12)
      await expect.poll(async () => (await restarted.ctx.xiaojingFinanceDomain.workspaces()).clients[0]?.connection?.state).toBe('failed')
      await expect.poll(() => page.getByRole('status').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))))
        .toContainEqual(expect.stringMatching(/未能唯一匹配此账套 ID/))
      expect(vendorCalls).toBe(12)
      expect(await row.getAttribute('aria-expanded')).toBe(expanded)
      await verifyConnectionIcon(row, false)
      stages.push(`## Failed\n\n${await takeRowSnapshot()}`)

      accountAvailable = true
      await row.getByRole('button', { name: /^连接账套/ }).focus()
      await page.keyboard.press('Enter')
      await status.waitFor()
      const connectedRow = page.getByRole('treeitem').filter({ has: page.getByRole('button', { name: /^重新连接账套 · 数豆科技/ }) }).first()
      expect(await connectedRow.getAttribute('aria-expanded')).toBe(expanded)
      expect(await status.textContent()).toContain('数豆')
      await verifyConnectionIcon(connectedRow, true)
      expect(await page.getByRole('dialog').count()).toBe(0)
      expect(vendorCalls).toBe(14)
      expect(await readFile(join(restarted.harnessHome, 'finance', 'clients-v1.json'), 'utf8')).toBe(saved)
      stages.push(`## Connected\n\n${(await connectedRow.ariaSnapshot()).replace(/ · ID 35581 · \d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}/gu, ' · ID 35581 · <checked-at>')}`)
      accessDenied = true
      await connectedRow.getByRole('button', { name: /^重新连接账套/ }).click()
      const denied = page.getByRole('status', { name: /服务拒绝访问（HTTP 403）/ })
      await denied.waitFor()
      const deniedRow = page.getByRole('treeitem').filter({ has: denied }).first()
      await verifyConnectionIcon(deniedRow, false)
      expect(await page.getByRole('status', { name: /核验成功/ }).count()).toBe(0)
      expect(await readFile(join(restarted.harnessHome, 'finance', 'clients-v1.json'), 'utf8')).toBe(saved)
      stages.push(`## Access denied\n\n${(await deniedRow.ariaSnapshot()).replace(/ · ID 35581 · \d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}/gu, ' · ID 35581 · <checked-at>')}`)
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-connection/reconnect.expected.md', import.meta.url)), stages.map(stage => stage.trimEnd()).join('\n\n'), webSnapshotMode())
      accessDenied = false
      await deniedRow.getByRole('button', { name: /^连接账套/ }).click()
      await status.waitFor()
      await page.mouse.move(1300, 900)
      await page.screenshot({ path: fileURLToPath(new URL('../../../.artifacts/finance-sidebar-reconnect.png', import.meta.url)) })
    } finally {
      await restarted.close()
    }
  } finally {
    vi.unstubAllGlobals()
    await browser.close()
    await scaffold.close()
    vi.unstubAllEnvs()
  }
}, 120_000)
