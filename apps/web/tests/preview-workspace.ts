/** Workspace entry used by document preview cases under the official and Xiaojing client builds. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { webClientProfile } from './scaffold.ts'
import { connectFreshWorkspace, connectFreshWorkspaceZh } from './support.ts'

/**
 * Select the case's private directory through the current product's first-use control.
 * @param page - Isolated browser page with the shipped client.
 * @param root - Scaffold-owned workspace parent directory.
 * @param locale - Browser locale determining the directory picker's labels.
 */
export async function connectPreviewWorkspace(page: Page, root: string, locale = 'en-US'): Promise<void> {
  if (webClientProfile() !== 'xiaojing') {
    await (locale === 'zh-CN' ? connectFreshWorkspaceZh : connectFreshWorkspace)(page, root)
    return
  }
  const path = join(root, 'workspace')
  await mkdir(path, { recursive: true })
  const zh = locale === 'zh-CN'
  await page.getByRole('button', { name: zh ? '选择工作区' : 'Choose workspace', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: zh ? '选择工作区目录' : 'Select Workspace Directory' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: zh ? '编辑路径' : 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: zh ? '编辑路径' : 'Edit path' })
  await pathInput.fill(path)
  await page.keyboard.press('Enter')
  await pathInput.waitFor({ state: 'detached' })
  await dialog.getByRole('button', { name: zh ? '打开' : 'Open', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
}
