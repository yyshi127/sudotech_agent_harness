/** Real plugin, tool, transcript folding, and history; only the model stream is substituted. */
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, readPersistedEvents, watchConsole,
  webClientProfile, webSnapshotMode,
} from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'
import { newEnglishPage } from './support.ts'

const TITLE = 'Persistent visualization'
const FRAGMENT = '<button id="count" onclick="this.textContent=Number(this.textContent)+1">0</button>'
const CALL = ToolCallId('visualize-persistence')
const SKILL_CALL = ToolCallId('visualize-skill')
const ARGS = JSON.stringify({ title: TITLE, fragment: FRAGMENT })

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

async function expectInteractiveCard(page: Page): Promise<void> {
  const card = page.locator('[data-turn-tail="1"] iframe')
  await card.waitFor({ state: 'visible' })
  expect(await card.count()).toBe(1)
  expect(await card.getAttribute('title')).toBe(TITLE)
  expect(await card.getAttribute('sandbox')).toBe('allow-scripts')
  const button = card.contentFrame().getByRole('button', { name: '0', exact: true })
  await button.click()
  await expect.poll(() => card.contentFrame().locator('#count').textContent()).toBe('1')
}

it.skipIf(webClientProfile() !== 'xiaojing')('keeps visualization visible after process folding, follow-up, reload, and reopening', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-visualize-replay-'))
  const replayOverride = join(replayDir, 'replay.json')
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    ...Array.from(ARGS).map((argumentsDelta, index): StreamChunk => ({
      type: 'tool-call-delta', index: 0, id: CALL, ...(index === 0 ? { name: 'visualize' } : {}), argumentsDelta,
    })),
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CALL, name: 'visualize', arguments: ARGS } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
  await writeFile(replayOverride, JSON.stringify([
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: SKILL_CALL, name: 'skill', argumentsDelta: '{"name":"visualize"}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: SKILL_CALL, name: 'skill', arguments: '{"name":"visualize"}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks },
    { kind: 'chunks', chunks: textChunks('Your interactive card is ready.') },
    { kind: 'chunks', chunks: textChunks('The previous card remains available.') },
  ]))
  const scaffold = await launchWebScaffold({
    replayFixture: join(replayDir, 'override-only.jsonl'), replayOverride, paceMs: 10,
    agentPresets: {
      definitions: [financePresetDefinition()],
      default: 'standard',
    },
  })
  const browser = await chromium.launch()
  const failures: unknown[] = []
  let page: Page | undefined
  try {
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    page = await newEnglishPage(browser)
    page.setDefaultTimeout(15_000)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    const workspaceTitle = basename(scaffold.workspaceCwd)
    const workspaceRow = page.getByText(workspaceTitle, { exact: true }).first()
      .locator('xpath=ancestor::*[@role="treeitem"][1]')
    await workspaceRow.waitFor()
    await workspaceRow.hover()
    await page.getByRole('button', { name: `New session in ${workspaceTitle}` }).click()
    const officeLogo = page.getByRole('img', { name: 'Xiaojing Accounting', exact: true })
    await officeLogo.waitFor()
    expect(await officeLogo.locator('image').getAttribute('href')).toBe('/xiaojing-office-robot-logo.png')
    expect((await officeLogo.boundingBox())?.height).toBe(145)
    const officeAsset = await page.request.get(new URL('/xiaojing-office-robot-logo.png', scaffold.authenticatedUrl).href)
    expect(officeAsset.ok()).toBe(true)
    expect(await officeAsset.body()).toEqual(await readFile(new URL('../public/xiaojing-office-robot-logo.png', import.meta.url)))
    const financeAsset = await page.request.get(new URL('/xiaojing-finance-robot-logo.png', scaffold.authenticatedUrl).href)
    expect(financeAsset.ok()).toBe(true)
    expect(await financeAsset.body()).toEqual(await readFile(new URL('../public/xiaojing-finance-robot-logo.png', import.meta.url)))
    expect(await financeAsset.body()).not.toEqual(await officeAsset.body())
    for (const mode of ['Standard mode', 'Finance模式']) {
      const finance = mode === 'Finance模式'
      if (finance) await page.getByRole('button', { name: 'Finance Assistant', exact: true }).click()
      await expect.poll(() => officeLogo.locator('image').getAttribute('href')).toBe(
        finance ? '/xiaojing-finance-robot-logo.png' : '/xiaojing-office-robot-logo.png',
      )
      const titleText = finance ? 'Xiaojing Accounting, Your AI Finance Assistant' : 'Xiaojing Accounting, Your AI Workmate'
      const title = page.getByText(titleText, { exact: true })
      await title.waitFor()
      const composer = page.locator('[data-composer-card]:visible').last()
      await composer.waitFor()
      await officeLogo.waitFor()
      await expect.poll(async () => {
        const [logoBounds, titleBounds, composerBounds] = await Promise.all([
          officeLogo.boundingBox(), title.boundingBox(), composer.boundingBox(),
        ])
        if (logoBounds === null || titleBounds === null || composerBounds === null) return null
        return {
          height: logoBounds.height,
          logoAboveTitle: logoBounds.y + logoBounds.height <= titleBounds.y,
          titleAboveComposer: titleBounds.y + titleBounds.height <= composerBounds.y,
          centered: Math.abs(logoBounds.x + logoBounds.width / 2 - composerBounds.x - composerBounds.width / 2) < 2,
        }
      }).toEqual({ height: 145, logoAboveTitle: true, titleAboveComposer: true, centered: true })
    }
    await page.getByRole('button', { name: 'Office Companion', exact: true }).click()
    await workspaceRow.hover()
    await page.getByRole('button', { name: `New session in ${workspaceTitle}` }).click()
    await expect.poll(() => officeLogo.locator('image').getAttribute('href')).toBe('/xiaojing-office-robot-logo.png')
    const input = page.locator('[data-composer-input][contenteditable="true"]').last()
    const settled = scaffold.whenTurnSettled()
    await input.fill('Create an interactive counter visualization.')
    await input.press('Enter')
    await page.getByTitle('Visualization streaming preview').waitFor({ state: 'visible' })
    const sessionId = await settled
    const events = await readPersistedEvents(scaffold, sessionId)
    const calls = events.filter(event => event.type === 'tool/call')
    expect(calls.map(event => event.data.name)).toEqual(['skill', 'visualize'])
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(2)
    const [skillResult, result] = results
    if (skillResult === undefined || result === undefined) throw new Error('skill or visualize result missing')
    expect(skillResult.data.message.source.callId).toBe(calls[0]?.data.callId)
    expect(result.data.message.source.callId).toBe(calls[1]?.data.callId)
    expect(skillResult.data.message.isError).not.toBe(true)
    expect(result.data.message.isError).not.toBe(true)
    const meta = result.data.meta as { fragment: string; path: string }
    expect(meta.fragment).toBe(FRAGMENT)
    expect(await readFile(meta.path, 'utf8')).toBe(FRAGMENT)
    await page.getByTitle('Visualization streaming preview').waitFor({ state: 'detached' })
    await expectInteractiveCard(page)
    const process = page.locator('[data-turn-process="1"][aria-expanded]')
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./snapshots/xiaojing-visualize/card.expected.md', import.meta.url)),
      (await captureStableAria(page, '[data-turn-tail="1"]', scaffold.workspaceCwd)).replaceAll('\\', '/'), webSnapshotMode(),
    )
    const nextSettled = scaffold.whenTurnSettled()
    await input.fill('Hello again.')
    await input.press('Enter')
    await nextSettled
    expect(await page.locator('[data-turn-tail="1"] iframe').isVisible()).toBe(true)
    expect(await page.locator('[data-turn-tail="2"] iframe').count()).toBe(0)
    // Only the test-created export is removed: history must use persisted metadata.
    await unlink(meta.path)
    await page.reload()
    await expectInteractiveCard(page)
    const url = page.url()
    const restored = await browser.newContext({
      storageState: await page.context().storageState(), locale: 'en-US',
      viewport: { width: 1680, height: 1000 }, timezoneId: 'Asia/Shanghai',
    })
    await page.close()
    const reopened = await restored.newPage()
    await reopened.goto(url)
    await expectInteractiveCard(reopened)
    await reopened.screenshot({ path: join(tmpdir(), 'xiaojing-visualize-verified.png') })
    expect(tripwire.pageErrors).toEqual([])
  } catch (error) {
    if (page !== undefined && !page.isClosed()) console.error(await page.locator('body').innerText())
    failures.push(error)
  } finally {
    await browser.close().catch((error: unknown) => failures.push(error))
    await scaffold.close().catch((error: unknown) => failures.push(error))
    await rm(replayDir, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    vi.unstubAllEnvs()
  }
  if (failures.length > 0) throw new AggregateError(failures, 'visualize browser test failed')
})
