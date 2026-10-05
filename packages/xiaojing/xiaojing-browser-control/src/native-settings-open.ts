/** Fixed Windows browser-settings navigation through a newly opened, verified browser window. @module */

import { win32 } from 'node:path'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import type { NativeBrowser } from './native-settings-types.ts'

const OPEN_SETTINGS = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class BrowserSettingsWindow {
  [StructLayout(LayoutKind.Sequential)] private struct FileInfo {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created;
    public System.Runtime.InteropServices.ComTypes.FILETIME Accessed; public System.Runtime.InteropServices.ComTypes.FILETIME Written;
    public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; public uint IndexHigh; public uint IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern SafeFileHandle CreateFile(
    string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
  public static string ExecutableId(string path) {
    using (var file = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
      FileInfo info;
      if (file.IsInvalid || !GetFileInformationByHandle(file, out info)) { throw new System.ComponentModel.Win32Exception(); }
      return info.Volume.ToString("x8") + ":" + info.IndexHigh.ToString("x8") + info.IndexLow.ToString("x8");
    }
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
}
'@
$uri = if ($Request.browser -eq 'chrome') { 'chrome://inspect/#remote-debugging' } else { 'edge://inspect/#remote-debugging' }
$pageTitle = if ($Request.browser -eq 'chrome') { 'Inspect with Chrome Developer Tools' } else { 'Inspect with Edge Developer Tools' }
$deadline = [DateTime]::UtcNow.AddMilliseconds([int]$Request.timeoutMs)
$executableId = [BrowserSettingsWindow]::ExecutableId($Request.executablePath)
function Brand-Windows {
  $result = @()
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($window in $windows) {
    try {
      $process = Get-Process -Id $window.Current.ProcessId -ErrorAction Stop
      # Windows may report another hardlink to the installed browser executable.
      if ($window.Current.ClassName -eq 'Chrome_WidgetWin_1' -and
          [BrowserSettingsWindow]::ExecutableId($process.Path) -eq $executableId) { $result += $window }
    } catch {
      # A window may disappear during enumeration; it is never selected after failed process inspection.
    }
  }
  return $result
}
function Address($window) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
  $matches = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($matches.Count -ne 1) { throw 'The new browser window has no unique address bar.' }
  $address = $matches[0]
  $parent = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($address)
  if ($parent.Current.ClassName -ne 'LocationBarView' -or $address.Current.ProcessId -ne $window.Current.ProcessId) {
    throw 'The new browser address bar could not be verified.'
  }
  return $address
}
function Value($address) {
  return [System.Windows.Automation.ValuePattern]$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
}
$before = @(Brand-Windows | ForEach-Object { $_.Current.NativeWindowHandle })
foreach ($name in [Environment]::GetEnvironmentVariables('Process').Keys) {
  if ($name -match 'KEY|PASSWORD|SECRET|TOKEN|^DSH_') { [Environment]::SetEnvironmentVariable([string]$name, $null, 'Process') }
}
Start-Process -FilePath $Request.executablePath -ArgumentList @('--new-window', 'about:blank') -WindowStyle Normal
do {
  $fresh = @(Brand-Windows | Where-Object { $_.Current.NativeWindowHandle -notin $before })
  if ($fresh.Count -gt 1) { throw 'More than one new browser window appeared. Open the settings address manually.' }
  if ($fresh.Count -eq 1) { break }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
if ($fresh.Count -ne 1) { throw 'The new browser window did not appear. Open the settings address manually.' }
$window = $fresh[0]
$process = Get-Process -Id $window.Current.ProcessId -ErrorAction Stop
$processStart = $process.StartTime.ToUniversalTime().Ticks
$address = Address $window
$pattern = Value $address
if ($pattern.Current.Value -ne 'about:blank') { throw 'The new browser window is no longer blank; no existing page was changed.' }
$address.SetFocus()
$pattern.SetValue($uri)
$handle = [IntPtr]$window.Current.NativeWindowHandle
[uint32]$windowProcess = 0
[void][BrowserSettingsWindow]::GetWindowThreadProcessId($handle, [ref]$windowProcess)
$process = Get-Process -Id $windowProcess -ErrorAction Stop
if ($windowProcess -ne $window.Current.ProcessId -or [BrowserSettingsWindow]::ExecutableId($process.Path) -ne $executableId -or
    $process.StartTime.ToUniversalTime().Ticks -ne $processStart) { throw 'The new browser window changed; no navigation was sent.' }
if (-not $address.Current.HasKeyboardFocus -or [BrowserSettingsWindow]::GetForegroundWindow() -ne $handle -or
    $pattern.Current.Value -ne $uri) { throw 'Could not focus the new browser address bar. Open the settings address manually.' }
if (-not [BrowserSettingsWindow]::PostMessage($handle, 0x100, [IntPtr]13, [IntPtr]0x001C0001) -or
    -not [BrowserSettingsWindow]::PostMessage($handle, 0x101, [IntPtr]13, [IntPtr]0xC01C0001)) {
  throw 'The new browser window did not accept the settings navigation.'
}
$documentCondition = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $pageTitle)))
do {
  $address = Address $window
  $document = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $documentCondition)
  if (-not $address.Current.HasKeyboardFocus -and (Value $address).Current.Value -eq $uri -and $null -ne $document) {
    ConvertTo-Json -Compress -InputObject @{ browser = $Request.browser; url = (Value $address).Current.Value;
      documentTitle = $document.Current.Name; opened = $true }
    exit 0
  }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Could not confirm that the browser settings page opened. Open the settings address manually.'
