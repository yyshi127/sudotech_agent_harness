/** Streaming reasoning previews through the assembled Chat and a paused model adapter. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webClientProfile, webSnapshotMode,
} from './scaffold.ts'
import { connectFreshWorkspace, expandOwningTurnProcess, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

const SUMMARY = `Next paragraph: ${'inspect the loaded context and pending tools '.repeat(8).trim()}`
const DELTAS = ['First paragraph', `\nDetails\n\n\n${SUMMARY}`, '\nMore detail']
const UI_EXPECTED = fileURLToPath(new URL('./expected/reasoning-preview/running.expected.md', import.meta.url))
const PRODUCT_STATUS_EXPECTED = fileURLToPath(new URL('./expected/reasoning-preview/running-label.xiaojing.expected.md', import.meta.url))

class PausedReasoningAdapter extends LlmAdapter {
  override async listModels(provider: string) { return [{ provider, id: 'paused', name: `${provider}/paused` }] }
  readonly stages = DELTAS.map(text => ({
    text,
    arrived: Promise.withResolvers<undefined>(),
    proceed: Promise.withResolvers<undefined>(),
  }))

  release(): void {
    for (const stage of this.stages) stage.proceed.resolve(undefined)
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    for (const stage of this.stages) {
      yield { type: 'reasoning-delta', index: 0, text: stage.text }
      stage.arrived.resolve(undefined)
      await stage.proceed.promise
      options.signal?.throwIfAborted()
    }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: DELTAS.join('') } }
    yield { type: 'block-start', index: 1, blockType: 'text' }
    yield { type: 'text-delta', index: 1, text: 'Done' }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: 'Done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('shows completed paragraph first lines across blank lines with a right-edge fade', async () => {
  const scaffold = await launchWebScaffold(webClientProfile() === 'xiaojing'
    ? { agentPresets: { definitions: [financePresetDefinition()], default: 'standard' } }
    : {})
  if (webClientProfile() === 'xiaojing') await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'streaming-office')
  const adapter = new PausedReasoningAdapter()
  try {
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['reasoning-preview-test'], adapter))
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'reasoning-preview-test', model: 'paused' })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const console = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      if (webClientProfile() === 'xiaojing') {
        await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
        await page.getByRole('menuitem', { name: 'streaming-office', exact: true }).click()
        await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ state: 'visible' })
          .catch(async (error: unknown) => { await saveFailureShot(page, 'xiaojing-running-label'); throw error })
      } else {
        await connectFreshWorkspace(page, scaffold.workspaceCwd)
      }
      await page.setViewportSize({ width: 480, height: 1000 })
      const input = page.locator('[data-composer-input]').first()
      const settled = scaffold.whenTurnSettled()
      await writeComposerDraft(page, input, 'Show a streamed reasoning preview.')
      await input.press('Enter')

      const [first, second, third] = adapter.stages
      if (first === undefined || second === undefined || third === undefined) throw new Error('preview stages are incomplete')
      await first.arrived.promise
      const reasoning = page.locator('[data-variant="think"][data-state="running"]')
      await expandOwningTurnProcess(page, reasoning)
      await reasoning.waitFor()
      const runningIcon = page.locator('[data-chat-running] > :last-child > [aria-hidden="true"]')
      await runningIcon.waitFor()
      const runningLabel = webClientProfile() === 'xiaojing' ? 'Xiaojing Accounting is thinking' : 'Deep diving'
      await expect.poll(() => page.locator('[data-chat-running] [role="status"]').textContent()).toBe(runningLabel)
      await expect.poll(() => page.locator('[data-chat-running] > :last-child').textContent())
        .toContain(`${runningLabel} for `)
      if (webClientProfile() === 'xiaojing') {
        await scaffold.ctx.settings.update('locale', { preference: 'zh' })
        await expect.poll(() => page.locator('[data-chat-running] [role="status"]').textContent()).toBe('小兢会计思考中')
        await expect.poll(() => page.locator('[data-chat-running] > :last-child').textContent())
          .toContain('小兢会计思考中，用时 ')
        const icon = await runningIcon.evaluate(element => ({
          tag: element.tagName,
          ariaHidden: element.getAttribute('aria-hidden'),
          dots: element.querySelectorAll(':scope > span').length,
        }))
        expect(icon.dots).toBe(3)
        expect(await runningIcon.getAttribute('data-running-dots')).not.toBeNull()
        expect(await page.locator('[data-chat-running] img, [data-chat-running] svg').count()).toBe(0)
        await compareOrRefreshGolden(PRODUCT_STATUS_EXPECTED,
          `${await page.locator('[data-chat-running] [role="status"]').ariaSnapshot()}\n\nRunning icon: ${JSON.stringify(icon)}`,
          webSnapshotMode())
        await scaffold.ctx.settings.update('locale', { preference: 'en' })
        await expect.poll(() => page.locator('[data-chat-running] [role="status"]').textContent()).toBe(runningLabel)
      }
      if (webClientProfile() === 'xiaojing') {
        const dots = runningIcon.locator(':scope > span')
        const expectStaticDots = async () => {
          expect(await runningIcon.isVisible()).toBe(true)
          expect(await dots.evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName)))
            .toEqual(['none', 'none', 'none'])
        }
        try {
          await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' })
          expect(await dots.count()).toBe(3)
          expect(await dots.evaluateAll(elements => elements.map(element => getComputedStyle(element).animationDelay)))
            .toEqual(['0s', '0.15s', '0.3s'])
          const firstDotsFrame = await runningIcon.screenshot({ animations: 'allow' })
          await expect.poll(async () => !(await runningIcon.screenshot({ animations: 'allow' })).equals(firstDotsFrame), {
            timeout: 5000,
          }).toBe(true)
          for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme })
            await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe(colorScheme === 'dark' ? '' : null)
            const colors = await dots.evaluateAll(elements => elements.map(element => ({
              fill: getComputedStyle(element).backgroundColor,
              canvas: getComputedStyle(document.body).backgroundColor,
            })))
            expect(new Set(colors.map(color => color.fill)).size).toBe(3)
            for (const color of colors) {
              expect(color.fill).not.toBe('rgba(0, 0, 0, 0)')
              expect(color.fill).not.toBe(color.canvas)
            }
          }
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await expectStaticDots()
          await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' })
          await expectStaticDots()
          const forcedColors = await dots.evaluateAll(elements => elements.map(element => ({
            fill: getComputedStyle(element).backgroundColor,
            foreground: getComputedStyle(element).color,
          })))
          for (const color of forcedColors) expect(color.fill).toBe(color.foreground)
        } finally {
          await page.emulateMedia({ colorScheme: null, reducedMotion: null, forcedColors: null })
        }
      } else {
        const whale = runningIcon
        const animatedWhale = whale.locator(':scope > span')
        const restingWhale = whale.locator(':scope > svg')
        expect(await whale.locator('animate').count()).toBe(0)
        const expectStaticWhale = async () => {
          await expect.poll(() => animatedWhale.isVisible()).toBe(false)
          await expect.poll(() => restingWhale.isVisible()).toBe(true)
          expect(await animatedWhale.evaluate(element => getComputedStyle(element).maskImage)).toBe('none')
          const colors = await restingWhale.locator('path').evaluate((path) => {
            const probe = document.createElement('span')
            probe.style.cssText = 'color: Canvas; forced-color-adjust: none'
            document.body.append(probe)
            try {
              const style = getComputedStyle(path)
              return {
                stroke: style.stroke.toLowerCase() === 'currentcolor' ? style.color : style.stroke,
                canvas: getComputedStyle(probe).color,
                length: (path as SVGPathElement).getTotalLength(),
              }
            } finally { probe.remove() }
          })
          expect(colors.stroke).not.toBe('none')
          expect(colors.stroke).not.toBe('transparent')
          expect(colors.stroke).not.toBe(colors.canvas)
          expect(colors.length).toBeGreaterThan(0)
        }
        try {
          await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' })
          await expect.poll(() => animatedWhale.isVisible()).toBe(true)
          expect(await animatedWhale.evaluate(element => getComputedStyle(element).maskMode)).toBe('alpha')
          const imageSize = await animatedWhale.evaluate(async (element) => {
            const source = getComputedStyle(element).maskImage.match(/^url\("?(data:image\/png;base64,[A-Za-z0-9+/=]+)"?\)$/)?.[1]
            if (source === undefined) throw new Error('Running whale mask must use the bundled PNG data URL')
            const image = new Image()
            image.src = source
            await image.decode()
            return [image.naturalWidth, image.naturalHeight]
          })
          expect(imageSize).toEqual([28, 28])
          expect(await restingWhale.isVisible()).toBe(false)
          const firstWhaleFrame = await whale.screenshot({ animations: 'allow' })
          await expect.poll(async () => !(await whale.screenshot({ animations: 'allow' })).equals(firstWhaleFrame), {
            timeout: 5000,
          }).toBe(true)
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await expectStaticWhale()
          await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' })
          await expectStaticWhale()
        } finally {
          await page.emulateMedia({ reducedMotion: null, forcedColors: null })
        }
      }
      expect(await reasoning.getAttribute('data-preview')).toBeNull()

      first.proceed.resolve(undefined)
      await second.arrived.promise
      const preview = reasoning.locator('[data-streaming]:not([inert] *)')
      await expect.poll(() => preview.textContent()).toBe('First paragraph')
      expect(await preview.isVisible()).toBe(true)
      await preview.evaluate((element) => { element.setAttribute('data-retained-preview', 'true') })

      second.proceed.resolve(undefined)
      await third.arrived.promise
      await expect.poll(() => preview.textContent()).toBe(SUMMARY)
      expect(await preview.getAttribute('data-retained-preview')).toBe('true')
      expect(await preview.evaluate(element => getComputedStyle(element).maskImage)).toContain('linear-gradient')
      expect(await preview.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      expect(await reasoning.getByRole('button').getAttribute('aria-expanded')).toBe('false')
      await compareOrRefreshGolden(UI_EXPECTED,
        await captureStableAria(page, '[data-variant="think"]', scaffold.workspaceCwd), webSnapshotMode())

      third.proceed.resolve(undefined)
      await settled
      await page.getByText('Done', { exact: true }).waitFor()
      await runningIcon.waitFor({ state: 'detached' })
      expect(console.pageErrors).toEqual([])
      expect(console.warnings).toEqual([])
    } finally {
      adapter.release()
      await browser.close()
    }
  } finally {
    adapter.release()
    await scaffold.close()
  }
})
