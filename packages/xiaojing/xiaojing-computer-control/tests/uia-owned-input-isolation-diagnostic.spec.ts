import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, onTestFailed, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ComputerControl from '../src/index.ts'
import { WINDOWS_UIA_HELPER } from '../src/helper-script.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

it.each([false, true])('records explicit owned character input with fixture filtering=%s', async (filterInput) => {
  const title = `Xiaojing Input Isolation ${String(process.pid)} ${String(filterInput)}`
  const csharp = String.raw`
using System;
using System.Threading;
using System.Windows.Forms;
using System.Runtime.InteropServices;
public static class InputFixture {
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  static readonly object OutputLock = new object();
  static Form Window;
  static TextBox Input;
  public static void Emit(string kind, string value) {
    lock (OutputLock) {
      Console.Out.WriteLine("INPUT_FIXTURE|" + kind + "|" + DateTime.UtcNow.ToString("o") + "|" + System.Diagnostics.Process.GetCurrentProcess().Id + "|" + Window.Handle.ToInt64() + "|" + Input.Handle.ToInt64() + "|" + Window.Visible + "|" + Window.WindowState + "|" + value);
      Console.Out.Flush();
    }
  }
  public static void Start(string title, bool filterInput) {
    Window = new Form { Text=title, Width=440, Height=250 };
    Input = new TextBox { Name="InputBox", AccessibleName="Fixture Input", Left=20, Top=20, Width=250 };
    Label result = new Label { Name="Result", Text="Waiting", Left=20, Top=120, Width=300 };
    Button apply = new Button { Text="Apply Fixture", Left=20, Top=70, Width=180 };
    apply.Click += delegate { result.Text="Applied " + Input.Text; Emit("invoked", result.Text); };
    Input.KeyPress += delegate(object sender, KeyPressEventArgs args) {
      args.Handled=filterInput;
      Emit("keypress", ((int)args.KeyChar).ToString() + ";handled=" + filterInput);
    };
    Input.TextChanged += delegate { Emit("text-changed", Input.Text); };
    Window.Controls.AddRange(new Control[] { Input, apply, result });
    Window.Shown += delegate {
      Emit("shown", "");
      Thread reader = new Thread(delegate() {
        string command;
        while((command=Console.In.ReadLine()) != null) {
          if(command=="INJECT_S") Window.BeginInvoke(new Action(delegate {
            uint pid;
            GetWindowThreadProcessId(Input.Handle, out pid);
            if(pid != System.Diagnostics.Process.GetCurrentProcess().Id) throw new InvalidOperationException("input HWND owner changed");
            Emit("injection-before", Input.Text);
            SendMessage(Input.Handle, 0x0102, new IntPtr(115), new IntPtr(1));
            Emit("injection-completed", Input.Text);
          }));
        }
      });
      reader.IsBackground=true;
      reader.Start();
    };
    Application.Run(Window);
  }
}
`
  const script = `Add-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName System.Drawing\nAdd-Type -TypeDefinition @'\n${csharp}\n'@ -ReferencedAssemblies System.Windows.Forms,System.Drawing\n[InputFixture]::Start('${title}', $${String(filterInput)})`
  const fixture = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] })
  let fixtureOutput = ''
  let fixtureErrors = ''
  const fixtureLines: string[] = []
  const helperLines: string[] = []
  fixture.stdout.on('data', (chunk: Buffer) => {
    fixtureOutput += chunk.toString('utf8')
    while(fixtureOutput.includes('\n')) {
      const end=fixtureOutput.indexOf('\n')
      const line=fixtureOutput.slice(0,end).trim()
      fixtureOutput=fixtureOutput.slice(end+1)
      fixtureLines.push(line)
      console.log(line)
    }
  })
  fixture.stderr.on('data', (chunk: Buffer) => { fixtureErrors += chunk.toString('utf8') })
  onTestFailed(() => { console.error('INPUT_DIAGNOSTIC_FAILURE', JSON.stringify({ filterInput, fixtureLines, helperLines, fixtureExit:fixture.exitCode, fixtureErrors })) })
  cleanup.push(async () => {
    if(fixture.exitCode!==null)return
    fixture.kill()
    await new Promise<void>((resolve)=>{fixture.once('exit',()=>{resolve()})})
  })
  await vi.waitFor(()=>{expect(fixtureLines.some(line=>line.startsWith('INPUT_FIXTURE|shown|'))).toBe(true)}, { timeout:10_000 })
  const ctx=new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const subprocess=await ctx.plugin(LocalSubprocess)
  cleanup.push(()=>subprocess.dispose())
  const managedSpawn=ctx.subprocess.spawn.bind(ctx.subprocess)
  let helper: SubprocessHandle | undefined
  const spawnMonitor=vi.spyOn(ctx.subprocess,'spawn').mockImplementation((spec)=>{
    let source=WINDOWS_UIA_HELPER.replace('function Clean-Text($Value)', '$script:ownedInputGate=$true\nfunction Clean-Text($Value)')
    source=source.replace('$pattern.SetValue([string]$Value)', String.raw`$pattern.SetValue([string]$Value)
  if ($script:ownedInputGate) {
    $script:ownedInputGate=$false
    [Console]::Error.WriteLine('OWNED_INPUT_VALUE_BARRIER ' + $PID + ' ' + $pattern.Current.Value)
    [Console]::Error.Flush()
    if ([Console]::In.ReadLine() -ne '__OWNED_INPUT_RELEASE__') { throw 'owned input release token is invalid' }
  }`)
    const compressed=gzipSync(Buffer.from(source,'utf8')).toString('base64')
    const bootstrap="$b=[Convert]::FromBase64String('"+compressed+"');$m=New-Object IO.MemoryStream(,$b);$g=New-Object IO.Compression.GzipStream($m,[IO.Compression.CompressionMode]::Decompress);$r=New-Object IO.StreamReader($g,[Text.Encoding]::UTF8);$s=$r.ReadToEnd();$r.Dispose();$g.Dispose();$m.Dispose();& ([ScriptBlock]::Create($s))"
    const argv=[...spec.argv]
    argv[argv.length-1]=Buffer.from(bootstrap,'utf16le').toString('base64')
    const handle=managedSpawn({ ...spec,argv,stdio:{ ...spec.stdio,stderr:'pipe' } })
    helper=handle
    handle.stderr?.on('data',(chunk:Buffer)=>{
      helperLines.push(chunk.toString('utf8'))
      console.log('INPUT_HELPER_STDERR',chunk.toString('utf8'))
    })
    return handle
  })
  cleanup.push(async()=>{spawnMonitor.mockRestore()})
  const fiber=await ctx.plugin(ComputerControl,{ requestTimeoutMs:15_000 })
  cleanup.push(()=>fiber.dispose())
  const session=SessionId(`owned-input-isolation-${String(filterInput)}`)
  const signal=new AbortController().signal
  const listed=await ctx.xiaojingComputerControl.run(session,{ action:'list_windows' },signal)
  const window=listed.windows?.find(item=>item.title===title)
  if(window===undefined)throw new Error('owned input fixture window absent')
  const observed=await ctx.xiaojingComputerControl.run(session,{ action:'observe',windowId:window.id },signal)
  const input=observed.targets?.find(target=>target.name==='Fixture Input')
  if(observed.observationId===undefined||input===undefined)throw new Error('owned input observation absent')
  const setting=ctx.xiaojingComputerControl.run(session,{ action:'set_value',observationId:observed.observationId,targetId:input.id,value:'Ada' },signal)
  await vi.waitFor(()=>{expect(helperLines.join('')).toContain('OWNED_INPUT_VALUE_BARRIER')},{ timeout:10_000 })
  expect(helperLines.join('')).toMatch(/OWNED_INPUT_VALUE_BARRIER \d+ Ada/u)
  fixture.stdin.write('INJECT_S\n')
  await vi.waitFor(()=>{expect(fixtureLines.some(line=>line.startsWith('INPUT_FIXTURE|injection-completed|'))).toBe(true)},{ timeout:10_000 })
  expect(fixtureLines.some(line=>line.startsWith('INPUT_FIXTURE|keypress|')&&line.endsWith(`115;handled=${filterInput?'True':'False'}`))).toBe(true)
  if(helper===undefined||helper.stdin===undefined)throw new Error('owned helper stdin absent')
  helper.stdin.write('__OWNED_INPUT_RELEASE__\n')
  const edited=await setting
  const expected=filterInput?'Ada':'sAda'
  expect(edited.targets?.find(target=>target.name==='Fixture Input')?.value).toBe(expected)
  const apply=edited.targets?.find(target=>target.name==='Apply Fixture')
  if(edited.observationId===undefined||apply===undefined)throw new Error('owned apply observation absent')
  const invoked=await ctx.xiaojingComputerControl.run(session,{ action:'invoke',observationId:edited.observationId,targetId:apply.id },signal)
  expect(invoked.targets?.some(target=>target.name===`Applied ${expected}`)).toBe(true)
  await ctx.xiaojingComputerControl.close()
  expect(await helper.waitForExit()).toBe(true)
  console.log('INPUT_DIAGNOSTIC_COMPLETE',JSON.stringify({ filterInput,expected,fixtureLines,helperLines,fixturePid:fixture.pid,fixtureExit:fixture.exitCode }))
},35_000)