`

/**
 * Open only the selected browser's inspect page in a new normal window and verify its address and document.
 * Browser permissions and existing windows are left untouched; cancellation never closes the user's browser.
 * @param browser - operator-selected fixed browser brand.
 * @param executablePath - trusted absolute installation executable.
 * @param timeoutMs - settings navigation deadline supplied by the owning service.
 * @param signal - operator cancellation, service disposal, and deadline.
 * @param platform - Host operating system.
 * @param run - shell-free native command execution.
 * @returns after the new window's inspect address and document are observed.
 */
export async function openNativeBrowserSettings(
  browser: NativeBrowser, executablePath: string, timeoutMs: number, signal: AbortSignal,
  platform: NodeJS.Platform = process.platform, run: NativeCommandRunner = runNativeCommand,
): Promise<void> {
  signal.throwIfAborted()
  if (platform !== 'win32') throw new Error('Opening browser settings is available only on Windows. Copy the settings address instead.')
  if (!win32.isAbsolute(executablePath) || win32.basename(executablePath).toLowerCase() !== (browser === 'chrome' ? 'chrome.exe' : 'msedge.exe')) {
    throw new Error('Could not verify the browser installation. Copy the settings address instead.')
  }
  const request = Buffer.from(JSON.stringify({ browser, executablePath, timeoutMs }), 'utf8').toString('base64')
  const script = `$Request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request}')) | ConvertFrom-Json\n${OPEN_SETTINGS}`
  let stdout: string
  try {
    const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], signal, 'hidden')
    stdout = output.stdout
  } catch (error) {
    signal.throwIfAborted()
    throw new Error('Could not open the browser settings page. Keep the Windows desktop unlocked, or copy the settings address to open it manually.', { cause: error })
  }
  signal.throwIfAborted()
  let result: unknown
  try { result = JSON.parse(stdout) }
  catch (error) { throw new Error('Could not confirm the browser settings page. Copy the settings address instead.', { cause: error }) }
  if (typeof result !== 'object' || result === null || !('browser' in result) || result.browser !== browser
    || !('opened' in result) || result.opened !== true || !('url' in result)
    || result.url !== `${browser}://inspect/#remote-debugging` || !('documentTitle' in result)
    || result.documentTitle !== `Inspect with ${browser === 'chrome' ? 'Chrome' : 'Edge'} Developer Tools`) {
    throw new Error('Could not confirm the browser settings page. Copy the settings address instead.')
  }
}
