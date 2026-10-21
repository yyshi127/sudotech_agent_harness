/** Real Windows PowerShell background output, reload, human cancellation, and process settlement. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterEach, expect, it } from 'vitest'
import { createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

let scaffold: WebScaffold | undefined
let browser: Browser | undefined
let release: string | undefined

afterEach(async () => {
  try {
    if (release !== undefined) await writeFile(release, '')
  } finally {
    try { await browser?.close() } finally { await scaffold?.close() }
    scaffold = undefined
    browser = undefined
    release = undefined
  }
})

it.skipIf(process.platform !== 'win32')('streams a real PowerShell job, restores its live panel and cancels it through the two-step control', async () => {
  scaffold = await launchWebScaffold()
  browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  const errors = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const workspace = scaffold.ctx.workspaceRegistry.list().find(item => item.path === join(scaffold!.workspaceCwd, 'workspace'))
  const agent = scaffold.ctx.agents.list().find(item => workspace?.sessionIds.includes(item.id))
  if (agent === undefined) throw new Error('Workspace did not create a Session')
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Inspect a Windows background job.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('assistant/message', { stream: [], turn: 1, step: 1, message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'Windows background acceptance ready.' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } }) }, { surfaceOp: 'append' })
  agent.session.append('step/end', { turn: 1, step: 1 })
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await scaffold.ctx.sessions.flush(agent.session)
  await page.getByText('Windows background acceptance ready.', { exact: true }).waitFor()

  release = join(agent.session.header.cwd!, '.background-windows-release')
  const command = `Write-Output 'XIAOJING_BACKGROUND_OUTPUT'; for ($attempt = 0; $attempt -lt 600; $attempt++) { if (Test-Path -LiteralPath '${release.replaceAll("'", "''")}') { break }; Start-Sleep -Milliseconds 200 }`
  const started = await scaffold.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('background-windows-acceptance'),
    name: 'pwsh',
    arguments: { command, description: 'Keep an isolated Windows background job running', run_in_background: true },
    agent,
  })
  const reported = started.content.map(block => block.type === 'text' ? block.text : '').join('')
  expect(started.isError, reported).toBe(false)
  const jobs = scaffold.ctx.jobs.list(agent.id)
  expect(jobs).toHaveLength(1)
  const jobId = jobs[0]!.id
  expect(reported).toBe(`started background job ${jobId}`)
  expect(scaffold.ctx.jobs.get(jobId, agent.id).status).toBe('running')

  const open = async () => {
    await page.getByRole('button', { name: '1 background job running', exact: true }).click()
    await page.getByRole('button', { name: /Show live output/u }).click()
    await page.getByText('XIAOJING_BACKGROUND_OUTPUT', { exact: true }).waitFor()
  }
  await open()
  await page.reload()
  await page.getByText('Windows background acceptance ready.', { exact: true }).waitFor()
  expect(scaffold.ctx.jobs.get(jobId, agent.id).status).toBe('running')
  await open()

  const stop = page.locator('[data-kill-state]')
  await stop.click()
  await expect.poll(() => stop.getAttribute('data-kill-state')).toBe('armed')
  expect(scaffold.ctx.jobs.get(jobId, agent.id).status).toBe('running')
  await stop.click()
  await page.getByRole('button', { name: '1 background job', exact: true }).waitFor()
  await expect.poll(() => scaffold!.ctx.jobs.get(jobId, agent.id).status).toBe('killed')
  await expect.poll(() => page.getByRole('list', { name: 'Background jobs' }).textContent()).toContain('cancelled by the user')
  expect(errors.pageErrors).toEqual([])
  expect(errors.warnings).toEqual([])
}, 90_000)
