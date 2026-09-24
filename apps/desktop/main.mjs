import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from 'electron'
import {
  IDLE_COMPANION_SNAPSHOT,
  defaultCompanionBounds,
  isCompanionScale,
  isCompanionSnapshot,
  normalizeCompanionPreferences,
  resolveCompanionBounds,
} from './desktop-companion.mjs'
import { assertXiaojingDesktopClientBuild } from './client-build-profile.mjs'
import { backendLaunchUrl, backendSessionCookie, companionEventsUrl } from './backend-auth.mjs'
import { registerXiaojingDirectoryPicker } from './xiaojing-directory-picker.mjs'
import { registerXiaojingOpenPath } from './xiaojing-open-path.mjs'

const identity = JSON.parse(readFileSync(new URL('./identity.json', import.meta.url), 'utf8'))
const PRODUCT_NAME = identity.productName
const WINDOW_TITLE = identity.shortcutName
const COMPANY_NAME = '瑞华云数豆科技'
const BACKEND_READY_TIMEOUT_MS = 60_000
const COMPANION_STREAM_RETRY_MS = 1_000
const COMPANION_PREFERENCES_MODE = 0o600
const COMPANION_DIRECTORY_MODE = 0o700
const UPDATE_SHUTDOWN_ARGUMENT = '--xiaojing-shutdown-for-update'

const channels = {
  applicationInfo: 'xiaojing-desktop:application-info',
  state: 'xiaojing-desktop:companion-state',
  wake: 'xiaojing-desktop:wake-companion',
  tuck: 'xiaojing-desktop:tuck-companion',
  reset: 'xiaojing-desktop:reset-companion-position',
  scale: 'xiaojing-desktop:set-companion-scale',
  showMain: 'xiaojing-desktop:show-main-window',
  changed: 'xiaojing-desktop:companion-state-changed',
  pointer: 'xiaojing-desktop:companion-pointer',
  dragStart: 'xiaojing-desktop:companion-drag-start',
  dragMove: 'xiaojing-desktop:companion-drag-move',
  dragEnd: 'xiaojing-desktop:companion-drag-end',
  contextMenu: 'xiaojing-desktop:companion-context-menu',
}

const previewRoot = !app.isPackaged ? process.env.DSH_DESKTOP_PREVIEW_ROOT?.trim() : undefined
if (previewRoot !== undefined && previewRoot !== '') {
  const root = resolve(previewRoot)
  const appData = join(root, 'app-data')
  const documents = join(root, 'documents')
  mkdirSync(appData, { recursive: true })
  mkdirSync(documents, { recursive: true })
  app.setPath('appData', appData)
  app.setPath('documents', documents)
}

app.setPath('userData', join(app.getPath('appData'), ...identity.userDataSegments))

let backend
let backendUrl
let mainWindow
let companionWindow
let tray
let quitting = false
let startupTimer
let companionStreamAbort
let companionSnapshot = { ...IDLE_COMPANION_SNAPSHOT }
let companionStateReadable = false
let applicationReady = false
let preferences = readCompanionPreferences()
let preferenceWrite = Promise.resolve()
let dragState

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else if (process.argv.includes(UPDATE_SHUTDOWN_ARGUMENT)) {
  quitting = true
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes(UPDATE_SHUTDOWN_ARGUMENT)) {
      quitting = true
      app.quit()
      return
    }
    showMainWindow()
  })
  app.whenReady().then(startDesktop).catch(showFatalError)
}

async function startDesktop() {
  assertXiaojingDesktopClientBuild(resolve(import.meta.dirname, '..', '..'), app.isPackaged)
  app.setName(PRODUCT_NAME)
  app.setAppUserModelId(identity.appId)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  registerDesktopIpc()
  mainWindow = createMainWindow()
  createTray()
  registerDisplayRecovery()
  if (preferences.visible) await wakeCompanion({ startupGreeting: true })
  await mainWindow.loadFile(join(import.meta.dirname, 'loading.html'))
  mainWindow.show()
  startBackend()
}

