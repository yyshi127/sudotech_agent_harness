/** Built settings controls share radius and card materials across account, model, and plugin pages. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Locator } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webClientProfile, webSnapshotMode,
} from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

const XIAOJING = webClientProfile() === 'xiaojing'
const EXPECTED = fileURLToPath(new URL(
  XIAOJING ? './expected/settings-appearance-xiaojing' : './expected/settings-appearance', import.meta.url,
))

/** @param element - Rendered control or card. @returns Its visible geometry and material. */
function appearance(element: Locator) {
  return element.evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      radius: style.borderRadius, border: style.borderTopWidth, stroke: style.borderTopColor,
      fill: style.backgroundColor, height: Math.round(node.getBoundingClientRect().height),
    }
  })
}

it('shares settings card materials and control sizes in both palettes', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  if (!XIAOJING) {
    await scaffold.ctx.settings.mutate('ui-settings-account', [
      { op: 'set', path: ['step'], value: 'done' },
      { op: 'set', path: ['completion'], value: 'completed' },
    ])
    const account = scaffold.ctx.deepseekAccount
    const state: AccountView = {
      status: 'credential-stored', attempt: null,
      links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
    }
    // The Platform provider supplies synthetic identity and wallets; renderer, RPC, and settings remain real.
    const mocks = [
      vi.spyOn(account, 'getState').mockResolvedValue(state),
      vi.spyOn(account, 'getProfile').mockResolvedValue({
        status: 'ready', value: { id: null, name: 'Radius example', contact: 'r***@example.com', avatarUrl: null },
      }),
      vi.spyOn(account, 'getBalance').mockResolvedValue({
        status: 'ready', value: [{ currency: 'CNY', balance: '128.50' }],
        bonusWallets: [{ currency: 'CNY', balance: '12.00' }],
      }),
      vi.spyOn(account, 'watch').mockImplementation(async function* (signal) {
        yield state
        if (signal.aborted) return
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      }),
    ]
    onTestFinished(() => { mocks.forEach((mock) => { mock.mockRestore() }) })
  }
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  const tripwire = watchConsole(page)
  await page.addInitScript(() => { Object.defineProperty(globalThis, 'dshDesktop', { value: { protocolVersion: 1 } }) })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await openSettings(page, 'zh')
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.waitFor()
  if (XIAOJING) {
    expect(await page.getByRole('button', { name: '账号菜单', exact: true }).count()).toBe(0)
    expect(await dialog.getByRole('button', { name: '账号与余额', exact: true }).count()).toBe(0)
  }

  for (const [palette, label] of [['light', '浅色'], ['dark', '深色']] as const) {
    await dialog.getByRole('button', { name: '通用设置', exact: true }).click()
    await dialog.getByRole('button', { name: label, exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(palette === 'dark')
    const selector = await appearance(dialog.getByRole('button', { name: '工作区内修改', exact: true }))
    expect(selector.radius).toBe('12px')
    expect((await appearance(dialog)).radius).toBe('28px')

    let material: Pick<Awaited<ReturnType<typeof appearance>>, 'radius' | 'border' | 'stroke' | 'fill'>
    const controls: Record<string, Awaited<ReturnType<typeof appearance>>> = {}
    if (!XIAOJING) {
      await dialog.getByRole('button', { name: '账号与余额', exact: true }).click()
      const section = dialog.getByRole('region', { name: '账号与余额', exact: true })
      await expect.poll(() => section.innerText()).toContain('¥128.50')
      const cards = section.locator(':scope > div')
      expect(await cards.count()).toBe(2)
      const profile = await appearance(cards.nth(0))
      const balance = await appearance(cards.nth(1))
      material = { radius: profile.radius, border: profile.border, stroke: profile.stroke, fill: profile.fill }
      expect(material.radius).toBe('20px')
      expect(material.fill).not.toBe('rgba(0, 0, 0, 0)')
      expect(balance).toMatchObject(material)
      const usage = await appearance(section.getByRole('link', { name: '查询用量', exact: true }))
      const topUp = await appearance(section.getByRole('link', { name: '充值', exact: true }))
      expect(usage).toMatchObject({ radius: '12px', height: 36 })
      expect(topUp).toMatchObject({ radius: '12px', height: 36 })
      controls.usage = usage
      controls.topUp = topUp
      await compareOrRefreshGolden(join(EXPECTED, 'account.expected.md'),
        await captureStableAria(page, 'section[aria-label="账号与余额"]', scaffold.workspaceCwd), webSnapshotMode())
    } else {
      await dialog.getByRole('button', { name: '内置插件', exact: true }).click()
      const global = dialog.getByRole('button', { name: /^全局/ })
      if (await global.getAttribute('aria-expanded') !== 'true') await global.click()
      const plugins = dialog.locator('[data-plugin-scope="global"] [data-plugin-entry]')
      await plugins.nth(1).waitFor()
      const first = await appearance(plugins.nth(0))
      material = { radius: first.radius, border: first.border, stroke: first.stroke, fill: first.fill }
      expect(material.radius).toBe('20px')
      expect(material.fill).not.toBe('rgba(0, 0, 0, 0)')
      expect(await appearance(plugins.nth(1))).toMatchObject(material)
      controls.search = await appearance(dialog.getByRole('searchbox', { name: '搜索插件', exact: true }))
      expect(controls.search).toMatchObject({ radius: '12px', height: 36 })
    }

    await dialog.getByRole('button', { name: '内置插件', exact: true }).click()
    const global = dialog.getByRole('button', { name: /^全局/ })
    if (await global.getAttribute('aria-expanded') !== 'true') await global.click()
    const plugin = dialog.locator('[data-plugin-scope="global"] [data-plugin-entry]').first()
    await plugin.waitFor()
    expect(await appearance(plugin)).toMatchObject(material)

    await dialog.getByRole('button', { name: 'Agent 预设', exact: true }).click()
    const preset = dialog.locator('li').first()
    await preset.waitFor()
    expect((await appearance(preset)).radius).toBe('20px')
    if (XIAOJING) {
      expect(await preset.locator('button[aria-pressed="true"]').count()).toBe(1)
      controls.preset = await appearance(preset)
      expect(controls.preset).toMatchObject({ radius: '20px', border: '1px', stroke: 'rgb(173, 178, 184)',
        fill: palette === 'dark' ? 'rgb(29, 57, 52)' : 'rgb(243, 251, 249)',
      })
    }

    await dialog.getByRole('button', { name: '模型', exact: true }).click()
    await dialog.getByRole('button', { name: '添加模型提供商', exact: true }).click()
    const field = dialog.getByLabel('提供商', { exact: true })
    await field.waitFor()
    expect(await appearance(field)).toMatchObject({ radius: '12px', height: 32 })
    const save = await appearance(dialog.getByRole('button', { name: '保存', exact: true }))
    expect(save).toMatchObject({ radius: '12px', height: 36 })
    await compareOrRefreshGolden(join(EXPECTED, `${palette}.expected.md`),
      JSON.stringify({ card: material, selector, ...controls, save }, null, 2), webSnapshotMode())
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  }
  if (XIAOJING) await assertFixtureInventory(EXPECTED, ['light.expected.md', 'dark.expected.md'])
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
