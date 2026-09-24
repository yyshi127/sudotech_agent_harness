/** Keyless first-run check through the desktop's real, isolated application profile. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { _electron } = createRequire(new URL('../../web/package.json', import.meta.url))('playwright')
const project = fileURLToPath(new URL('../../../', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'xiaojing-onboarding-'))
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|ELECTRON_RUN_AS_NODE/i.test(key)))
const expected = (await readFile(new URL('../../web/tests/expected/onboarding-deepseek-config/welcome.xiaojing.expected.md', import.meta.url), 'utf8')).trim()

async function launch() {
  return _electron.launch({
    executablePath: process.env.DSH_DESKTOP_ELECTRON_PATH ?? require('electron'),
    args: [join(project, 'apps/desktop')],
    env: { ...env, DSH_DESKTOP_PREVIEW_ROOT: root, DSH_TELEMETRY_DISABLED: '1', NODE_USE_ENV_PROXY: '0' },
    timeout: 30_000,
  })
}

let app
let passed = false
try {
  app = await launch()
  await app.firstWindow()
  let page
  for (const candidate of app.windows()) {
    const window = await app.browserWindow(candidate)
    if (await window.evaluate(value => value.getTitle()) === '小兢会计') page = candidate
  }
  assert.ok(page, 'The desktop main window must be present beside the companion')
  await page.waitForURL(url => url.protocol === 'http:', { timeout: 60_000 })
  const welcome = page.getByRole('dialog', { name: '初次使用说明', exact: true })
  await welcome.waitFor({ timeout: 30_000 })
  assert.equal((await welcome.ariaSnapshot()).trim(), expected)
  assert.equal(await page.locator('#root').evaluate(root => root.inert), true)
  await page.keyboard.press('Escape')
  assert.equal(await welcome.isVisible(), true)
  await page.reload()
  await welcome.waitFor({ timeout: 30_000 })
  if (process.env.DSH_ONBOARDING_SCREENSHOT) {
    await page.screenshot({ path: process.env.DSH_ONBOARDING_SCREENSHOT })
  }
  await welcome.getByRole('button', { name: '开始使用', exact: true }).click()
  await welcome.waitFor({ state: 'detached' })
  await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).waitFor()
  await page.getByRole('button', { name: '稍后配置', exact: true }).click()
  const logo = page.locator('svg[aria-label="小兢会计"]')
  await logo.waitFor({ state: 'visible' })
  const logoBox = await logo.boundingBox()
  assert.equal(Math.round(logoBox.height), 160)
  assert.equal(await logo.locator('image').getAttribute('href'), '/xiaojing-office-robot-logo.png')
  const sidebarMark = page.locator('svg:has(image[href="/xiaojing-character-logo.png"])')
  await sidebarMark.waitFor({ state: 'visible' })
  const sidebarBounds = await sidebarMark.boundingBox()
  assert.equal(sidebarBounds.width, 24)
  assert.equal(sidebarBounds.width, sidebarBounds.height)
  assert.equal(await sidebarMark.getAttribute('viewBox'), '82 82 1090 1090')
  const tabIcon = page.locator('head link[rel="icon"]')
  assert.equal(await tabIcon.count(), 1)
  assert.equal(await tabIcon.getAttribute('href'), '/xiaojing-character-logo.png')
  const characterLogo = await readFile(join(project, 'apps/web/public/xiaojing-character-logo.png'))
  const sidebarAsset = await page.request.get(new URL('/xiaojing-character-logo.png', page.url()).href, {
    headers: { 'user-agent': 'Xiaojing-desktop-icon-test' },
  })
  assert.equal(sidebarAsset.ok(), true)
  assert.deepEqual(await sidebarAsset.body(), characterLogo)
  assert.deepEqual(await readFile(join(project, 'apps/desktop/assets/taskbar-icon.png')), characterLogo)
  const windowsIcon = await readFile(join(project, 'apps/desktop/assets/windows-icon.png'))
  assert.deepEqual(await readFile(join(project, 'apps/desktop/build/app-icon.png')), windowsIcon)
  assert.notDeepEqual(windowsIcon, characterLogo)
  assert.match(await readFile(join(project, 'apps/desktop/loading.html'), 'utf8'), /<img src="assets\/taskbar-icon\.png"/)
  const iconAlpha = await app.evaluate(({ nativeImage }, iconPath) => {
    const icon = nativeImage.createFromPath(iconPath)
    return icon.isEmpty() ? null : icon.toBitmap()[3]
  }, join(project, 'apps/desktop/assets/taskbar-icon.png'))
  assert.equal(iconAlpha, 0, 'The startup artwork must retain its transparent background')
  const iconSizes = await app.evaluate(({ nativeImage }, paths) => paths.map(path => {
    const icon = nativeImage.createFromPath(path)
    const { width, height } = icon.getSize()
    const pixels = icon.toBitmap()
    let left = width
    let right = 0
    let top = height
    let bottom = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] < 128) continue
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
    return { width, height, left, right, top, bottom, inkWidth: right - left + 1, inkHeight: bottom - top + 1 }
  }), [join(project, 'apps/desktop/assets/taskbar-icon.png'), join(project, 'apps/desktop/assets/windows-icon.png')])
  const [originalIcon, enlargedIcon] = iconSizes
  assert.equal(enlargedIcon.width, originalIcon.width)
  assert.equal(enlargedIcon.height, originalIcon.height)
  assert.ok(Math.abs(enlargedIcon.inkWidth / originalIcon.inkWidth - 1.10) < 0.01)
  assert.ok(Math.abs(enlargedIcon.inkHeight / originalIcon.inkHeight - 1.10) < 0.01)
  assert.ok(enlargedIcon.left > 0 && enlargedIcon.top > 0
    && enlargedIcon.right < enlargedIcon.width - 1 && enlargedIcon.bottom < enlargedIcon.height - 1)
  if (process.env.DSH_HERO_SCREENSHOT) await page.screenshot({ path: process.env.DSH_HERO_SCREENSHOT })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('companion.html')).setSize(1024, 768)
  })
  await page.waitForFunction(() => window.innerWidth <= 1024)
  const narrowLogo = await logo.boundingBox()
  const inputBox = await page.locator('[data-composer-placeholder]').first().boundingBox()
  if (process.env.DSH_HERO_SCREENSHOT) await page.screenshot({ path: process.env.DSH_HERO_SCREENSHOT.replace('.png', '-narrow.png') })
  assert.ok(narrowLogo.y >= 40, 'Hero stays below native controls')
  assert.ok(narrowLogo.y + narrowLogo.height <= inputBox.y, `Hero ends at ${narrowLogo.y + narrowLogo.height}, composer starts at ${inputBox.y}`)
  await page.reload()
  await page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: '初次使用说明', exact: true }).count(), 0)
  const settings = await readFile(join(root, 'app-data', '@sudotech', 'xiaojing-accounting-desktop', 'harness', 'settings.yaml'), 'utf8')
  assert.match(settings, /welcomeNoticeVersion: 2026-08-13\.1/)
  await page.goto(pathToFileURL(join(project, 'apps/desktop/loading.html')).href)
  const startupLogo = page.locator('main img')
  await startupLogo.evaluate(image => image.decode())
  assert.equal(await startupLogo.getAttribute('src'), 'assets/taskbar-icon.png')
  const startupBounds = await startupLogo.boundingBox()
  assert.equal(startupBounds.width, 128)
  assert.equal(startupBounds.height, 128)
  const startupTitle = await page.locator('main h1').boundingBox()
  assert.ok(startupBounds.y + startupBounds.height < startupTitle.y, 'The startup mark must not overlap its title')
  if (process.env.DSH_STARTUP_SCREENSHOT) await page.screenshot({ path: process.env.DSH_STARTUP_SCREENSHOT })
  passed = true
  console.log('PASS: product welcome, acknowledgement, reload persistence, transparent icons, and 128px startup artwork')
} finally {
  await app?.close()
  // Only the directory allocated by this test is removed; user profiles are never selected.
  if (passed) await rm(root, { recursive: true, force: true })
  else console.error(`First-run diagnostic logs retained at ${root}`)
}