function createMainWindow() {
  const icon = join(import.meta.dirname, 'assets', 'windows-icon.png')
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: WINDOW_TITLE,
    icon,
    autoHideMenuBar: true,
    backgroundColor: '#f8fbfa',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#63706c', height: 40 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(import.meta.dirname, 'preload.cjs'),
    },
  })
  window.setMenuBarVisibility(false)
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(WINDOW_TITLE)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (backendUrl !== undefined && sameOrigin(url, backendUrl)) return
    event.preventDefault()
    openExternalUrl(url)
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
    showTrayHintOnce()
  })
  window.on('closed', () => { mainWindow = undefined })
  return window
}

async function wakeCompanion({ startupGreeting = false } = {}) {
  if (companionWindow !== undefined && !companionWindow.isDestroyed()) {
    companionWindow.showInactive()
    preferences.visible = true
    persistPreferences()
    broadcastDesktopState()
    return desktopState()
  }

  const placement = defaultCompanionPlacement()
  const bounds = resolveCompanionBounds(
    preferences,
    screen.getAllDisplays(),
    placement.display,
    placement.mainWindowBounds,
  )
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    title: '桌面小兢',
    icon: join(import.meta.dirname, 'assets', 'windows-icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(import.meta.dirname, 'preload.cjs'),
      additionalArguments: ['--xiaojing-companion'],
    },
  })
  companionWindow = window
  window.setMenuBarVisibility(false)
  window.setAlwaysOnTop(true, 'floating')
  window.setSkipTaskbar(true)
  window.setIgnoreMouseEvents(true, { forward: true })
  window.on('closed', () => {
    if (companionWindow === window) companionWindow = undefined
    dragState = undefined
    broadcastDesktopState()
  })
  window.webContents.on('did-finish-load', () => {
    if (window.isDestroyed()) return
    window.webContents.send(channels.changed, desktopState())
    window.showInactive()
  })
  await window.loadFile(
    join(import.meta.dirname, 'companion.html'),
    startupGreeting ? { query: { startupGreeting: '1' } } : undefined,
  )
  preferences.visible = true
  persistPreferences()
  updateTrayMenu()
  return desktopState()
}

function tuckCompanion() {
  preferences.visible = false
  persistPreferences()
  if (companionWindow !== undefined && !companionWindow.isDestroyed()) companionWindow.destroy()
  companionWindow = undefined
  updateTrayMenu()
  broadcastDesktopState()
  return desktopState()
}

function setCompanionScale(scale) {
  if (!isCompanionScale(scale)) throw new TypeError('desktop companion scale must be between 0.3 and 1')
  preferences.scale = scale
  persistPreferences()
  broadcastDesktopState()
  return desktopState()
}

async function resetCompanionPosition() {
  const placement = defaultCompanionPlacement()
  const bounds = defaultCompanionBounds(placement.display, placement.mainWindowBounds)
  preferences.position = { x: bounds.x, y: bounds.y, displayId: placement.display.id }
  persistPreferences()
  await wakeCompanion()
  companionWindow?.setBounds(bounds, false)
  persistCompanionPosition()
  return desktopState()
}

function createTray() {
  const image = nativeImage.createFromPath(join(import.meta.dirname, 'assets', 'windows-icon.png')).resize({ width: 24, height: 24 })
  tray = new Tray(image)
  tray.setToolTip(PRODUCT_NAME)
  tray.on('double-click', showMainWindow)
  updateTrayMenu()
}

function updateTrayMenu() {
  if (tray === undefined || tray.isDestroyed()) return
  const visible = companionWindow !== undefined && !companionWindow.isDestroyed()
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开小兢会计', click: showMainWindow },
    {
      label: visible ? '收起桌面小兢' : '唤醒桌面小兢',
      click: () => { if (visible) tuckCompanion(); else void wakeCompanion() },
    },
    { label: '重置桌面小兢位置', click: () => { void resetCompanionPosition() } },
    { type: 'separator' },
    { label: '退出小兢会计', click: () => { void requestQuit() } },
  ]))
}

function companionContextMenu() {
  return Menu.buildFromTemplate([
    { label: '打开小兢会计', click: showMainWindow },
    { label: '收起桌面小兢', click: tuckCompanion },
    { label: '重置桌面位置', click: () => { void resetCompanionPosition() } },
  ])
}

