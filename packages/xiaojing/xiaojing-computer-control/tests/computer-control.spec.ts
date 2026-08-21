import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
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

describe('Windows UI Automation provider', () => {
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
  })

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
      $form.Controls.AddRange(@($input, $button, $delete, $label))
      [void]$form.ShowDialog()
    `
    const fixture = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
    ], { windowsHide: false, stdio: 'ignore' })
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
    await ctx.plugin(LocalSubprocess)
    const fiber = await ctx.plugin(ComputerControl, {
      requestTimeoutMs: 10_000,
      maxWaitMs: 5_000,
    })
    cleanup.push(() => fiber.dispose())
    const signal = new AbortController().signal
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')

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
    }, signal)
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
    setTimeout(() => { interrupted.abort(new Error('fixture helper interruption')) }, 100)
    await expect(waiting).rejects.toThrow(/fixture helper interruption/u)
    const recovered = await ctx.xiaojingComputerControl.run(sessionA, { action: 'list_windows' }, signal)
    expect(recovered.windows?.some(window => window.title === title)).toBe(true)

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
