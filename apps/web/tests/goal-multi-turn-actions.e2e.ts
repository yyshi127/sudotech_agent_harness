// Keyless replay of a real two-round Goal run. Each autonomous round ends as
// its own turn, so the first answer must keep its IconActions when Goal opens
// round two and the final answer must own a second, distinct action row.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-goal'
import {
  assertFixtureInventory, captureExpandedTurnProcessAria, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, recordFixture, watchConsole, webClientProfile, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'
import { XIAOJING_REPLAY_PROVIDERS } from './xiaojing-replay-catalog.ts'

const XIAOJING = webClientProfile() === 'xiaojing'
const STOCK_DIR = fileURLToPath(new URL('../../../snapshots/web/goal-multi-turn-actions', import.meta.url))
const SNAPSHOT_DIR = XIAOJING
  ? fileURLToPath(new URL('../../../snapshots/web/xiaojing-goal-multi-turn-actions', import.meta.url))
  : STOCK_DIR
const EXPECTED_DIR = XIAOJING
  ? fileURLToPath(new URL('./expected/goal-multi-turn-actions-xiaojing', import.meta.url))
  : STOCK_DIR
const FIXTURE = join(SNAPSHOT_DIR, XIAOJING ? 'session.v4.jsonl' : 'session.v3.jsonl')
const OVERRIDE = join(SNAPSHOT_DIR, 'replay.override.json')
const UI_EXPECTED = join(EXPECTED_DIR, 'ui.expected.md')
const UI_EXPANDED_EXPECTED = join(EXPECTED_DIR, 'ui-expanded.expected.md')
const MODE = webSnapshotMode()

const PROMPT = '做两个turn，每个turn输出随机一个包的文件结构。注意你做完一个turn之后，直接输出内容，停止，我们的系统会帮你再开一个turn，你看着做一个类似的'
const COMMAND = `/goal ${PROMPT}`

const PACKAGE_FILES: Readonly<Record<string, string>> = {
  'packages/client/ui-conversation/README.md': '# UI conversation\n',
  'packages/client/ui-conversation/package.json': '{"name":"@deepseek-ai/dsh-client-ui-conversation"}\n',
  'packages/client/ui-conversation/src/client.ts': 'export {}\n',
  'packages/client/ui-chat/tests/chat-view.client.spec.tsx': 'export {}\n',
  'packages/context/session-reference/README.md': '# Session reference\n',
  'packages/context/session-reference/package.json': '{"name":"@deepseek-ai/dsh-session-reference"}\n',
  'packages/context/session-reference/src/index.ts': 'export {}\n',
  'packages/context/session-reference/src/uri.ts': 'export {}\n',
  'packages/context/session-reference/tests/session-reference.spec.ts': 'export {}\n',
  'packages/llm/token-meter/README.md': '# Token meter\n',
  'packages/llm/token-meter/package.json': '{"name":"@deepseek-ai/dsh-token-meter"}\n',
  'packages/llm/token-meter/src/index.ts': 'export {}\n',
  'packages/llm/token-meter/tests/token-meter.spec.ts': 'export {}\n',
  'packages/skill/skill-filesystem/README.md': '# Local skill provider\n',
  'packages/skill/skill-filesystem/package.json': '{"name":"@deepseek-ai/dsh-skill-filesystem"}\n',
  'packages/skill/skill-filesystem/src/index.ts': 'export {}\n',
  'packages/skill/skill-filesystem/src/invariant.ts': 'export {}\n',
  'packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts': 'export {}\n',
}

/** Materialize a stable package inventory inside the isolated session workspace. */
async function seedPackageInventory(workspaceRoot: string): Promise<void> {
  for (const [relativePath, content] of Object.entries(PACKAGE_FILES)) {
    const path = join(workspaceRoot, 'workspace', relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

/** Await exactly the requested number of durable turn ends, then flush the session. */
function whenTurnsSettled(scaffold: WebScaffold, count: number, timeoutMs: number): Promise<SessionId> {
  return new Promise<SessionId>((resolve, reject) => {
    let completed = 0
    const timer = setTimeout(() => {
      off()
      reject(new Error(`only ${completed}/${count} Goal turns ended within ${timeoutMs}ms`))
    }, timeoutMs)
    const off = scaffold.ctx.on('session/event', (session, event: SessionEvent) => {
      if (event.type !== 'turn/end') return
      completed += 1
      if (completed !== count) return
      clearTimeout(timer)
      off()
      scaffold.ctx.sessions.flush(session).then(() => { resolve(session.id) }, reject)
    })
  })
}

/** Goal-owned round numbers in durable user-message order. */
function goalRounds(events: readonly SessionEvent[]): number[] {
  return events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'goal'
    ? [event.data.source.round]
    : [])
}

/** Objective written by each durable Goal creation. */
function createdObjectives(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'goal/change' && event.data.operation === 'create'
    ? [event.data.goal.objective]
    : [])
}

/** Compare the complete Goal log selected by its turn-end identity; Goal commands have no ordinary user-message discriminator. */
async function compareGoalSession(scaffold: WebScaffold, sessionId: SessionId): Promise<void> {
  if (MODE === 'refresh') {
    await recordFixture(scaffold, sessionId, FIXTURE)
    return
  }
  const captureDir = join(scaffold.harnessHome, 'goal-session-capture')
  await mkdir(captureDir)
  const captureFixture = join(captureDir, 'session.v4.jsonl')
  const expected = await readFile(FIXTURE, 'utf8')
  await writeFile(join(captureDir, 'snapshot.yml'), await readFile(join(SNAPSHOT_DIR, 'snapshot.yml'), 'utf8'))
  await writeFile(captureFixture, expected)
  await recordFixture(scaffold, sessionId, captureFixture)
  const context = { sessionIds: ['{{session:1}}'], cwd: '{{cwd}}' }
  expect(normalizeSessionSnapshots([await readFile(captureFixture, 'utf8')], context))
    .toEqual(normalizeSessionSnapshots([expected], context))
}

describe('web e2e: Goal keeps one assistant action row per completed turn', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionEvents: SessionEvent[]
  let commandResults: Map<string, Readonly<ToolExecutionResult>>

  afterEach(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'goal-multi-turn-actions teardown failed')
  })

  /** Boot the real Web composition and connect a fresh package fixture workspace. */
  async function launch(): Promise<void> {
    sessionEvents = []
    commandResults = new Map()
    scaffold = await launchWebScaffold(
      MODE === 'record' ? {} : { replayFixture: FIXTURE, replayOverride: OVERRIDE,
        ...(XIAOJING ? { replayProviders: XIAOJING_REPLAY_PROVIDERS, compareReplaySession: false } : {}),
      },
    )
    await seedPackageInventory(scaffold.workspaceCwd)
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    scaffold.ctx.on('tools/result', (exec, result) => {
      if (exec.name === 'pwsh') commandResults.set(exec.callId, result)
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }

  /** Submit the Goal command after arming the two-turn barrier. */
  async function runGoal(timeoutMs: number): Promise<SessionId> {
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = whenTurnsSettled(scaffold!, 2, timeoutMs)
    await input.fill(COMMAND)
    await input.press('Enter')
    return settled
  }

  it.skipIf(MODE !== 'record')('records the two-round Goal through the real model', async () => {
    await launch()
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-multi-turn-actions-record'))
    const sessionId = await runGoal(360_000)
    await recordFixture(scaffold!, sessionId, FIXTURE)
  }, 380_000)

  it.skipIf(MODE === 'record')('keeps actions on both completed Goal turn tails', async () => {
    const fixtureEvents = parseSessionLog(await readFile(FIXTURE, 'utf8'))
    expect(createdObjectives(fixtureEvents)).toEqual([PROMPT])
    expect(goalRounds(fixtureEvents)).toEqual([1, 2])

    await launch()
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-multi-turn-actions'))
    const sessionId = await runGoal(120_000)

    if (XIAOJING) {
      const calls = sessionEvents.flatMap(event => event.type === 'assistant/message'
        ? event.data.message.content.flatMap(block => block.type === 'tool-call' && block.name === 'pwsh' ? [block] : [])
        : [])
      expect(calls).toHaveLength(8)
      const results = sessionEvents.filter(event => event.type === 'tool/result')
      expect(results).toHaveLength(11)
      expect(results.map(event => event.data.message.isError)).toEqual(Array<boolean>(11).fill(false))
      const stdoutByDescription = new Map<string, string[]>()
      for (const call of calls) {
        const result = results.find(event => event.data.message.toolCallId === call.id)
        if (result === undefined) throw new Error(`native Goal command has no result: ${call.id}`)
        const execution = commandResults.get(call.id)
        if (execution === undefined || execution.isError) throw new Error(`native Goal command did not succeed: ${call.id}`)
        const output = execution.value as { stdout: { text: string } }
        expect(output).toMatchObject({ kind: 'foreground', exitCode: 0, aborted: false, timedOut: false,
          stdout: { truncated: false }, stderr: { text: '', truncated: false },
        })
        const args = JSON.parse(call.arguments) as { description: string }
        stdoutByDescription.set(args.description, output.stdout.text.trim().split(/\r?\n/))
      }
      const packagePaths = ['packages/client/ui-chat', 'packages/client/ui-conversation', 'packages/context/session-reference',
        'packages/llm/token-meter', 'packages/skill/skill-filesystem']
      expect(stdoutByDescription.get('List package directories deterministically')).toEqual(packagePaths)
      expect(stdoutByDescription.get('List packages directory contents')).toEqual(packagePaths)
      expect(stdoutByDescription.get('Randomly select one package with PowerShell')).toEqual(['packages/context/session-reference'])
      expect(stdoutByDescription.get('Randomly select another package with PowerShell')).toEqual(['packages/context/session-reference'])
      expect(stdoutByDescription.get('Re-roll excluding the package from turn 1')).toEqual(['packages/llm/token-meter'])
      for (const [description, prefix] of [
        ['List all files in session-reference package', 'packages/context/session-reference/'],
        ['List all files in token-meter package', 'packages/llm/token-meter/'],
      ] as const) {
        expect(stdoutByDescription.get(description)?.toSorted())
          .toEqual(Object.keys(PACKAGE_FILES).filter(path => path.startsWith(prefix)).sort())
      }
      const workspace = join(scaffold!.workspaceCwd, 'workspace')
      const files = (await readdir(workspace, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
        .map(entry => relative(workspace, join(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort()
      expect(files).toEqual(Object.keys(PACKAGE_FILES).sort())
      for (const [path, content] of Object.entries(PACKAGE_FILES)) expect(await readFile(join(workspace, path), 'utf8')).toBe(content)
    }

    expect(sessionEvents.flatMap(event => event.type === 'turn/end' ? [event.data.turn] : []))
      .toEqual([1, 2])
    expect(goalRounds(sessionEvents)).toEqual([1, 2])
    expect(sessionEvents.flatMap(event =>
      event.type === 'request/header' ? [event.data.reason] : [])).toEqual(['initial', 'series'])
    await expect.poll(() => page.locator('[data-turn-process]').count(), { timeout: 15_000 }).toBe(2)
    const trigger = page.locator('[data-turn-trigger]').first()
    const process = page.locator('[data-turn-process]').first()
    const originalFontSize = await page.evaluate(() => document.body.style.getPropertyValue('--dsh-content-font-size'))
    await process.click()
    try {
      for (const fontSize of [10, 14, 22]) {
        await scaffold!.ctx.settings.update('ui-theme', { fontSize })
        await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue('--dsh-content-font-size')))
          .toBe(`${String(fontSize)}px`)
        const group = page.locator('[data-process-activity]:visible').first()
        const groupFontSize = await group.evaluate(element => getComputedStyle(element).fontSize)
        expect(groupFontSize).toBe(`${String(fontSize)}px`)
        expect(await process.evaluate(element => getComputedStyle(element).fontSize)).toBe(groupFontSize)
        expect(await trigger.getByText('Continuing goal', { exact: true })
          .evaluate(element => getComputedStyle(element).fontSize)).toBe(groupFontSize)
        expect(await process.evaluate(element => element.getBoundingClientRect().top))
          .toBe(await trigger.evaluate(element => element.getBoundingClientRect().bottom) + 16)
        expect(await group.evaluate(element => element.getBoundingClientRect().top))
          .toBe(await process.evaluate(element => element.getBoundingClientRect().bottom) + 16)
      }
    } finally {
      await scaffold!.ctx.settings.update('ui-theme', { fontSize: Number.parseFloat(originalFontSize) })
      await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue('--dsh-content-font-size')))
        .toBe(originalFontSize)
      await process.click()
    }
    expect(await page.getByRole('button', { name: 'System prompt' }).count()).toBe(0)
    expect(await page.locator(
      '[data-chat-flow-kind="system-prompt"]',
    ).count()).toBe(0)
    const branchButtons = page.getByRole('button', { name: 'Branch into a new conversation' })
    await expect.poll(() => branchButtons.count(), { timeout: 15_000 }).toBe(2)
    expect(await branchButtons.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-disabled'))))
      .toEqual([null, null])
    await branchButtons.last().focus()
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    const expanded = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold!.workspaceCwd,
    )
    await compareOrRefreshGolden(UI_EXPANDED_EXPECTED, expanded, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    if (XIAOJING) await compareGoalSession(scaffold!, sessionId)
  }, 140_000)

  it.skipIf(MODE === 'record')('keeps a closed fixture inventory', async () => {
    if (XIAOJING) await assertFixtureInventory(SNAPSHOT_DIR, ['replay.override.json', 'session.v4.jsonl'])
    await assertFixtureInventory(EXPECTED_DIR, [
      ...XIAOJING ? [] : ['replay.override.json', 'session.v3.jsonl'],
      'ui.expected.md', 'ui-expanded.expected.md',
    ])
  })
})
