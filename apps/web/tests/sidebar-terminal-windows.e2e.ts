/** Windows sidebar terminals through the shipped controller and real local PTYs. */
import { chromium, type Browser, type Page } from 'playwright'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-api-terminal-controller'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh } from './support.ts'

let scaffold: WebScaffold | undefined
let browser: Browser | undefined

afterEach(async () => {
  try { await browser?.close() } finally { await scaffold?.close() }
  browser = undefined
  scaffold = undefined
  vi.unstubAllEnvs()
})

async function guide(page: Page) {
  const expand = page.locator('[data-sidebar-right-expand]')
  if (await expand.isVisible()) await expand.click()
  const entry = page.locator('[data-sidebar-right-guide-entry="terminal"]')
  if (!await entry.isVisible()) await page.locator('[data-dockkit-add-tab]').click()
  await entry.waitFor()
  return entry
}

async function output(page: Page, marker: string): Promise<void> {
  await expect.poll(() => page.locator('.xterm-rows:visible').innerText(), { timeout: 15_000 }).toMatch(/PS [^\n]*>/u)
  await page.locator('.xterm-helper-textarea:visible').click()
  await page.keyboard.insertText(`Write-Output '${marker}'`)
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await page.locator('.xterm-rows:visible').innerText())
    .split('\n').some(line => line.trim() === marker), { timeout: 15_000 }).toBe(true)
}

it.skipIf(process.platform !== 'win32')('runs independent PowerShell tabs, selects a shell, restores live terminals and closes each process', async () => {
  // Keep the test runner's bundled modules out of Windows PowerShell 5.1.
  vi.stubEnv('PSModulePath', [
    join(process.env['SystemRoot']!, 'System32/WindowsPowerShell/v1.0/Modules'),
    join(process.env['ProgramFiles']!, 'WindowsPowerShell/Modules'),
  ].join(';'))
  scaffold = await launchWebScaffold()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  const workspace = scaffold.ctx.workspaceRegistry.list().find(item => item.path === join(scaffold!.workspaceCwd, 'workspace'))
  const agent = scaffold.ctx.agents.list().find(item => workspace?.sessionIds.includes(item.id))
  if (agent === undefined) throw new Error('Workspace did not create a Session')
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Open a terminal.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('assistant/message', { stream: [], turn: 1, step: 1, message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'Windows terminal acceptance ready.' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } }) }, { surfaceOp: 'append' })
  agent.session.append('step/end', { turn: 1, step: 1 })
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await scaffold.ctx.sessions.flush(agent.session)
  await page.getByText('Windows terminal acceptance ready.', { exact: true }).waitFor()
  const terminals = () => scaffold!.ctx.terminalController.list(agent.id)
  await (await guide(page)).getByRole('button', { name: '选择 Shell', exact: true }).click()
  await page.getByRole('menuitem', { name: /^pwsh(?:\.exe)?$/iu }).click()
  await expect.poll(() => terminals().length).toBe(1)
  expect(terminals()[0]!.shell.name.toLowerCase()).toContain('pwsh')
  await output(page, 'WINDOWS_TERMINAL_A')
  const first = terminals()[0]!
  const firstTab = await page.locator('[data-dockkit-tab][aria-selected="true"]').getAttribute('data-dockkit-tab')

  const entry = await guide(page)
  await entry.getByRole('button', { name: '选择 Shell', exact: true }).click()
  await page.getByRole('menuitem', { name: /^powershell(?:\.exe)?$/iu }).click()
  await expect.poll(() => terminals().length).toBe(2)
  const second = terminals().find(terminal => terminal.id !== first.id)!
  expect(second.shell.name.toLowerCase()).toContain('powershell')
  await output(page, 'WINDOWS_TERMINAL_B')
  expect(await page.locator('.xterm-rows:visible').innerText()).not.toContain('WINDOWS_TERMINAL_A')
  const secondTab = await page.locator('[data-dockkit-tab][aria-selected="true"]').getAttribute('data-dockkit-tab')
  await page.reload()
  await page.getByText('Windows terminal acceptance ready.', { exact: true }).waitFor()
  await expect.poll(async () => (await page.locator('.xterm-rows:visible').innerText()).includes('WINDOWS_TERMINAL_B')).toBe(true)
  expect(terminals().map(terminal => terminal.id)).toEqual([first.id, second.id])
  await output(page, 'WINDOWS_TERMINAL_AFTER_RELOAD')
  await page.locator(`[data-dockkit-tab="${firstTab}"]`).click()
  await expect.poll(async () => (await page.locator('.xterm-rows:visible').innerText()).includes('WINDOWS_TERMINAL_A')).toBe(true)
  expect(await page.locator('.xterm-rows:visible').innerText()).not.toContain('WINDOWS_TERMINAL_B')
  await output(page, 'WINDOWS_TERMINAL_A_RESUMED')
  for (const tabId of [firstTab, secondTab]) {
    const tab = page.locator(`[data-dockkit-tab="${tabId}"]`)
    await tab.hover()
    await tab.locator('[data-dockkit-tab-close]').click()
  }
  // Provider shutdown includes its 1s grace plus Windows process-identity checks.
  await expect.poll(terminals, { timeout: 15_000 }).toEqual([])
  expect(errors.pageErrors).toEqual([])
}, 120_000)
