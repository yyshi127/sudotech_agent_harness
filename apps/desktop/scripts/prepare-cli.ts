/** Package terminal launch scripts that reuse the installed Electron runtime. */

import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { XIAOJING_IDENTITY } from '../src/xiaojing-product.ts'

/**
 * Prepare the public command for the packaged product's executable name.
 * @param destination - Physical runtime/cli directory prepared for the application.
 * @param platform - Target Desktop operating system.
 */
export function prepareDesktopCli(destination: string, platform: 'darwin' | 'win32'): void {
  const name = platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const command = join(destination, 'bin', name)
  mkdirSync(join(destination, 'bin'), { recursive: true })
  copyFileSync(join(import.meta.dirname, '..', 'cli', name), command)
  if (platform === 'win32') {
    const source = readFileSync(new URL('../cli/launch.mjs', import.meta.url), 'utf8')
    writeFileSync(join(destination, 'launch.mjs'), source.replace("'__DSH_DESKTOP_EXECUTABLE__'",
      JSON.stringify(`${XIAOJING_IDENTITY.executableName}.exe`)))
  } else {
    const source = readFileSync(command, 'utf8')
    writeFileSync(command, source.replace('__DSH_DESKTOP_EXECUTABLE__',
      XIAOJING_IDENTITY.productName.replaceAll("'", "'\\''")))
    chmodSync(command, 0o755)
  }
}
