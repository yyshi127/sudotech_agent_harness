// UI-only geometry for the Automation tasks page; no model calls or task mutations.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webClientProfile, webSnapshotMode } from './scaffold.ts'

const XIAOJING = webClientProfile() === 'xiaojing'
const SHOTS = fileURLToPath(new URL('../../../.artifacts', import.meta.url))

it('keeps the automation title intact before moving New to another line', async () => {
  const scaffold = await launchWebScaffold()
  try {
    const browser = await chromium.launch()
    try {
      const facts: string[] = []
      for (const language of ['en', 'zh'] as const) {
        const context = await browser.newContext({
          viewport: { width: 1680, height: 1000 },
          locale: language === 'en' ? 'en-US' : 'zh-CN',
          reducedMotion: 'reduce',
        })
        try {
          const page = await context.newPage()
          const consoleWatch = watchConsole(page)
          await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
          const title = language === 'en' ? 'Automation tasks' : '自动化任务'
          await page.getByRole('button', { name: title, exact: true }).click()
          const panel = page.getByTestId('task-manager-page')
          const heading = panel.getByRole('heading', { name: title, exact: true })
          await heading.waitFor()
          const header = heading.locator('..')
          const create = header.getByRole('button', { name: language === 'en' ? 'New' : '新建', exact: true })
          const emptyAction = panel.getByRole('status').getByRole('button', {
            name: language === 'en' ? 'New automation task' : '新建自动化任务', exact: true,
          })
          const actionGeometry = () => emptyAction.evaluate((button) => {
            const bounds = button.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(button)
            return {
              contained: Array.from(range.getClientRects()).every(rect => rect.left >= bounds.left - 1
                && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1)
                && button.scrollHeight <= button.clientHeight,
              height: bounds.height,
            }
          })
          await page.evaluate(() => document.fonts.ready)
          await create.focus()
          for (const width of [1680, 800, 520, 440, 390, 430, 1024]) {
            await page.setViewportSize({ width, height: 1000 })
            // The title keeps its natural width at every viewport width, so New
            // stays beside it here; the squeeze case below is what moves it down.
            await expect.poll(() => header.evaluate((element) => {
              const title = element.querySelector('h1')!
              const button = element.querySelector('button')!
              const titleRect = title.getBoundingClientRect()
              const buttonRect = button.getBoundingClientRect()
              const headerRect = element.getBoundingClientRect()
              const range = document.createRange()
              range.selectNodeContents(title)
              const titleLines = Array.from(range.getClientRects())
              return {
                titleSingleLine: titleLines.length === 1,
                buttonSingleLine: button.scrollHeight <= button.clientHeight,
                placement: buttonRect.left >= titleRect.right - 1
                  ? 'beside' as const
                  : buttonRect.top >= titleRect.bottom - 1 ? 'below' as const : 'overlapping' as const,
                contained: titleRect.left >= headerRect.left - 1 && titleRect.right <= headerRect.right + 1
                  && buttonRect.left >= headerRect.left - 1 && buttonRect.right <= headerRect.right + 1,
                focused: document.activeElement === button,
              }
            })).toEqual({
              titleSingleLine: true, buttonSingleLine: true, placement: 'beside', contained: true, focused: true,
            })
            facts.push(`${language} ${width}px: title and New single-line, New beside the title; contained; New retains focus`)
            await expect.poll(actionGeometry).toEqual({ contained: true, height: 36 })
            if (XIAOJING && width === 1680) {
              await mkdir(SHOTS, { recursive: true })
              await page.screenshot({ path: `${SHOTS}/web-schedule-header-wide-${language}-033.png` })
            }
          }
          if (XIAOJING) facts.push(`${language}: the empty-state action contains its label at all seven widths and retains its 36px height`)
          if (language === 'en') {
            // Xiaojing's expanded sidebar is 24px wider than the stock sidebar;
            // both widths leave 172px for the heading and creation action.
            const squeezeWidth = XIAOJING ? 533 : 509
            await page.setViewportSize({ width: squeezeWidth, height: 1000 })
            await page.getByRole('button', { name: 'Open sidebar', exact: true }).first().click()
            await create.focus()
            await expect.poll(() => header.evaluate((element) => {
              const title = element.querySelector('h1')!
              const button = element.querySelector('button')!
              const titleRect = title.getBoundingClientRect()
              const buttonRect = button.getBoundingClientRect()
              const range = document.createRange()
              range.selectNodeContents(title)
              return {
                titleSingleLine: range.getClientRects().length === 1,
                placement: buttonRect.left >= titleRect.right - 1
                  ? 'beside' as const
                  : buttonRect.top >= titleRect.bottom - 1 ? 'below' as const : 'overlapping' as const,
              }
            })).toEqual({ titleSingleLine: true, placement: 'below' })
            facts.push(`en ${squeezeWidth}px with sidebar expanded: title single-line; New moves below the title`)
            if (XIAOJING) {
              await page.setViewportSize({ width: 509, height: 1000 })
              await expect.poll(() => header.evaluate((element) => {
                const title = element.querySelector('h1')!
                const button = element.querySelector('button')!
                const titleRect = title.getBoundingClientRect()
                const buttonRect = button.getBoundingClientRect()
                const headerRect = element.getBoundingClientRect()
                const range = document.createRange()
                range.selectNodeContents(title)
                return {
                  titleLines: range.getClientRects().length,
                  below: buttonRect.top >= titleRect.bottom - 1,
                  contained: titleRect.left >= headerRect.left - 1 && titleRect.right <= headerRect.right + 1
                    && buttonRect.left >= headerRect.left - 1 && buttonRect.right <= headerRect.right + 1,
                  focused: document.activeElement === button,
                }
              })).toEqual({ titleLines: 2, below: true, contained: true, focused: true })
              facts.push('en 509px with sidebar expanded: title wraps into two contained lines; New remains below; New retains focus')
              await expect.poll(async () => (await actionGeometry()).contained).toBe(true)
              expect((await actionGeometry()).height).toBeGreaterThan(36)
              await page.screenshot({ path: `${SHOTS}/web-schedule-header-narrow-033.png` })
              facts.push('en 509px with sidebar expanded: the empty-state action contains its complete wrapped label')
            }
          }
          expect(consoleWatch.pageErrors).toEqual([])
          expect(consoleWatch.warnings).toEqual([])
        } finally {
          await context.close()
        }
      }
      await compareOrRefreshGolden(
        fileURLToPath(new URL(XIAOJING ? './expected/schedule-header-xiaojing-033.expected.md' : './expected/schedule-header.expected.md', import.meta.url)),
        `# Automation tasks header\n\n${facts.join('\n')}`,
        webSnapshotMode(),
      )
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
