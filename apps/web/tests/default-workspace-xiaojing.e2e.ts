/** Xiaojing first use selects an ordinary Office workspace beside the reserved Finance workspace. */
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { describe, expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

describe.runIf(webClientProfile() === 'xiaojing' && webSnapshotMode() !== 'record')('web e2e: Xiaojing first-use Office workspace', () => {
  it('acknowledges the Xiaojing guide, cancels the picker safely, then selects and reuses a blank Office Session', async () => {
    const scaffold = await launchWebScaffold({ firstUse: true, welcomeNoticePending: true })
    onTestFinished(() => scaffold.close())
    const chosen = join(scaffold.workspaceCwd, 'first-office')
    await mkdir(chosen)
    const initialWorkspaces = scaffold.ctx.workspaceRegistry.list().map(workspace => ({ id: workspace.id, path: workspace.path }))
    expect(initialWorkspaces).toHaveLength(1)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      const consoleErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      try {
        await page.goto(scaffold.authenticatedUrl)
        const guide = page.getByRole('dialog', { name: 'First-time setup' })
        await guide.waitFor()
        await page.keyboard.press('Escape')
        expect(await guide.isVisible()).toBe(true)
        await guide.getByRole('button', { name: 'Get started', exact: true }).click()
        await guide.waitFor({ state: 'hidden' })
        const choose = page.getByRole('button', { name: 'Choose workspace', exact: true })
        await choose.waitFor()
        expect(await page.getByRole('button', { name: 'Account', exact: true }).count()).toBe(0)
        expect(await page.locator('[data-composer-input][contenteditable="true"]').count()).toBe(0)
        expect(scaffold.ctx.sessions.list()).toHaveLength(0)
        await choose.click()
        const picker = page.getByRole('dialog', { name: 'Select Workspace Directory' })
        await picker.waitFor()
        await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
        await picker.waitFor({ state: 'hidden' })
        expect(scaffold.ctx.workspaceRegistry.list().map(workspace => ({ id: workspace.id, path: workspace.path })))
          .toEqual(initialWorkspaces)
        expect(scaffold.ctx.sessions.list()).toHaveLength(0)

        await page.reload()
        await choose.waitFor()
        expect(await guide.count()).toBe(0)
        await choose.click()
        await picker.waitFor()
        await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
        await picker.waitFor({ state: 'hidden' })
        expect(scaffold.ctx.workspaceRegistry.list().map(workspace => ({ id: workspace.id, path: workspace.path })))
          .toEqual(initialWorkspaces)
        expect(scaffold.ctx.sessions.list()).toHaveLength(0)

        await choose.click()
        await picker.waitFor()
        await picker.getByRole('button', { name: 'Edit path', exact: true }).click()
        const pathInput = picker.getByRole('textbox', { name: 'Edit path' })
        await pathInput.fill(chosen)
        await page.keyboard.press('Enter')
        await pathInput.waitFor({ state: 'detached' })
        await picker.getByRole('button', { name: 'Open', exact: true }).click()
        await picker.waitFor({ state: 'hidden' })
        const input = page.locator('[data-composer-input][contenteditable="true"]').first()
        await input.waitFor()
        await expect.poll(() => scaffold.ctx.sessions.list().length).toBe(1)
        const workspace = scaffold.ctx.workspaceRegistry.list().find(item => item.path === chosen)
        expect(workspace).toBeDefined()
        expect(workspace?.title).toBe('first-office')
        expect(scaffold.ctx.workspaceRegistry.list()).toHaveLength(2)
        const officeSessions = scaffold.ctx.sessions.list().filter(session => session.header.cwd === chosen)
        expect(officeSessions).toHaveLength(1)
        const initialSession = officeSessions[0]!
        expect(initialSession.header.cwd).toBe(chosen)
        expect(workspace?.sessionIds).toEqual([initialSession.id])
        expect(initialSession.snapshotEvents().some(event => event.type === 'user/message')).toBe(false)
        expect(await input.textContent()).toBe('')
        await page.reload()
        await input.waitFor()
        expect(await guide.count()).toBe(0)
        expect(scaffold.ctx.sessions.list().filter(session => session.header.cwd === chosen).map(session => session.id))
          .toEqual([initialSession.id])
        expect(scaffold.ctx.sessions.list()).toHaveLength(1)
        expect(scaffold.ctx.workspaceRegistry.list().find(item => item.id === workspace?.id)?.path).toBe(chosen)
        expect(initialSession.snapshotEvents().some(event => event.type === 'user/message')).toBe(false)
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
        expect(consoleErrors).toEqual([])
      } catch (error) {
        await saveFailureShot(page, 'web-e2e-xiaojing-first-use-office')
        throw error
      }
    } finally {
      await browser.close()
    }
  })

  it('keeps a deleted Office workspace absent after startup and reload while retaining its directory', async () => {
    const scaffold = await launchWebScaffold({ firstUse: true })
    onTestFinished(() => scaffold.close())
    const deletedPath = join(scaffold.workspaceCwd, 'deleted-office')
    await mkdir(deletedPath)
    const deletedWorkspace = await scaffold.ctx.workspaceRegistry.create(deletedPath)
    expect(await scaffold.ctx.workspaceRegistry.delete(deletedWorkspace.id)).toBe(true)
    const retainedIds = scaffold.ctx.workspaceRegistry.list().map(workspace => workspace.id)
    expect(retainedIds).toHaveLength(1)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      const consoleErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      try {
        await page.goto(scaffold.authenticatedUrl)
        const choose = page.getByRole('button', { name: 'Choose workspace', exact: true })
        await choose.waitFor()
        expect(scaffold.ctx.workspaceRegistry.list().map(workspace => workspace.id)).toEqual(retainedIds)
        expect(scaffold.ctx.workspaceRegistry.get(deletedWorkspace.id)).toBeUndefined()
        await choose.click()
        const picker = page.getByRole('dialog', { name: 'Select Workspace Directory' })
        await picker.waitFor()
        await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
        await picker.waitFor({ state: 'hidden' })
        expect(scaffold.ctx.sessions.list()).toHaveLength(0)
        expect(await page.locator('[data-composer-input][contenteditable="true"]').count()).toBe(0)
        await page.reload()
        await choose.waitFor()
        await choose.click()
        await picker.waitFor()
        await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
        await picker.waitFor({ state: 'hidden' })
        expect(scaffold.ctx.workspaceRegistry.list().map(workspace => workspace.id)).toEqual(retainedIds)
        expect(scaffold.ctx.workspaceRegistry.list().some(workspace => workspace.path === deletedPath)).toBe(false)
        expect(scaffold.ctx.sessions.list()).toHaveLength(0)
        expect(scaffold.ctx.sessions.list().some(session => session.header.cwd === deletedPath)).toBe(false)
        expect((await stat(deletedPath)).isDirectory()).toBe(true)
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
        expect(consoleErrors).toEqual([])
      } catch (error) {
        await saveFailureShot(page, 'web-e2e-xiaojing-deleted-office')
        throw error
      }
    } finally {
      await browser.close()
    }
  })
})