function registerDesktopIpc() {
  registerXiaojingDirectoryPicker({
    ipcMain,
    dialog,
    getWindow: () => mainWindow,
    defaultPath: xiaojingWorkspacePaths().office,
  })
  registerXiaojingOpenPath({ ipcMain, shell, getWindow: () => mainWindow })
  ipcMain.handle(channels.applicationInfo, () => ({ version: app.getVersion() }))
  ipcMain.handle(channels.state, () => desktopState())
  ipcMain.handle(channels.wake, () => wakeCompanion())
  ipcMain.handle(channels.tuck, () => tuckCompanion())
  ipcMain.handle(channels.reset, () => resetCompanionPosition())
  ipcMain.handle(channels.scale, (_event, scale) => setCompanionScale(scale))
  ipcMain.handle(channels.showMain, () => { showMainWindow() })
  ipcMain.on(channels.pointer, (event, interactive) => {
    if (!isCompanionSender(event) || typeof interactive !== 'boolean') return
    if (interactive) companionWindow?.setIgnoreMouseEvents(false)
    else companionWindow?.setIgnoreMouseEvents(true, { forward: true })
  })
  ipcMain.on(channels.dragStart, (event, point) => {
    if (!isCompanionSender(event) || !isScreenPoint(point) || companionWindow === undefined) return
    dragState = { pointer: point, bounds: companionWindow.getBounds() }
  })
  ipcMain.on(channels.dragMove, (event, point) => {
    if (!isCompanionSender(event) || !isScreenPoint(point) || dragState === undefined || companionWindow === undefined) return
    companionWindow.setPosition(
      Math.round(dragState.bounds.x + point.x - dragState.pointer.x),
      Math.round(dragState.bounds.y + point.y - dragState.pointer.y),
      false,
    )
  })
  ipcMain.on(channels.dragEnd, (event) => {
    if (!isCompanionSender(event)) return
    dragState = undefined
    persistCompanionPosition()
  })
  ipcMain.on(channels.contextMenu, (event) => {
    if (!isCompanionSender(event)) return
    companionContextMenu().popup({ window: companionWindow })
  })
}

function defaultCompanionPlacement() {
  const mainWindowBounds = mainWindow === undefined || mainWindow.isDestroyed()
    ? undefined
    : mainWindow.getBounds()
  return {
    mainWindowBounds,
    display: mainWindowBounds === undefined
      ? screen.getPrimaryDisplay()
      : screen.getDisplayMatching(mainWindowBounds),
  }
}

function isCompanionSender(event) {
  return companionWindow !== undefined && !companionWindow.isDestroyed()
    && event.sender === companionWindow.webContents
}

function isScreenPoint(value) {
  return typeof value === 'object' && value !== null && Number.isFinite(value.x) && Number.isFinite(value.y)
}

function desktopState() {
  return {
    available: true,
    visible: companionWindow !== undefined && !companionWindow.isDestroyed(),
    applicationReady,
    scale: preferences.scale,
    snapshot: { ...companionSnapshot },
  }
}

function broadcastDesktopState() {
  const state = desktopState()
  for (const window of [mainWindow, companionWindow]) {
    if (window !== undefined && !window.isDestroyed()) window.webContents.send(channels.changed, state)
  }
  updateTrayMenu()
}

function registerDisplayRecovery() {
  const recover = () => {
    if (companionWindow === undefined || companionWindow.isDestroyed()) return
    const current = companionWindow.getBounds()
    const bounds = resolveCompanionBounds(
      { ...preferences, position: { x: current.x, y: current.y, displayId: screen.getDisplayMatching(current).id } },
      screen.getAllDisplays(),
      screen.getPrimaryDisplay(),
    )
    companionWindow.setBounds(bounds, false)
    persistCompanionPosition()
  }
  screen.on('display-removed', recover)
  screen.on('display-metrics-changed', recover)
}

function persistCompanionPosition() {
  if (companionWindow === undefined || companionWindow.isDestroyed()) return
  const bounds = companionWindow.getBounds()
  const display = screen.getDisplayMatching(bounds)
  preferences.position = { x: bounds.x, y: bounds.y, displayId: display.id }
  persistPreferences()
}

