// Robot dimensions in the shipped Xiaojing empty-session hero; no model calls.
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, webClientProfile } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it.skipIf(webClientProfile() !== 'xiaojing')('fits the enlarged paired robots in wide, narrow, and short windows', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const artwork = page.getByRole('img', { name: 'Xiaojing Accounting', exact: true })
    await artwork.waitFor()
    for (const viewport of [
      { width: 1680, height: 1000, artworkHeight: 220 },
      { width: 480, height: 1000, artworkHeight: 220 },
      { width: 320, height: 640, artworkHeight: 176 },
      { width: 1680, height: 600, artworkHeight: 210 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await expect.poll(async () => (await artwork.boundingBox())?.height).toBeCloseTo(viewport.artworkHeight, 1)
      // The sidebar can finish its viewport reflow after the artwork reaches its new height.
      await expect.poll(() => artwork.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.left >= 0 && bounds.top >= 0
          && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight
      })).toBe(true)
      const bounds = (await artwork.boundingBox())!
      expect(bounds.width).toBeCloseTo(viewport.artworkHeight * 1254 / 970, 1)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    }
    expect(await artwork.getAttribute('viewBox')).toBe('0 105 1254 970')
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    try {
      await browser?.close()
    } finally {
      await scaffold.close()
    }
  }
}, 120_000)
