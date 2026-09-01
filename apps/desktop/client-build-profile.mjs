import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUILD_RECORD = join('.dsh-build', 'client-build-environment.json')

/**
 * Refuse an unpackaged desktop preview whose shared browser artifacts were not
 * built for Xiaojing Accounting.
 *
 * Packaged applications are checked before electron-builder runs and do not
 * carry the repository build record. Source previews share the repository's
 * mutable Client output, so checking before any window opens prevents a plain
 * root build from silently presenting the official Harness interface.
 *
 * @param {string} repositoryRoot - Repository root containing `.dsh-build`.
 * @param {boolean} packaged - Whether Electron is running a packaged build.
 * @returns {void}
 */
export function assertXiaojingDesktopClientBuild(repositoryRoot, packaged) {
  if (packaged) return

  const recordPath = join(repositoryRoot, BUILD_RECORD)
  if (!existsSync(recordPath)) {
    throw new Error('缺少小兢会计前端构建记录，请先运行 pnpm run build:xiaojing。')
  }

  let record
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`小兢会计前端构建记录无效，请重新运行 pnpm run build:xiaojing：${detail}`)
  }

  if (record?.environment?.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing') {
    throw new Error('当前前端产物不是小兢会计版本，请运行 pnpm run build:xiaojing 后再启动桌面预览。')
  }
}
