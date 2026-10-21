/** Real Windows Shell discovery and invocation with a private extension and a private executable. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest'
import { nativeFileApplications, openNativeFileApplication } from '../src/file-applications.ts'
import { runNativeCommand, type NativeCommandRunner } from '../src/runner.ts'

/** Encode fixture data without placing its quotes or Unicode in executable PowerShell text. */
function literal(value: string): string {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value).toString('base64')}'))`
}

describe.skipIf(process.platform !== 'win32')('registered Windows file handler', () => {
  let root = ''
  const suffix = randomUUID().replaceAll('-', '')
  const extension = `.dsh${suffix}`
  const progId = `DSH.Test.${suffix}`
  const appName = `dsh-handler-${suffix}.exe`
  let executable: string
  let path: string
  let marker: string
  const lifetime = new AbortController()
  const active = new Set<Promise<Awaited<ReturnType<NativeCommandRunner>>>>()
  let phase = 'compile fixture'
  beforeEach(() => {
    onTestFailed(async () => {
      const opened = await readFile(marker, 'utf8').catch(() => '(no handoff marker)')
      console.error('Windows association fixture:', phase, 'active native commands:', active.size, opened)
    })
  })
  const run: NativeCommandRunner = (command, args, operationSignal, window) => {
    const pending = runNativeCommand(command, args, AbortSignal.any([operationSignal, lifetime.signal]), window)
    active.add(pending)
    void pending.then(() => active.delete(pending), () => active.delete(pending))
    return pending
  }
  const runScript = async (source: string): Promise<void> => {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], lifetime.signal, 'hidden')
  }
  afterAll(async () => {
    lifetime.abort()
    await Promise.allSettled([...active])
    try {
      await runNativeCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`
$root = [Microsoft.Win32.Registry]::CurrentUser
$root.DeleteSubKeyTree('Software\\Classes\\${extension}', $false)
$root.DeleteSubKeyTree('Software\\Classes\\${progId}', $false)
$root.DeleteSubKeyTree('Software\\Classes\\Applications\\${appName}', $false)
`, 'utf16le').toString('base64')], new AbortController().signal, 'hidden')
    } finally { if (root !== '') await rm(root, { recursive: true, force: true }) }
  })
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-windows-association-'))
    executable = join(root, appName)
    path = join(root, `${String.fromCharCode(0x6d4b, 0x8bd5)} ' audio${extension}`)
    marker = join(root, 'opened.txt')
    const pendingMarker = join(root, 'opened.pending')
    await writeFile(path, 'test')
    // A dedicated executable accepts the file directly; no pre-existing Node association can discard fixture-script arguments.
    await runScript(`$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System -OutputAssembly (${literal(executable)}) -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
using System.Diagnostics;
public static class Handler {
  public static void Main(string[] args) {
    // Readers can open the marker only after both lines have been written and the handle is closed.
    File.WriteAllLines(${JSON.stringify(pendingMarker)}, new string[] { args.Length == 0 ? "(no file argument)" : args[0], Process.GetCurrentProcess().Id.ToString() });
    File.Move(${JSON.stringify(pendingMarker)}, ${JSON.stringify(marker)});
  }
}
'@
`)
    phase = 'verify fixture executable'
    await run(executable, [path], lifetime.signal, 'hidden')
    expect((await readFile(marker, 'utf8')).split(/\r?\n/)[0]).toBe(path)
    await rm(marker)
    phase = 'register association'
    const command = literal(`"${executable}" "%1"`)
    await runScript(`$ErrorActionPreference = 'Stop'
$root = [Microsoft.Win32.Registry]::CurrentUser
$key = $root.CreateSubKey('Software\\Classes\\${extension}')
$key.SetValue('', '${progId}'); $key.Dispose()
$key = $root.CreateSubKey('Software\\Classes\\${extension}\\OpenWithProgids')
$key.SetValue('${progId}', ''); $key.Dispose()
$key = $root.CreateSubKey('Software\\Classes\\${progId}\\shell\\open\\command')
$key.SetValue('', ${command}); $key.Dispose()
$key = $root.CreateSubKey('Software\\Classes\\Applications\\${appName}\\shell\\open\\command')
$key.SetValue('', ${command}); $key.Dispose()
$key = $root.CreateSubKey('Software\\Classes\\Applications\\${appName}\\SupportedTypes')
$key.SetValue('${extension}', ''); $key.Dispose()
`)
  })

  it('queries a registered handler through the system Shell', async ({ signal }) => {
    phase = 'query associations'
    const applications = await nativeFileApplications(path, signal, { run })
    const expected = applications.find(app => app.id.toLowerCase() === executable.toLowerCase())
    expect(expected).toMatchObject({ default: true, name: expect.any(String) as string })
  })

  it('invokes a registered handler through the system Shell', async ({ task, signal }) => {
    phase = 'invoke handler'
    await openNativeFileApplication(path, executable, signal, { run })
    phase = 'wait for fixture marker'
    let opened: string[] = []
    await vi.waitUntil(async () => {
      signal.throwIfAborted()
      try { opened = (await readFile(marker, 'utf8')).trim().split(/\r?\n/) } catch (_error) { return false }
      return true
    }, { timeout: task.timeout })
    // Windows Shell can expand an 8.3 input path to its long spelling.
    expect(await realpath(opened[0]!)).toBe(await realpath(path))
    const pid = Number(opened[1])
    expect(pid).toBeGreaterThan(0)
    phase = 'wait for fixture exit'
    await vi.waitUntil(() => {
      signal.throwIfAborted()
      try { process.kill(pid, 0); return false } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') return true
        throw error
      }
    }, { timeout: task.timeout })
  })
})
