/** Xiaojing product identity, durable paths, and Host launch environment. */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { App } from 'electron'

interface XiaojingIdentity {
  readonly packageName: string
  readonly productVersion: string
  readonly appId: string
  readonly nsisGuid: string
  readonly installDirectoryName: string
  readonly executableName: string
  readonly productName: string
  readonly installScope: 'currentUser'
  readonly shortcutName: string
  readonly userDataSegments: readonly string[]
}

function readIdentity(): XiaojingIdentity {
  const value: unknown = JSON.parse(readFileSync(new URL('../identity.json', import.meta.url), 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('xiaojing desktop: invalid identity manifest')
  }
  const row = value as Record<string, unknown>
  const userDataSegments = row.userDataSegments
  if (typeof row.packageName !== 'string' || typeof row.productVersion !== 'string' || typeof row.appId !== 'string'
    || typeof row.nsisGuid !== 'string' || typeof row.installDirectoryName !== 'string'
    || typeof row.executableName !== 'string' || typeof row.productName !== 'string'
    || row.installScope !== 'currentUser' || typeof row.shortcutName !== 'string'
    || !Array.isArray(userDataSegments) || userDataSegments.length === 0
    || userDataSegments.some(segment => typeof segment !== 'string' || segment.length === 0)) {
    throw new Error('xiaojing desktop: invalid identity manifest fields')
  }
  return {
    packageName: row.packageName,
    productVersion: row.productVersion,
    appId: row.appId,
    nsisGuid: row.nsisGuid,
    installDirectoryName: row.installDirectoryName,
    executableName: row.executableName,
    productName: row.productName,
    installScope: row.installScope,
    shortcutName: row.shortcutName,
    userDataSegments,
  }
}

/** Permanent Xiaojing installer and application identity. */
export const XIAOJING_IDENTITY = Object.freeze(readIdentity())

/** Installer-only request sent to an existing process before replacing application files. */
export const XIAOJING_UPDATE_SHUTDOWN_ARGUMENT = '--xiaojing-shutdown-for-update'

/** Xiaojing application-owned data and workspace paths. */
export interface XiaojingDesktopPaths {
  readonly userData: string
  readonly dshHome: string
  readonly workspaceRoot: string
  readonly officeWorkspace: string
  readonly financeWorkspace: string
}

/**
 * Pin Xiaojing's permanent data paths before claiming the single-instance lock.
 * Unpackaged previews may redirect both application data and Documents into an isolated directory.
 * @param application - Electron application singleton before `ready`.
 * @param environment - Process environment containing the optional preview root.
 * @returns Resolved paths shared by the main process and Host child.
 */
export function initializeXiaojingApplication(
  application: Pick<App, 'isPackaged' | 'getPath' | 'setPath' | 'setName' | 'setAppUserModelId'>,
  environment: NodeJS.ProcessEnv = process.env,
): XiaojingDesktopPaths {
  const previewRoot = !application.isPackaged ? environment.DSH_DESKTOP_PREVIEW_ROOT?.trim() : undefined
  if (previewRoot !== undefined && previewRoot !== '') {
    const root = resolve(previewRoot)
    const appData = join(root, 'app-data')
    const documents = join(root, 'documents')
    mkdirSync(appData, { recursive: true })
    mkdirSync(documents, { recursive: true })
    application.setPath('appData', appData)
    application.setPath('documents', documents)
  }

  const userData = join(application.getPath('appData'), ...XIAOJING_IDENTITY.userDataSegments)
  application.setPath('userData', userData)
  application.setName(XIAOJING_IDENTITY.productName)
  application.setAppUserModelId(XIAOJING_IDENTITY.appId)
  const workspaceRoot = join(application.getPath('documents'), '小兢会计工作区')
  const paths = {
    userData,
    dshHome: join(userData, 'harness'),
    workspaceRoot,
    officeWorkspace: join(workspaceRoot, '办公工作区'),
    financeWorkspace: join(workspaceRoot, 'Finance工作区'),
  }
  for (const path of [paths.userData, paths.dshHome, paths.officeWorkspace, paths.financeWorkspace]) {
    mkdirSync(path, { recursive: true })
  }
  environment.DSH_HOME = paths.dshHome
  return paths
}

/**
 * Build the Xiaojing Host environment without inheriting a process API key that would mask writable credentials.
 * @param application - Electron packaging state used to locate the bundled Edge extension.
 * @param paths - Product data and workspace paths.
 * @param environment - Ambient environment copied for the child process.
 * @returns Host environment with Xiaojing composition and durable roots selected.
 */
export function xiaojingHostEnvironment(
  application: Pick<App, 'isPackaged'>,
  paths: XiaojingDesktopPaths,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...environment,
    DSH_CLIENT_BUILD_PROFILE: 'xiaojing',
    DSH_HOME: paths.dshHome,
    XIAOJING_OFFICE_WORKSPACE_ROOT: paths.officeWorkspace,
    XIAOJING_FINANCE_WORKSPACE_ROOT: paths.financeWorkspace,
    DSH_TELEMETRY_DISABLED: '1',
    XIAOJING_EDGE_EXTENSION_DIR: application.isPackaged
      ? join(process.resourcesPath, 'xiaojing-edge-extension')
      : resolve(import.meta.dirname, '..', '..', '..', 'packages', 'xiaojing', 'xiaojing-browser-control', 'extension'),
    NODE_USE_ENV_PROXY: environment.NODE_USE_ENV_PROXY ?? '1',
    NO_COLOR: '1',
  }
  for (const name of Object.keys(result)) {
    if (name.toUpperCase() === 'DEEPSEEK_API_KEY') Reflect.deleteProperty(result, name)
  }
  return result
}

/**
 * Refuse an unpackaged preview whose shared Client artifacts were built for another product.
 * Packaged runtimes were checked during preparation and do not carry the repository record.
 * @param repositoryRoot - Repository root containing `.dsh-build/client-build-environment.json`.
 * @param packaged - Whether Electron is running a packaged application.
 */
export function assertXiaojingDesktopClientBuild(repositoryRoot: string, packaged: boolean): void {
  if (packaged) return
  const recordPath = join(repositoryRoot, '.dsh-build', 'client-build-environment.json')
  if (!existsSync(recordPath)) {
    throw new Error('缺少小兢会计前端构建记录，请先运行 pnpm run build:xiaojing。')
  }
  let record: unknown
  try { record = JSON.parse(readFileSync(recordPath, 'utf8')) }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`小兢会计前端构建记录无效，请重新运行 pnpm run build:xiaojing：${detail}`)
  }
  if (typeof record !== 'object' || record === null || !('environment' in record)
    || typeof record.environment !== 'object' || record.environment === null
    || !('DSH_CLIENT_BUILD_PROFILE' in record.environment)
    || record.environment.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing') {
    throw new Error('当前前端产物不是小兢会计版本，请运行 pnpm run build:xiaojing 后再启动桌面预览。')
  }
}

/** Return whether an application invocation asks the running Xiaojing process to exit for an in-place update. */
export function isXiaojingUpdateShutdown(argv: readonly string[]): boolean {
  return argv.includes(XIAOJING_UPDATE_SHUTDOWN_ARGUMENT)
}
