/** Real console events reach asynchronous JavaScript shutdown in Electron Node mode. */

import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prepareDesktopCli } from '../scripts/prepare-cli.ts'
import { XIAOJING_IDENTITY } from '../src/xiaojing-product.ts'

const execute = promisify(execFile)
const require = createRequire(import.meta.url)
let root: string | undefined
let probe: string
let electron: string
let entry: string
let primaryNode: string
let bridge: string

describe.skipIf(process.platform !== 'win32')('Windows Electron console signals', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-cli-console-'))
    electron = require('electron') as string
    const programFiles = process.env['ProgramFiles(x86)']
    if (programFiles === undefined || process.env.ComSpec === undefined) throw new Error('Windows compiler environment is unavailable')
    const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    const vs = (await execute(vswhere, ['-latest', '-products', '*', '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { windowsHide: true })).stdout.trim()
    const quote = (value: string) => '"' + value.replaceAll('%', '%%') + '"'
    probe = join(root, 'console-probe.exe')
    const compile = join(root, 'compile.cmd')
    await writeFile(compile, ['@echo off', 'chcp 65001 >nul', 'call ' + quote(join(vs, 'VC/Auxiliary/Build/vcvars64.bat')) + ' >nul',
      'if errorlevel 1 exit /b %errorlevel%',
      'cl /nologo /std:c++17 /EHsc /MT /W4 /WX ' + quote(join(import.meta.dirname, 'fixtures/cli-console-probe.cpp'))
        + ' /Fo' + quote(join(root, 'console.obj')) + ' /Fe' + quote(probe), '',
    ].join('\r\n'))
    await execute(process.env.ComSpec, ['/d', '/v:off', '/c', compile], { windowsHide: true })
    // Only TypeScript is erased; the child has no source-loader hook that could change signal handling.
    const source = await readFile(new URL('../../desktop-host/src/windows-cli-signals.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
      .replace(/(['"])koffi\1/u, JSON.stringify(pathToFileURL(require.resolve('koffi')).href))
    await writeFile(join(root, 'signals.mjs'), code)
    entry = join(root, 'entry.mjs')
    await writeFile(entry, [
      "import { writeFileSync } from 'node:fs'",
      "import { writeFile } from 'node:fs/promises'",
      "import { installWindowsCliSignals } from './signals.mjs'",
      'await installWindowsCliSignals()',
      'const [marker, ready] = process.argv.slice(2)',
      "if (marker.endsWith('no-console.txt')) {",
      `  const { default: koffi } = await import(${JSON.stringify(pathToFileURL(require.resolve('koffi')).href)})`,
      "  const kernel = koffi.load('kernel32.dll')",
      "  const codePage = kernel.func('uint32_t __stdcall GetConsoleCP()')()",
      "  writeFileSync(ready, 'ready'); writeFileSync(marker, JSON.stringify({ codePage })); process.exit(0)",
      '}',
      "for (const [signal, code] of [['SIGINT',130],['SIGBREAK',131]]) process.on(signal, async () => {",
      '  await writeFile(marker, signal); process.exit(code)',
      '})',
      "writeFileSync(ready, 'ready')",
      'setInterval(() => {}, 1000)', '',
    ].join('\n'))
    const application = join(root, 'Application 中文 with spaces')
    await cp(dirname(electron), application, { recursive: true })
    await rename(join(application, basename(electron)), join(application, `${XIAOJING_IDENTITY.executableName}.exe`))
    const resources = join(application, 'resources')
    const cli = join(resources, 'runtime', 'cli')
    prepareDesktopCli(cli, 'win32')
    primaryNode = join(resources, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe')
    await mkdir(dirname(primaryNode), { recursive: true })
    await copyFile(process.execPath, primaryNode)
    bridge = join(cli, 'launch.mjs')
    const forwardedEntry = join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
    await mkdir(dirname(forwardedEntry), { recursive: true })
    await copyFile(entry, forwardedEntry)
    await copyFile(join(root, 'signals.mjs'), join(dirname(forwardedEntry), 'signals.mjs'))
    await writeFile(join(dirname(forwardedEntry), 'package.json'), '{"type":"module"}\n')
  })

  afterAll(async () => {
    if (root === undefined) return
    await chmod(root, 0o700)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it.each([
    ['direct', 'SIGINT', '0'], ['direct', 'SIGBREAK', '1'],
    ['bridge', 'SIGINT', '0'], ['bridge', 'SIGBREAK', '1'],
  ] as const)('%s delivers %s before process exit without changing console encoding', async (mode, signal, event) => {
    if (root === undefined) throw new Error('Console fixture is not prepared')
    const marker = join(root, mode + signal + '.txt')
    const ready = join(root, mode + signal + '.ready')
    const report = join(root, mode + signal + '.report')
    let failure: unknown
    try { await execute(probe, [mode === 'direct' ? electron : primaryNode,
      mode === 'direct' ? entry : bridge, marker, ready, report, event], { windowsHide: true }) }
    catch (error) { failure = error }
    const observed = existsSync(report) ? await readFile(report, 'utf8') : 'Console probe exited before reporting.'
    expect(failure, observed).toBeUndefined()
    expect(observed).toContain('inputCodePage=437 outputCodePage=437')
    expect(await readFile(marker, 'utf8')).toBe(signal)
  }, 20_000)

  it('keeps the installed bridge usable when the caller has no console', async () => {
    if (root === undefined) throw new Error('Console fixture is not prepared')
    const marker = join(root, 'no-console.txt')
    const ready = join(root, 'no-console.ready')
    const report = join(root, 'no-console.report')
    await execute(probe, [primaryNode, bridge, marker, ready, report, 'none'], { windowsHide: true })
    expect(await readFile(marker, 'utf8')).toMatch(/^\{"codePage":\d+\}$/u)
    expect(await readFile(report, 'utf8')).toContain('inputCodePage=0 outputCodePage=0')
  }, 20_000)
})
