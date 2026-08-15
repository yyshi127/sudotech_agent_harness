import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, session, shell } from 'electron'

const PRODUCT_NAME = '小兢会计-您的AI办公搭子'
const COMPANY_NAME = '瑞华云数豆科技'
const BACKEND_READY_TIMEOUT_MS = 60_000

let backend
let backendUrl
let mainWindow
let quitting = false
let startupTimer

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(startDesktop).catch(showFatalError)
}

async function startDesktop() {
  app.setName(PRODUCT_NAME)
  app.setAppUserModelId('com.sudotech.xiaojing-accounting')

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  mainWindow = createMainWindow()
  await mainWindow.loadFile(join(import.meta.dirname, 'loading.html'))
  mainWindow.show()
  startBackend()
}

function createMainWindow() {
  const icon = join(import.meta.dirname, 'assets', 'app-icon.png')
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: PRODUCT_NAME,
    icon,
    autoHideMenuBar: true,
    backgroundColor: '#f8fbfa',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#63706c',
      height: 40,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (backendUrl !== undefined && sameOrigin(url, backendUrl)) return
    event.preventDefault()
    openExternalUrl(url)
  })
  window.on('closed', () => {
    mainWindow = undefined
  })
  return window
}

function startBackend() {
  const paths = backendPaths()
  if (!existsSync(paths.cli)) {
    throw new Error(`找不到应用后端：${paths.cli}`)
  }
  if (app.isPackaged && !existsSync(paths.node)) {
    throw new Error(`找不到应用运行时：${paths.node}`)
  }

  const dataRoot = join(app.getPath('userData'), 'harness')
  const workspace = join(app.getPath('documents'), '小兢会计工作区')
  const logs = join(app.getPath('userData'), 'logs')
  mkdirSync(dataRoot, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  mkdirSync(logs, { recursive: true })

  const log = createWriteStream(join(logs, 'backend.log'), { flags: 'a' })
  const environment = {
    ...process.env,
    DSH_HOME: dataRoot,
    DSH_TELEMETRY_DISABLED: '1',
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1',
    NO_COLOR: '1',
  }
  // Desktop credentials are configured after launch in Settings. An inherited
  // process key would outrank the writable credential store and lock the field.
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === 'DEEPSEEK_API_KEY') delete environment[name]
  }

  backend = spawn(paths.node, [paths.cli, 'web', '--port', '0'], {
    cwd: workspace,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const consume = (chunk) => {
    const text = String(chunk)
    log.write(text)
    output = `${output}${text}`.slice(-16_384)
    const match = output.match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/)
    if (match?.[1] !== undefined) openApplication(match[1])
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

  startupTimer = setTimeout(() => {
    failBackend(new Error('应用后端启动超时，请查看日志后重试。'))
  }, BACKEND_READY_TIMEOUT_MS)
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
  backendUrl = url
  clearTimeout(startupTimer)
  await mainWindow.loadURL(url)
  await mainWindow.webContents.insertCSS(`
    body::before {
      content: '';
      position: fixed;
      z-index: 2147483647;
      top: 0;
      left: 380px;
      right: 140px;
      height: 40px;
      -webkit-app-region: drag;
      pointer-events: auto;
    }
    button, a, input, textarea, select, [role='button'], [role='menuitem'] {
      -webkit-app-region: no-drag;
    }
    [class*='_headerUtilities'] {
      margin-right: 138px;
    }
  `)
  mainWindow.setTitle(PRODUCT_NAME)
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
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      void shell.openExternal(parsed.href)
    }
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

app.on('before-quit', () => {
  quitting = true
  clearTimeout(startupTimer)
  stopBackend()
})

app.on('window-all-closed', () => {
  app.quit()
})