function preferencesPath() {
  return join(app.getPath('userData'), 'desktop-companion', 'preferences-v1.json')
}

function readCompanionPreferences() {
  try {
    return normalizeCompanionPreferences(JSON.parse(readFileSync(preferencesPath(), 'utf8')))
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    return normalizeCompanionPreferences(undefined)
  }
}

function persistPreferences() {
  const content = `${JSON.stringify(preferences, null, 2)}\n`
  preferenceWrite = preferenceWrite.then(() => writeFileAtomic(preferencesPath(), content, {
    mode: COMPANION_PREFERENCES_MODE,
    dirMode: COMPANION_DIRECTORY_MODE,
  })).catch(error => {
    console.error('desktop companion: failed to persist preferences', error)
  })
}

function showTrayHintOnce() {
  if (preferences.trayHintShown) return
  preferences.trayHintShown = true
  persistPreferences()
  tray?.displayBalloon({
    title: '小兢会计仍在运行',
    content: '已最小化到系统托盘，后台任务和微信连接不会中断。',
    iconType: 'info',
  })
}

function showMainWindow() {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function requestQuit() {
  const risk = !companionStateReadable || companionSnapshot.activeTaskCount > 0 || companionSnapshot.weixinOnline
  if (risk) {
    const reasons = [
      ...(!companionStateReadable ? ['无法确认当前任务状态'] : []),
      ...(companionSnapshot.activeTaskCount > 0 ? [`仍有 ${companionSnapshot.activeTaskCount} 项任务在执行`] : []),
      ...(companionSnapshot.weixinOnline ? ['微信频道仍在线'] : []),
    ]
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '退出小兢会计',
      message: '退出会停止后台任务和微信连接。',
      detail: reasons.join('；'),
      buttons: ['取消', '仍然退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (result.response !== 1) return
  }
  quitting = true
  app.quit()
}

function startBackend() {
  const paths = backendPaths()
  if (!existsSync(paths.cli)) throw new Error(`找不到应用后端：${paths.cli}`)
  if (app.isPackaged && !existsSync(paths.node)) throw new Error(`找不到应用运行时：${paths.node}`)

  const dataRoot = join(app.getPath('userData'), 'harness')
  const { office: officeWorkspace, finance: financeWorkspace } = xiaojingWorkspacePaths()
  const logs = join(app.getPath('userData'), 'logs')
  mkdirSync(dataRoot, { recursive: true })
  mkdirSync(officeWorkspace, { recursive: true })
  mkdirSync(financeWorkspace, { recursive: true })
  mkdirSync(logs, { recursive: true })

  const log = createWriteStream(join(logs, 'backend.log'), { flags: 'a' })
  const environment = {
    ...process.env,
    DSH_CLIENT_BUILD_PROFILE: 'xiaojing',
    DSH_HOME: dataRoot,
    XIAOJING_OFFICE_WORKSPACE_ROOT: officeWorkspace,
    XIAOJING_FINANCE_WORKSPACE_ROOT: financeWorkspace,
    DSH_TELEMETRY_DISABLED: '1',
    ...(app.isPackaged ? { XIAOJING_EDGE_EXTENSION_DIR: join(process.resourcesPath, 'xiaojing-edge-extension') } : {}),
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1',
    NO_COLOR: '1',
  }
  // Desktop credentials are configured after launch in Settings. An inherited
  // process key would outrank the writable credential store and lock the field.
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === 'DEEPSEEK_API_KEY') delete environment[name]
  }

  backend = spawn(paths.node, [paths.cli, 'web', '--port', '0', '--no-open'], {
    cwd: officeWorkspace,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const consume = (chunk) => {
    const text = String(chunk)
    log.write(text)
    output = `${output}${text}`.slice(-16_384)
    const url = backendLaunchUrl(output)
    if (url !== undefined) void openApplication(url).catch(failBackend)
  }
  backend.stdout.on('data', consume)
  backend.stderr.on('data', consume)
  backend.once('error', error => failBackend(error))
  backend.once('exit', (code, signal) => {
    log.end()
    backend = undefined
    if (!quitting && backendUrl === undefined) {
      failBackend(new Error(`应用后端提前退出（code=${String(code)}, signal=${String(signal)}）`))
    }
  })
  startupTimer = setTimeout(() => { failBackend(new Error('应用后端启动超时，请查看日志后重试。')) }, BACKEND_READY_TIMEOUT_MS)
}

function xiaojingWorkspacePaths() {
  const root = join(app.getPath('documents'), '小兢会计工作区')
  return {
    office: join(root, '办公工作区'),
    finance: join(root, 'Finance工作区'),
  }
}

function backendPaths() {
  if (app.isPackaged) {
    return {
      node: join(process.resourcesPath, 'runtime', 'node.exe'),
      cli: join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    }
  }
  return {
    node: process.env.DSH_DESKTOP_NODE ?? 'node',
    cli: resolve(import.meta.dirname, '..', 'cli', 'lib', 'bin.js'),
  }
}

async function openApplication(url) {
  if (backendUrl !== undefined || mainWindow === undefined) return
  backendUrl = new URL(url).origin
  clearTimeout(startupTimer)
  const cookie = await backendSessionCookie(url)
  await mainWindow.loadURL(url)
  startCompanionStateStream(companionEventsUrl(url), cookie)
  mainWindow.setTitle(WINDOW_TITLE)
  applicationReady = true
  broadcastDesktopState()
}

function startCompanionStateStream(url, cookie) {
  companionStreamAbort?.abort()
  companionStreamAbort = new AbortController()
  void consumeCompanionStateStream(url, cookie, companionStreamAbort.signal)
}

async function consumeCompanionStateStream(url, cookie, signal) {
  while (!signal.aborted) {
    try {
      const response = await fetch(url, {
        signal,
        headers: { accept: 'text/event-stream', cookie },
      })
      if (!response.ok || response.body === null) throw new Error(`state stream returned ${response.status}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        buffer += decoder.decode(part.value, { stream: true }).replaceAll('\r\n', '\n')
        let split = buffer.indexOf('\n\n')
        while (split >= 0) {
          const frame = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          const payload = frame.split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')
          if (payload !== '') acceptCompanionSnapshot(payload)
          split = buffer.indexOf('\n\n')
        }
      }
    } catch (error) {
      if (signal.aborted) return
      console.error('desktop companion: state stream disconnected', error)
    }
    companionStateReadable = false
    broadcastDesktopState()
    await waitForRetry(signal)
  }
}

function acceptCompanionSnapshot(payload) {
  try {
    const next = JSON.parse(payload)
    if (!isCompanionSnapshot(next)) return
    companionSnapshot = next
    companionStateReadable = true
    broadcastDesktopState()
  } catch {
    // The local Host owns the stream schema; ignore an incomplete SSE frame and reconnect naturally.
  }
}

function waitForRetry(signal) {
  return new Promise(resolveRetry => {
    const timer = setTimeout(resolveRetry, COMPANION_STREAM_RETRY_MS)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolveRetry()
    }, { once: true })
  })
}

function failBackend(error) {
  clearTimeout(startupTimer)
  if (quitting) return
  quitting = true
  dialog.showErrorBox(
    `${PRODUCT_NAME} 启动失败`,
    `${error instanceof Error ? error.message : String(error)}\n\n日志目录：${join(app.getPath('userData'), 'logs')}`,
  )
  stopBackend()
  app.quit()
}

function stopBackend() {
  if (backend === undefined || backend.killed) return
  backend.kill()
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

function openExternalUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(parsed.href)
  } catch {
    // Ignore malformed URLs requested by page content.
  }
}

function showFatalError(error) {
  dialog.showErrorBox(
    `${PRODUCT_NAME} 启动失败`,
    `${error instanceof Error ? error.message : String(error)}\n\n发布方：${COMPANY_NAME}`,
  )
  app.quit()
}

app.on('activate', showMainWindow)
app.on('before-quit', () => {
  quitting = true
  clearTimeout(startupTimer)
  companionStreamAbort?.abort()
  tray?.destroy()
  stopBackend()
})
app.on('window-all-closed', () => {
  // The tray owns the application lifecycle after every window is hidden or tucked away.
})
