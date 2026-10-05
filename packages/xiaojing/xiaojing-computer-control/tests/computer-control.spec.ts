import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { PassThrough, Writable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, onTestFailed, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import ComputerControl, { parseComputerResult, type ComputerWindowId } from '../src/index.ts'
import { WINDOWS_UIA_HELPER } from '../src/helper-script.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

describe('computer helper result validation', () => {
  it('accepts the canonical result and rejects malformed process data', () => {
    expect(parseComputerResult({
      action: 'list_windows',
      summary: 'ok',
      appName: 'Notepad',
      apps: [{ id: 'a1', name: 'Notepad' }],
      windows: [{ id: 'w1', title: 'One', processId: 42 }],
    })).toEqual({
      action: 'list_windows',
      summary: 'ok',
      appName: 'Notepad',
      apps: [{ id: 'a1', name: 'Notepad' }],
      windows: [{ id: 'w1', title: 'One', processId: 42 }],
    })
    expect(() => parseComputerResult({ action: 'unknown', summary: 'bad' })).toThrow(/invalid result/u)
    expect(() => parseComputerResult({
      action: 'list_windows', summary: 'bad', windows: [{ id: 'w', title: 'x', processId: 'no' }],
    })).toThrow(/invalid window/u)
    expect(() => parseComputerResult({
      action: 'list_apps', summary: 'bad', apps: [{ id: 'a', name: 42 }],
    })).toThrow(/invalid application/u)
  })
})

const windowsIt = process.platform === 'win32' ? it : it.skip

describe('Windows UI Automation provider', () => {
  windowsIt('rejects cancellation during helper startup without dispatching that request', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const subprocess = await ctx.plugin(LocalSubprocess)
    cleanup.push(() => subprocess.dispose())
    const executableEntered = Promise.withResolvers<undefined>()
    const executableResolved = Promise.withResolvers<string>()
    const resolveExecutable = vi.spyOn(ctx.subprocess, 'resolveExecutable').mockImplementation(async () => {
      executableEntered.resolve(undefined)
      return await executableResolved.promise
    })
    cleanup.push(async () => { resolveExecutable.mockRestore() })
    const done = Promise.withResolvers<SubprocessOutcome>()
    const stdout = new PassThrough()
    const dispatched: string[] = []
    const stdin = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        const line = chunk.toString()
        dispatched.push(line)
        const request: unknown = JSON.parse(line)
        if (typeof request !== 'object' || request === null || !('id' in request) || typeof request.id !== 'string') {
          callback(new Error('owned helper received a request without an id'))
          return
        }
        const requestId = request.id
        queueMicrotask(() => {
          stdout.write(JSON.stringify({
            id: requestId, ok: true,
            result: { action: 'list_windows', summary: 'Owned fake helper response', windows: [], truncated: false },
          }) + '\n')
        })
        callback()
      },
    })
    const terminate = vi.fn(() => {
      stdin.end()
      stdout.end()
      done.resolve({ exitCode: 0, signal: null })
    })
    const helper: SubprocessHandle = {
      stdin, stdout, stderr: undefined, control: undefined, collected: {}, done: done.promise,
      terminate,
      waitForExit: async () => { await done.promise; return true },
    }
    const spawnHelper = vi.spyOn(ctx.subprocess, 'spawn').mockReturnValue(helper)
    cleanup.push(async () => { spawnHelper.mockRestore() })
    const fiber = await ctx.plugin(ComputerControl, {})
    cleanup.push(() => fiber.dispose())
    const stopped = new AbortController()
    const reason = new Error('owned cancellation while resolving helper executable')
    const owner = SessionId('owned-startup-cancellation')
    const operation = ctx.xiaojingComputerControl.run(owner, { action: 'list_windows' }, stopped.signal)
    await executableEntered.promise
    stopped.abort(reason)
    executableResolved.resolve('owned-fake-powershell.exe')
    const facts = { aborted: stopped.signal.aborted, dispatched }
    onTestFailed(() => { console.error('UIA_STARTUP_CANCELLATION_FACTS', JSON.stringify(facts)) })
    await expect(operation).rejects.toBe(reason)
    expect(dispatched).toEqual([])
    expect(spawnHelper).toHaveBeenCalledOnce()
    expect(spawnHelper).toHaveBeenCalledWith(expect.objectContaining({ windowsChildLifetime: 'independent' }))
    expect(terminate).not.toHaveBeenCalled()
    const fresh = await ctx.xiaojingComputerControl.run(owner, { action: 'list_windows' }, new AbortController().signal)
    expect(fresh.windows).toEqual([])
    expect(dispatched).toHaveLength(1)
    expect(spawnHelper).toHaveBeenCalledOnce()
    await ctx.xiaojingComputerControl.close()
    expect(terminate).toHaveBeenCalledOnce()
    await expect(helper.waitForExit()).resolves.toBe(true)
  })

  windowsIt('bounds top-level window listings', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocess)
    const fiber = await ctx.plugin(ComputerControl, { maxWindows: 1 })
    cleanup.push(() => fiber.dispose())

    const listed = await ctx.xiaojingComputerControl.run(
      SessionId('bounded-window-list'),
      { action: 'list_windows' },
      new AbortController().signal,
    )
    expect(listed.windows?.length).toBeLessThanOrEqual(1)
    expect(typeof listed.truncated).toBe('boolean')
  }, 15_000)

  windowsIt('lists, observes, edits, and invokes a native WinForms fixture', async () => {
    const title = `Xiaojing UIA Fixture ${String(process.pid)}`
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $form = New-Object System.Windows.Forms.Form
      $form.Text = '${title}'
      $form.Width = 420
      $form.Height = 240
      $input = New-Object System.Windows.Forms.TextBox
      $input.Name = 'InputBox'
      $input.AccessibleName = 'Fixture Input'
      $input.Left = 20
      $input.Top = 20
      $input.Width = 250
      # This fixture exercises ValuePattern and InvokePattern, not physical keyboard input.
      $input.Add_KeyPress({
        $args[1].Handled = $true
        [Console]::Out.WriteLine('FIXTURE_INPUT_BLOCKED|' + [int]$args[1].KeyChar)
        [Console]::Out.Flush()
      })
      $form.Add_Shown({
        [Console]::Out.WriteLine('FIXTURE_SHOWN|' + $PID + '|' + $this.Handle.ToInt64())
        [Console]::Out.Flush()
      })
      $button = New-Object System.Windows.Forms.Button
      $button.Text = 'Apply Fixture'
      $button.Left = 20
      $button.Top = 70
      $delete = New-Object System.Windows.Forms.Button
      $delete.Text = 'Delete Fixture'
      $delete.Left = 160
      $delete.Top = 70
      $label = New-Object System.Windows.Forms.Label
      $label.Name = 'ResultLabel'
      $label.Text = 'Waiting'
      $label.Left = 20
      $label.Top = 120
      $button.Add_Click({
        $window = $this.FindForm()
        $window.Controls['ResultLabel'].Text = 'Applied ' + $window.Controls['InputBox'].Text
      })
      $delete.Add_Click({
        $window = $this.FindForm()
        $window.Controls['ResultLabel'].Text = 'Deleted Fixture'
      })
      $form.Controls.AddRange(@($input, $button, $delete, $label))
      [void]$form.ShowDialog()
    `
    const fixture = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
    ], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let fixtureOutput = ''
    fixture.stdout?.on('data', (chunk: Buffer) => { fixtureOutput += chunk.toString('utf8') })
    let fixtureErrors = ''
    fixture.stderr?.on('data', (chunk: Buffer) => { fixtureErrors += chunk.toString('utf8') })
    onTestFailed(() => { console.error(`WinForms fixture exit=${String(fixture.exitCode)}: ${fixtureErrors}\n${fixtureOutput}`) })
    cleanup.push(async () => {
      if (fixture.exitCode !== null) return
      fixture.kill()
      await new Promise<void>((resolve) => {
        fixture.once('exit', () => { resolve() })
      })
    })

    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService, { policy: 'never' })
    const subprocess = await ctx.plugin(LocalSubprocess)
    cleanup.push(() => subprocess.dispose())
    await vi.waitFor(() => { expect(fixtureOutput).toContain('FIXTURE_SHOWN') }, { timeout: 10_000 })
    const fixtureIdentity = /FIXTURE_SHOWN\|(\d+)\|(\d+)/u.exec(fixtureOutput)
    if (fixtureIdentity === null || fixtureIdentity[1] !== String(fixture.pid)) {
      throw new Error('owned WinForms fixture identity was not reported')
    }
    const waitEntered = Promise.withResolvers<undefined>()
    const valueEntered = Promise.withResolvers<SubprocessHandle>()
    const managedSpawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    const monitor = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const enumeration = new RegExp([
        String.raw`\$windows = \[System\.Windows\.Automation\.AutomationElement\]::RootElement\.FindAll\(\s*`,
        String.raw`\[System\.Windows\.Automation\.TreeScope\]::Children,\s*`,
        String.raw`\[System\.Windows\.Automation\.Condition\]::TrueCondition\s*\)`,
      ].join(''), 'gu')
      expect([...WINDOWS_UIA_HELPER.matchAll(enumeration)]).toHaveLength(3)
      let source = WINDOWS_UIA_HELPER.replace(enumeration, `$ownedCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]${String(fixture.pid)})
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $ownedCondition)
  foreach ($ownedWindow in $windows) {
    if ($ownedWindow.Current.NativeWindowHandle -ne ${fixtureIdentity[2]}) { throw 'owned fixture HWND changed' }
  }`)
      source = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OwnedFixtureInput {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
'@\n${source}`
      const setValue = '$pattern.SetValue([string]$Value)'
      expect(source).toContain(setValue)
      source = source.replace(setValue, `${setValue}
  if ($Element.Current.ProcessId -ne ${String(fixture.pid)}) { throw 'owned input PID changed' }
  [Console]::Error.WriteLine('OWNED_UIA_VALUE_ENTERED')
  [Console]::Error.Flush()
  if ([Console]::In.ReadLine() -ne '__OWNED_INJECT_CHARACTER__') { throw 'owned input barrier token invalid' }
  [void][OwnedFixtureInput]::SendMessage([IntPtr]$Element.Current.NativeWindowHandle, 0x0102, [IntPtr]115, [IntPtr]1)`)
      const query = '$found = $script:currentWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)'
      expect(source).toContain(query)
      source = source.replace(query, `${query}
    if ($Text -eq '__XIAOJING_NEVER_APPEARS__') {
      [Console]::Error.WriteLine('OWNED_UIA_WAIT_ENTERED')
      [Console]::Error.Flush()
    }`)
      const compressed = gzipSync(Buffer.from(source, 'utf8')).toString('base64')
      const bootstrap = `$b=[Convert]::FromBase64String('${compressed}');$m=New-Object IO.MemoryStream(,$b);$g=New-Object IO.Compression.GzipStream($m,[IO.Compression.CompressionMode]::Decompress);$r=New-Object IO.StreamReader($g,[Text.Encoding]::UTF8);$s=$r.ReadToEnd();$r.Dispose();$g.Dispose();$m.Dispose();& ([ScriptBlock]::Create($s))`
      const argv = [...spec.argv]
      argv[argv.length - 1] = Buffer.from(bootstrap, 'utf16le').toString('base64')
      const helper = managedSpawn({ ...spec, argv, stdio: { ...spec.stdio, stderr: 'pipe' } })
      let helperErrors = ''
      helper.stderr?.on('data', (chunk: Buffer) => {
        helperErrors += chunk.toString('utf8')
        if (helperErrors.includes('OWNED_UIA_VALUE_ENTERED')) valueEntered.resolve(helper)
        if (helperErrors.includes('OWNED_UIA_WAIT_ENTERED')) waitEntered.resolve(undefined)
      })
      return helper
    })
    cleanup.push(async () => { monitor.mockRestore() })
    const fiber = await ctx.plugin(ComputerControl, {
      requestTimeoutMs: 10_000,
      maxWaitMs: 5_000,
    })
    cleanup.push(() => fiber.dispose())
    const signal = new AbortController().signal
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')

    await expect(ctx.xiaojingComputerControl.run(sessionA, {
      action: 'list_apps', query: 'Microsoft Edge',
    }, signal)).rejects.toThrow(/excluded.*connected browser tools/u)
    const applications = await ctx.xiaojingComputerControl.run(sessionA, {
      action: 'list_apps', query: 'PowerShell',
    }, signal)
    const powershell = applications.apps?.find(app => app.name === 'Windows PowerShell')
    expect(powershell).toBeDefined()
    if (powershell === undefined) throw new Error('Windows PowerShell was not discovered in the application catalog')
    expect(() => ctx.xiaojingComputerControl.approvalReason(sessionB, {
      action: 'launch_app', appId: powershell.id,
    })).toThrow(/another session/u)
    expect(ctx.xiaojingComputerControl.approvalReason(sessionA, {
      action: 'launch_app', appId: powershell.id,
    })).toMatch(/high-impact/u)

    let windowId: ComputerWindowId | undefined
    const deadline = Date.now() + 10_000
    while (windowId === undefined && Date.now() < deadline) {
      const listed = await ctx.xiaojingComputerControl.run(sessionA, { action: 'list_windows' }, signal)
      windowId = listed.windows?.find(window => window.title === title)?.id
      if (windowId === undefined) await new Promise(resolve => setTimeout(resolve, 100))
    }
    expect(windowId).toBeDefined()
    if (windowId === undefined) throw new Error('WinForms fixture window was not discovered')
    await expect(ctx.xiaojingComputerControl.run(sessionB, { action: 'observe', windowId }, signal))
      .rejects.toThrow(/another session/u)
    const observed = await ctx.xiaojingComputerControl.run(sessionA, { action: 'observe', windowId }, signal)
    const input = observed.targets?.find(target => target.name === 'Fixture Input')
    expect(input?.actions).toContain('set_value')
    if (observed.observationId === undefined || input === undefined) throw new Error('WinForms fixture input was not observed')
    const setting = ctx.xiaojingComputerControl.run(sessionA, {
      action: 'set_value', observationId: observed.observationId, targetId: input.id, value: 'Ada',
    }, signal)
    const valueHelper = await valueEntered.promise
    if (valueHelper.stdin === undefined) throw new Error('owned value helper has no input stream')
    valueHelper.stdin.write('__OWNED_INJECT_CHARACTER__\n')
    const edited = await setting
    expect(fixtureOutput).toContain('FIXTURE_INPUT_BLOCKED|115')
    expect(edited.targets?.find(target => target.name === 'Fixture Input')?.value).toBe('Ada')
    const button = edited.targets?.find(target => target.name === 'Apply Fixture')
    expect(button?.actions).toContain('invoke')
    const destructive = edited.targets?.find(target => target.name === 'Delete Fixture')
    if (edited.observationId === undefined || button === undefined || destructive === undefined) {
      throw new Error('WinForms fixture buttons were not observed')
    }
    expect(ctx.xiaojingComputerControl.approvalReason(sessionA, {
      action: 'invoke', observationId: edited.observationId, targetId: destructive.id,
    })).toMatch(/high-impact/u)
    const invoked = await ctx.xiaojingComputerControl.run(sessionA, {
      action: 'invoke', observationId: edited.observationId, targetId: button.id,
    }, signal).catch((cause: unknown) => { throw new Error('Apply Fixture invocation failed', { cause }) })
    if (invoked.observationId === undefined) throw new Error('WinForms fixture invoke returned no observation')
    const settled = await ctx.xiaojingComputerControl.run(sessionA, {
      action: 'wait', observationId: invoked.observationId, text: 'Applied Ada', timeoutMs: 4_000,
    }, signal)
    expect(settled.targets?.some(target => target.name === 'Applied Ada')).toBe(true)
    if (settled.observationId === undefined) throw new Error('WinForms fixture wait returned no observation')

    const interrupted = new AbortController()
    const waiting = ctx.xiaojingComputerControl.run(sessionA, {
      action: 'wait',
      observationId: settled.observationId,
      text: '__XIAOJING_NEVER_APPEARS__',
      timeoutMs: 5_000,
    }, interrupted.signal)
    const rejected = expect(waiting).rejects.toThrow(/fixture helper interruption/u)
    await waitEntered.promise
    interrupted.abort(new Error('fixture helper interruption'))
    await rejected
    const recovered = await ctx.xiaojingComputerControl.run(sessionA, { action: 'list_windows' }, signal)
    const recoveredWindowId = recovered.windows?.find(window => window.title === title)?.id
    expect(recoveredWindowId).toBeDefined()
    if (recoveredWindowId === undefined) throw new Error('WinForms fixture window was not recovered')
    expect(recoveredWindowId).not.toBe(windowId)
    await expect(ctx.xiaojingComputerControl.run(sessionA, { action: 'observe', windowId }, signal))
      .rejects.toThrow(/missing|stale/u)

    const finalObservation = await ctx.xiaojingComputerControl.run(sessionA, {
      action: 'observe', windowId: recoveredWindowId,
    }, signal)
    const finalDelete = finalObservation.targets?.find(target => target.name === 'Delete Fixture')
    if (finalObservation.observationId === undefined || finalDelete === undefined) {
      throw new Error('WinForms fixture delete control was not re-observed')
    }
    const session = Session.create(sessionA)
    session.append('turn/start', { turn: 1 })
    const agent = { id: sessionA, session } as unknown as Agent
    const answered = vi.fn(() => Promise.resolve<'allowed-once'>('allowed-once'))
    ctx.on('approval/request', answered)
    const deleted = await ctx.tools.execute({
      signal,
      callId: ToolCallId('computer-delete-under-never'),
      name: 'computer_control',
      arguments: {
        action: 'invoke',
        observation_id: finalObservation.observationId,
        target_id: finalDelete.id,
      },
      agent,
    })
    expect(deleted.isError).toBe(false)
    expect(answered).toHaveBeenCalledOnce()

    await ctx.xiaojingComputerControl.close()
    await expect(ctx.xiaojingComputerControl.run(sessionA, { action: 'observe', windowId }, signal))
      .rejects.toThrow(/missing|stale/u)
    const cancelled = new AbortController()
    cancelled.abort(new Error('fixture cancellation'))
    await expect(ctx.xiaojingComputerControl.run(sessionA, { action: 'list_windows' }, cancelled.signal))
      .rejects.toThrow(/fixture cancellation/u)
    const restarted = await ctx.xiaojingComputerControl.run(sessionA, { action: 'list_windows' }, signal)
    expect(restarted.windows).toBeDefined()
  }, 30_000)
})
