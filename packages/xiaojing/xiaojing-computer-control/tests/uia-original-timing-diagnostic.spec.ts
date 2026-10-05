import { Buffer } from 'node:buffer'
import { gzipSync } from 'node:zlib'
import { WINDOWS_UIA_HELPER } from '../src/helper-script.ts'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, onTestFailed, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import ComputerControl, { parseComputerResult, type ComputerWindowId } from '../src/index.ts'

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

describe('Windows UI Automation provider original timing probe', () => {
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
    const title = `Xiaojing Quiet Start Probe ${String(process.pid)}`
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      Add-Type -TypeDefinition @'
using System.Windows.Forms;
public class QuietFixtureForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
}
'@ -ReferencedAssemblies System.Windows.Forms
      $form = New-Object QuietFixtureForm
      $form.Text = '${title}'
      $form.Width = 420
      $form.Height = 240
      $input = New-Object System.Windows.Forms.TextBox
      $script:probeInput = $input
      $input.Name = 'InputBox'
      $input.AccessibleName = 'Fixture Input'
      $input.Left = 20
      $input.Top = 20
      $input.Width = 250

      function Fixture-Probe($Kind, $Window) {
        [Console]::Out.WriteLine(('FIXTURE_PROBE ' + (@{
          kind = $Kind; utc = [DateTime]::UtcNow.ToString('o'); pid = $PID;
          handle = $Window.Handle.ToInt64().ToString(); visible = $Window.Visible;
          state = $Window.WindowState.ToString(); enabled = $Window.Enabled;
          apartment = [Threading.Thread]::CurrentThread.ApartmentState.ToString();
          input = $script:probeInput.Text
        } | ConvertTo-Json -Compress)))
        [Console]::Out.Flush()
      }
      $form.Add_Shown({ Fixture-Probe 'shown' $this; [Console]::Out.WriteLine('FIXTURE_SHOWN'); [Console]::Out.Flush() })
      $form.Add_VisibleChanged({ Fixture-Probe 'visible' $this })
      $form.Add_Resize({ Fixture-Probe 'resize' $this })
      $form.Add_Activated({ Fixture-Probe 'activated' $this })
      $form.Add_Deactivate({ Fixture-Probe 'deactivated' $this })
      $form.Add_FormClosed({ Fixture-Probe 'closed' $this })
      $input.Add_TextChanged({ Fixture-Probe 'text-changed' $this.FindForm() })
      $input.Add_KeyPress({ [Console]::Out.WriteLine('FIXTURE_KEYPRESS=' + [int]$_.KeyChar); [Console]::Out.Flush() })
      $input.Add_KeyDown({ [Console]::Out.WriteLine('FIXTURE_KEYDOWN=' + $_.KeyValue + ';MODIFIERS=' + $_.Modifiers); [Console]::Out.Flush() })
      $input.Add_KeyUp({ [Console]::Out.WriteLine('FIXTURE_KEYUP=' + $_.KeyValue + ';MODIFIERS=' + $_.Modifiers); [Console]::Out.Flush() })

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
    await ctx.plugin(LocalSubprocess)
    const fiber = await ctx.plugin(ComputerControl, {
      requestTimeoutMs: 10_000,
      maxWaitMs: 5_000,
    })
    cleanup.push(() => fiber.dispose())

    const signal = new AbortController().signal
    await vi.waitFor(() => { expect(fixtureOutput).toContain('FIXTURE_SHOWN') }, { timeout: 10_000 })
    const fixtureShown = fixtureOutput.split(/\r?\n/u).find(line => line.startsWith('FIXTURE_PROBE ') && line.includes('"shown"'))
    if (fixtureShown === undefined || fixture.pid === undefined) throw new Error('fixture identity was not published')
    const probeIdentity = JSON.parse(fixtureShown.slice('FIXTURE_PROBE '.length)) as { handle: string }
    let waitEntered = false
    const helperRecords: Array<{ index: number; started: number; ended?: number; lines: string[] }> = []
    const spawnManaged = ctx.subprocess.spawn.bind(ctx.subprocess)
    const spawnMonitor = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const index = helperRecords.length
      const record: { index: number; started: number; ended?: number; lines: string[] } = { index, started: Date.now(), lines: [] }
      helperRecords.push(record)
      const fixturePrefix = String.raw`
function Owned-Probe($Kind, $Data) {
  [Console]::Error.WriteLine(('UIA_OWNED_PROBE ' + (@{ kind = $Kind; utc = [DateTime]::UtcNow.ToString('o'); helperPid = $PID; apartment = [Threading.Thread]::CurrentThread.ApartmentState.ToString(); data = $Data } | ConvertTo-Json -Compress -Depth 8)))
  [Console]::Error.Flush()
}
Owned-Probe 'startup' @{ fixturePid = ${String(fixture.pid)}; fixtureHandle = '${probeIdentity.handle}' }
`
      let helperSource = WINDOWS_UIA_HELPER.replace('function Clean-Text($Value)', fixturePrefix + '\nfunction Clean-Text($Value)')
      const listStart = helperSource.indexOf('function List-Windows {')
      const listEnd = helperSource.indexOf('function Observe-Window', listStart)
      const originalList = helperSource.slice(listStart, listEnd)
      const diagnosedList = originalList.replace(
        'if ($title.Length -eq 0 -or $processId -le 0 -or $window.Current.IsOffscreen) { continue }',
        String.raw`
      if ($processId -eq ${String(fixture.pid)}) {
        Owned-Probe 'enumerated-fixture' @{ title = $title; processId = $processId; offscreen = $window.Current.IsOffscreen; enabled = $window.Current.IsEnabled; handle = $window.Current.NativeWindowHandle; rectangle = $window.Current.BoundingRectangle.ToString() }
      }
      if ($title.Length -eq 0 -or $processId -le 0 -or $window.Current.IsOffscreen) { continue }
`,
      )
      helperSource = helperSource.replace(originalList, diagnosedList)
      helperSource = helperSource.replace(
        '$found = $script:currentWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)',
        "Owned-Probe 'wait-query-start' @{ text = $Text }\n    $found = $script:currentWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)\n    if ($Text -eq '__XIAOJING_NEVER_APPEARS__') { Owned-Probe 'wait-query-completed' @{ found = ($null -ne $found) } }",
      )
      helperSource = helperSource.replace(
        '$request = $line | ConvertFrom-Json',
        "$request = $line | ConvertFrom-Json\n    Owned-Probe 'request' @{ action = $request.action; id = $request.id }",
      )

      helperSource = helperSource.replace(
        '$response = [ordered]@{ id = $id; ok = $false; error = $_.Exception.Message }',
        "Owned-Probe 'helper-failure' @{ message=$_.Exception.Message; stack=$_.ScriptStackTrace; exception=$_.Exception.ToString() }\n    $response = [ordered]@{ id = $id; ok = $false; error = $_.Exception.Message }",
      )
      helperSource = helperSource.replace(
        '$pattern.SetValue([string]$Value)',
        "Owned-Probe 'set-value-before' @{ name=$Element.Current.Name; value=$pattern.Current.Value; request=$Value; enabled=$Element.Current.IsEnabled; offscreen=$Element.Current.IsOffscreen }\n  $pattern.SetValue([string]$Value)\n  Owned-Probe 'set-value-after' @{ name=$Element.Current.Name; value=$pattern.Current.Value; enabled=$Element.Current.IsEnabled; offscreen=$Element.Current.IsOffscreen }",
      )
      helperSource = helperSource.replace(
        '$pattern.Invoke()',
        "Owned-Probe 'invoke-before' @{ name=$Element.Current.Name; enabled=$Element.Current.IsEnabled; offscreen=$Element.Current.IsOffscreen }\n  $pattern.Invoke()\n  Owned-Probe 'invoke-after' @{ name=$Element.Current.Name; enabled=$Element.Current.IsEnabled; offscreen=$Element.Current.IsOffscreen }",
      )
      helperSource = helperSource.replace(
        '# Controls can disappear during traversal; omit the stale element from this observation.',
        "Owned-Probe 'observe-control-failure' @{ message=$_.Exception.Message; stack=$_.ScriptStackTrace; exception=$_.Exception.ToString() }\n        # Controls can disappear during traversal; omit the stale element from this observation.",
      )
      helperSource = helperSource.replace(
        '# A subtree can disappear during traversal; the remaining observation is still valid and bounded.',
        "Owned-Probe 'observe-subtree-failure' @{ message=$_.Exception.Message; stack=$_.ScriptStackTrace; exception=$_.Exception.ToString() }\n      # A subtree can disappear during traversal; the remaining observation is still valid and bounded.",
      )
      const compressed = gzipSync(Buffer.from(helperSource, 'utf8')).toString('base64')
      const bootstrap = "$b=[Convert]::FromBase64String('" + compressed + "');$m=New-Object IO.MemoryStream(,$b);$g=New-Object IO.Compression.GzipStream($m,[IO.Compression.CompressionMode]::Decompress);$r=New-Object IO.StreamReader($g,[Text.Encoding]::UTF8);$s=$r.ReadToEnd();$r.Dispose();$g.Dispose();$m.Dispose();& ([ScriptBlock]::Create($s))"
      const argv = [...spec.argv]
      argv[argv.length - 1] = Buffer.from(bootstrap, 'utf16le').toString('base64')
      const handle = spawnManaged({ ...spec, argv, stdio: { ...spec.stdio, stderr: 'pipe' } })
      let helperErrors = ''
      handle.stderr?.on('data', (chunk: Buffer) => {
        helperErrors += chunk.toString('utf8')
        while (helperErrors.includes('\n')) {
          const end = helperErrors.indexOf('\n')
          const line = helperErrors.slice(0, end).trim()
          helperErrors = helperErrors.slice(end + 1)
          record.lines.push(line)
          if (line.startsWith('UIA_OWNED_PROBE ')) console.log(line)
          if (line.includes('"wait-query-completed"')) waitEntered = true
        }
      })
      void handle.waitForExit().then(() => { record.ended = Date.now() }, (error: unknown) => { console.error('UIA probe helper exit failed', error) })
      return handle
    })
    cleanup.push(async () => { spawnMonitor.mockRestore() })
    cleanup.push(async () => { console.log('UIA_OWNED_FINAL', JSON.stringify({ helpers: helperRecords, fixtureExit: fixture.exitCode, fixtureOutput })) })

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
    const edited = await ctx.xiaojingComputerControl.run(sessionA, {
      action: 'set_value', observationId: observed.observationId, targetId: input.id, value: 'Ada',
    }, signal)
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

    setTimeout(() => {
      console.log('UIA_OWNED_CANCEL', JSON.stringify({ time: Date.now(), fixtureExit: fixture.exitCode, queryReturned: waitEntered, fixtureOutput }))
      interrupted.abort(new Error('fixture helper interruption'))
    }, 100)
    await expect(waiting).rejects.toThrow(/fixture helper interruption/u)
    console.log('UIA_OWNED_CANCEL_RETURNED', JSON.stringify({ time: Date.now(), helpers: helperRecords.map(({ lines: _lines, ...record }) => record) }))

    const recovered = await ctx.xiaojingComputerControl.run(sessionA, { action: 'list_windows' }, signal)
    console.log('UIA_OWNED_RECOVERY', JSON.stringify({ time: Date.now(), fixtureExit: fixture.exitCode, found: recovered.windows?.some(window => window.title === title), total: recovered.windows?.length, truncated: recovered.truncated, fixtureOutput }))
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
    const agent: Agent = {
      id: sessionA, session, ctx, options: {}, status: 'idle',
      inbox: {
        nextTurn: [], nextStep: [], clear() {}, append() {}, prepend() {}, replace: () => false, remove: () => false, splice: () => [],
      },
      cancel() {}, whenIdle: async () => {}, runMaintenance: task => task(new AbortController().signal),
      send() {}, followup() {}, steer() {}, inject() {},
    }
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
