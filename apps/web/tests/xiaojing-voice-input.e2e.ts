/** Controlled microphone audio exercises dictation review, cancellation and recovery through the product UI. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { afterEach, expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechInput, SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

let scaffold: WebScaffold | undefined
let browser: Browser | undefined
let scratch: string | undefined

afterEach(async () => {
  try { await browser?.close() } finally {
    try { await scaffold?.close() } finally {
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
      scaffold = undefined
      browser = undefined
      scratch = undefined
    }
  }
})

it('keeps recognized speech as a draft, cancels recording and recovers from an interrupted microphone before explicit submission', async () => {
  scratch = await mkdtemp(join(tmpdir(), 'xiaojing-voice-'))
  const overlay = join(scratch, 'voice.patch.yml')
  const override = join(scratch, 'replay.json')
  await writeFile(overlay, '- id: speech-to-text-sensevoice\n  disabled: true\n')
  const entries: ReplayEntry[] = [{ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'VOICE_ACCEPTANCE_DONE' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'VOICE_ACCEPTANCE_DONE' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }]
  await writeFile(override, JSON.stringify(entries))
  scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: fileURLToPath(new URL('../../../packages/experimental/voice-input-bundle', import.meta.url)), enabled: true }] },
    extraOverlayPath: overlay,
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url)),
    replayOverride: override, compareReplaySession: false,
  })
  const transcribe = vi.fn(async (input: SpeechInput) => {
    expect(Buffer.from(input.audio).subarray(0, 4).toString()).toBe('RIFF')
    expect(input.audio.byteLength).toBeGreaterThan(44)
    return { text: 'VOICE_ACCEPTANCE_TEXT', audioSeconds: 1, inferenceSeconds: 0.1 }
  })
  await scaffold.ctx.plugin({ inject: ['speechToText'], apply(ctx) {
    ctx.effect(() => ctx.speechToText.register({
      info: { id: 'sensevoice-local' as SpeechProviderId, name: 'Controlled voice acceptance', location: 'host-local', languages: ['auto'] },
      transcribe,
    }))
  } })
  let submitted = 0
  scaffold.ctx.on('session/event', (_session, event) => {
    if (event.type === 'user/message' && event.data.source.kind === 'user') submitted++
  })
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const page = await newEnglishPage(browser)
  const errors = watchConsole(page)
  await page.addInitScript(() => {
    const holder = window as Window & { voiceAcceptanceRecorder?: MediaRecorder }
    const NativeRecorder = window.MediaRecorder
    window.MediaRecorder = class extends NativeRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) { super(stream, options); holder.voiceAcceptanceRecorder = this }
    }
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const input = page.locator('[data-composer-input]').first()
  const microphone = page.getByRole('button', { name: 'Start recording', exact: true })
  const stop = page.getByRole('button', { name: 'Stop and transcribe', exact: true })
  await input.fill('Reviewed draft: ')
  await microphone.click()
  await stop.waitFor()
  // This interval supplies fake microphone samples rather than waiting for application readiness.
  await page.waitForTimeout(300)
  await stop.click()
  await expect.poll(() => input.innerText()).toBe('Reviewed draft: VOICE_ACCEPTANCE_TEXT')
  expect(transcribe).toHaveBeenCalledOnce()
  expect(submitted).toBe(0)
  await microphone.click()
  await stop.waitFor()
  await page.keyboard.press('Escape')
  await microphone.waitFor()
  expect(transcribe).toHaveBeenCalledOnce()
  await microphone.click()
  await stop.waitFor()
  await page.evaluate(() => {
    const recorder = (window as Window & { voiceAcceptanceRecorder?: MediaRecorder }).voiceAcceptanceRecorder
    if (recorder === undefined) throw new Error('Controlled microphone did not start')
    recorder.dispatchEvent(new Event('error'))
  })
  await page.getByRole('button', { name: 'Record again', exact: true }).click()
  await stop.waitFor()
  await page.keyboard.press('Escape')
  await microphone.waitFor()
  expect(await input.innerText()).toBe('Reviewed draft: VOICE_ACCEPTANCE_TEXT')
  expect(submitted).toBe(0)
  const settled = scaffold.whenTurnSettled()
  await input.press('Enter')
  await settled
  await page.getByText('VOICE_ACCEPTANCE_DONE', { exact: true }).waitFor()
  expect(submitted).toBe(1)
  expect(transcribe).toHaveBeenCalledOnce()
  expect(errors.pageErrors).toEqual([])
})
