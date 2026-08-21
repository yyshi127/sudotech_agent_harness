/** PowerShell 5.1 helper for a persistent, newline-delimited Windows UI Automation protocol. */

/**
 * The helper runs inside the current interactive Windows user session. It keeps opaque AutomationElement references in process
 * memory. Application launch targets come only from the Windows Start application catalog; model-facing requests never contain
 * coordinates, executable paths, scripts, shell commands, or Windows application registration identifiers.
 */
export const WINDOWS_UIA_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$script:instanceId = [Guid]::NewGuid().ToString('N')
$script:windowCounter = 0
$script:appCounter = 0
$script:observationCounter = 0
$script:targetCounter = 0
$script:windowTargets = @{}
$script:appTargets = @{}
$script:controlTargets = @{}
$script:currentWindow = $null
$script:currentWindowId = $null
$script:currentObservationId = $null
$script:maxTargets = 240
$script:maxApps = 60
$script:maxWindows = 100
$script:maxDepth = 8
$script:maxTextChars = 240

function Clean-Text($Value) {
  if ($null -eq $Value) { return '' }
  $text = ([string]$Value) -replace '\s+', ' '
  $text = $text.Trim()
  if ($text.Length -gt $script:maxTextChars) { return $text.Substring(0, $script:maxTextChars) }
  return $text
}

function Try-Pattern($Element, $Pattern) {
  $value = $null
  $found = $Element.TryGetCurrentPattern($Pattern, [ref]$value)
  if ($found) { return $value }
  return $null
}

function Pattern-Actions($Element) {
  $actions = New-Object System.Collections.Generic.List[string]
  if ($null -ne (Try-Pattern $Element ([System.Windows.Automation.InvokePattern]::Pattern))) { $actions.Add('invoke') }
  $valuePattern = Try-Pattern $Element ([System.Windows.Automation.ValuePattern]::Pattern)
  $isPassword = $true
  try {
    $isPassword = [bool]$Element.Current.IsPassword
  } catch {
    # Protected or stale elements never advertise a logged text-writing action.
  }
  if ($null -ne $valuePattern -and -not $valuePattern.Current.IsReadOnly -and -not $isPassword) { $actions.Add('set_value') }
  if ($null -ne (Try-Pattern $Element ([System.Windows.Automation.TogglePattern]::Pattern))) { $actions.Add('toggle') }
  if ($null -ne (Try-Pattern $Element ([System.Windows.Automation.SelectionItemPattern]::Pattern))) { $actions.Add('select') }
  if ($null -ne (Try-Pattern $Element ([System.Windows.Automation.ScrollPattern]::Pattern))) { $actions.Add('scroll') }
  try {
    if ($Element.Current.IsKeyboardFocusable) { $actions.Add('focus') }
  } catch {
    # A stale UIA element contributes no focus action; later operations still validate the opaque target.
  }
  return ,([string[]]$actions.ToArray())
}

function Control-Value($Element) {
  try {
    if ($Element.Current.IsPassword) { return $null }
  } catch {
    # Password state is unreadable on stale or protected elements, so no value is exposed.
    return $null
  }
  $pattern = Try-Pattern $Element ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($null -eq $pattern) { return $null }
  return Clean-Text $pattern.Current.Value
}

function Focus-Window($Window) {
  try {
    $pattern = Try-Pattern $Window ([System.Windows.Automation.WindowPattern]::Pattern)
    if ($null -ne $pattern -and $pattern.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) {
      $pattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
    }
  } catch {
    # Some window providers reject visual-state access; SetFocus below remains the authoritative operation.
  }
  $Window.SetFocus()
}

function Wait-WindowIdle($Window) {
  try {
    $pattern = Try-Pattern $Window ([System.Windows.Automation.WindowPattern]::Pattern)
    if ($null -ne $pattern) { [void]$pattern.WaitForInputIdle(500) }
  } catch {
    # Providers without WindowPattern or idle support do not need an additional settle wait.
  }
}

function Release-ComObjectSafely($Value) {
  if ($null -eq $Value) { return }
  try {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value)
  } catch {
    # COM cleanup must not replace the application launch result.
  }
}

function List-Apps($Query) {
  $script:appTargets = @{}
  $items = New-Object System.Collections.Generic.List[object]
  $queryText = Clean-Text $Query
  $truncated = $false
  $apps = @(Get-StartApps | Sort-Object Name, AppID)
  foreach ($app in $apps) {
    $name = Clean-Text $app.Name
    $registration = ([string]$app.AppID).Trim()
    if ($name.Length -eq 0 -or $registration.Length -eq 0) { continue }
    if ($registration -match '^https?://' -or $registration -match '\.(url|chm)$') { continue }
    if ($queryText.Length -gt 0 -and $name.IndexOf($queryText, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
    if ($items.Count -ge $script:maxApps) { $truncated = $true; break }
    $script:appCounter += 1
    $id = 'wa-' + $script:instanceId + '-' + [string]$script:appCounter
    $script:appTargets[$id] = [pscustomobject]@{ name = $name; registration = $registration }
    $items.Add([ordered]@{ id = $id; name = $name })
  }
  return [ordered]@{
    action = 'list_apps'
    summary = 'Listed installed Windows applications'
    apps = [object[]]$items.ToArray()
    truncated = [bool]$truncated
  }
}

function Get-VisibleProcessIds {
  $processIds = @{}
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($window in $windows) {
    try {
      $processId = [int]$window.Current.ProcessId
      if ($processId -gt 0 -and -not $window.Current.IsOffscreen) { $processIds[$processId] = $true }
    } catch {
      # Windows can disappear while the pre-launch process set is captured; omit that stale window.
    }
  }
  return $processIds
}

function Test-AppWindow($AppName, $ExistingProcessIds) {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($window in $windows) {
    try {
      $title = Clean-Text $window.Current.Name
      $processId = [int]$window.Current.ProcessId
      if ($title.Length -eq 0 -or $processId -le 0 -or $window.Current.IsOffscreen) { continue }
      if ($title.IndexOf($AppName, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
      if (-not $ExistingProcessIds.ContainsKey($processId)) { return $true }
    } catch {
      # A newly launched window can disappear during inspection; continue until the launch deadline.
    }
  }
  return $false
}

function Launch-App($AppId, $TimeoutMs, $PollMs) {
  if (-not $script:appTargets.ContainsKey($AppId)) { throw 'application is missing or the application list is stale; list apps again' }
  $app = $script:appTargets[$AppId]
  $existingProcessIds = Get-VisibleProcessIds
  $shell = $null
  $folder = $null
  $item = $null
  try {
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.Namespace('shell:AppsFolder')
    if ($null -eq $folder) { throw 'Windows application catalog is unavailable' }
    $item = $folder.ParseName([string]$app.registration)
    if ($null -eq $item) { throw 'Windows could not resolve the selected application' }
    $item.InvokeVerb('open')
  } finally {
    Release-ComObjectSafely $item
    Release-ComObjectSafely $folder
    Release-ComObjectSafely $shell
  }
  $script:appTargets = @{}
  $matched = $false
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  do {
    Start-Sleep -Milliseconds $PollMs
    $matched = Test-AppWindow ([string]$app.name) $existingProcessIds
  } while (-not $matched -and [DateTime]::UtcNow -lt $deadline)
  $result = List-Windows
  $result.action = 'launch_app'
  $result.appName = [string]$app.name
  $result.summary = if ($matched) {
    'Launched Windows application and found a related visible window'
  } else {
    'Launched Windows application; no related visible window appeared before the wait limit'
  }
  return $result
}

function List-Windows {
  $script:windowTargets = @{}
  $items = New-Object System.Collections.Generic.List[object]
  $truncated = $false
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($window in $windows) {
    try {
      $title = Clean-Text $window.Current.Name
      $processId = [int]$window.Current.ProcessId
      if ($title.Length -eq 0 -or $processId -le 0 -or $window.Current.IsOffscreen) { continue }
      if ($items.Count -ge $script:maxWindows) { $truncated = $true; break }
      $script:windowCounter += 1
      $id = 'ww-' + $script:instanceId + '-' + [string]$script:windowCounter
      $script:windowTargets[$id] = $window
      $items.Add([ordered]@{ id = $id; title = $title; processId = $processId })
    } catch {
      # Windows can disappear while the root list is enumerated; omit that stale window.
    }
  }
  return [ordered]@{
    action = 'list_windows'
    summary = 'Listed visible desktop windows'
    windows = [object[]]$items.ToArray()
    truncated = [bool]$truncated
  }
}

function Observe-Window($WindowId) {
  if (-not $script:windowTargets.ContainsKey($WindowId)) { throw 'window is missing or the window list is stale; list windows again' }
  $window = $script:windowTargets[$WindowId]
  $script:currentWindow = $window
  $script:currentWindowId = $WindowId
  $script:controlTargets = @{}
  $script:observationCounter += 1
  $script:currentObservationId = 'wo-' + $script:instanceId + '-' + [string]$script:observationCounter
  $targets = New-Object System.Collections.Generic.List[object]
  $queue = New-Object System.Collections.Generic.Queue[object]
  $queue.Enqueue([pscustomobject]@{ element = $window; depth = 0 })
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $visited = 0
  $truncated = $false
  while ($queue.Count -gt 0) {
    $entry = $queue.Dequeue()
    $element = $entry.element
    $depth = [int]$entry.depth
    if ($depth -gt 0) {
      try {
        $visited += 1
        if ($visited -gt $script:maxTargets) { $truncated = $true; break }
        $name = Clean-Text $element.Current.Name
        $value = Control-Value $element
        $actions = Pattern-Actions $element
        $controlType = ([string]$element.Current.ControlType.ProgrammaticName) -replace '^ControlType\.', ''
        if ($name.Length -gt 0 -or ($null -ne $value -and $value.Length -gt 0) -or $actions.Length -gt 0) {
          $script:targetCounter += 1
          $targetId = 'wt-' + $script:instanceId + '-' + [string]$script:targetCounter
          $script:controlTargets[$targetId] = $element
          $target = [ordered]@{
            id = $targetId
            controlType = $controlType
            name = $name
            enabled = [bool]$element.Current.IsEnabled
            actions = @($actions)
          }
          if ($null -ne $value -and $value.Length -gt 0) { $target.value = $value }
          $targets.Add($target)
        }
      } catch {
        # Controls can disappear during traversal; omit the stale element from this observation.
      }
    }
    if ($depth -ge $script:maxDepth) { continue }
    try {
      $child = $walker.GetFirstChild($element)
      while ($null -ne $child) {
        $queue.Enqueue([pscustomobject]@{ element = $child; depth = $depth + 1 })
        $child = $walker.GetNextSibling($child)
      }
    } catch {
      # A subtree can disappear during traversal; the remaining observation is still valid and bounded.
    }
  }
  $title = Clean-Text $window.Current.Name
  return [ordered]@{
    action = 'observe'
    summary = 'Observed Windows controls'
    windowId = $WindowId
    windowTitle = $title
    observationId = $script:currentObservationId
    targets = [object[]]$targets.ToArray()
    truncated = [bool]$truncated
  }
}

function Require-Target($Request) {
  if ([string]$Request.observationId -ne [string]$script:currentObservationId) {
    throw 'control observation is stale; observe the window again'
  }
  $targetId = [string]$Request.targetId
  if (-not $script:controlTargets.ContainsKey($targetId)) { throw 'control target is missing from that observation' }
  return $script:controlTargets[$targetId]
}

function Invoke-Target($Element) {
  $pattern = Try-Pattern $Element ([System.Windows.Automation.InvokePattern]::Pattern)
  if ($null -eq $pattern) { throw 'target does not support invoke' }
  $pattern.Invoke()
}

function Set-TargetValue($Element, $Value) {
  try {
    if ($Element.Current.IsPassword) { throw 'password fields are not accepted because tool arguments are recorded in the session log' }
  } catch {
    if ($_.Exception.Message -like 'password fields*') { throw }
  }
  $pattern = Try-Pattern $Element ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($null -eq $pattern -or $pattern.Current.IsReadOnly) { throw 'target does not support writable ValuePattern' }
  $pattern.SetValue([string]$Value)
}

function Toggle-Target($Element) {
  $pattern = Try-Pattern $Element ([System.Windows.Automation.TogglePattern]::Pattern)
  if ($null -eq $pattern) { throw 'target does not support toggle' }
  $pattern.Toggle()
}

function Select-Target($Element) {
  $pattern = Try-Pattern $Element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if ($null -eq $pattern) { throw 'target does not support selection' }
  $pattern.Select()
}

function Scroll-Target($Element, $Direction) {
  $pattern = Try-Pattern $Element ([System.Windows.Automation.ScrollPattern]::Pattern)
  if ($null -eq $pattern) { throw 'target does not support scrolling' }
  switch ([string]$Direction) {
    'up' { $pattern.ScrollVertical([System.Windows.Automation.ScrollAmount]::SmallDecrement) }
    'down' { $pattern.ScrollVertical([System.Windows.Automation.ScrollAmount]::SmallIncrement) }
    'left' { $pattern.ScrollHorizontal([System.Windows.Automation.ScrollAmount]::SmallDecrement) }
    'right' { $pattern.ScrollHorizontal([System.Windows.Automation.ScrollAmount]::SmallIncrement) }
    default { throw 'direction must be up, down, left, or right' }
  }
}

function Wait-ForText($Text, $TimeoutMs, $PollMs) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    [string]$Text,
    [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase
  )
  do {
    $found = $script:currentWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -ne $found) { return }
    Start-Sleep -Milliseconds $PollMs
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'timed out waiting for exact UI Automation name'
}

function Run-Request($Request) {
  $action = [string]$Request.action
  if ($action -eq 'list_apps') {
    $query = ''
    if ($null -ne $Request.PSObject.Properties['query']) { $query = [string]$Request.query }
    return List-Apps $query
  }
  if ($action -eq 'launch_app') {
    return Launch-App ([string]$Request.appId) ([int]$Request.timeoutMs) ([int]$Request.pollMs)
  }
  if ($action -eq 'list_windows') { return List-Windows }
  if ($action -eq 'observe') { return Observe-Window ([string]$Request.windowId) }
  if ($null -eq $script:currentWindow) { throw 'no observed window; list windows and observe one first' }
  if ($action -eq 'wait') {
    Wait-ForText ([string]$Request.text) ([int]$Request.timeoutMs) ([int]$Request.pollMs)
    $result = Observe-Window $script:currentWindowId
    $result.action = 'wait'
    $result.summary = 'Wait condition matched'
    return $result
  }
  Focus-Window $script:currentWindow
  if ($action -eq 'press_key') {
    if ($null -ne $Request.targetId -and [string]$Request.targetId -ne '') {
      $target = Require-Target $Request
      $target.SetFocus()
    }
    [System.Windows.Forms.SendKeys]::SendWait([string]$Request.key)
  } else {
    $target = Require-Target $Request
    switch ($action) {
      'invoke' { Invoke-Target $target }
      'set_value' { Set-TargetValue $target $Request.value }
      'toggle' { Toggle-Target $target }
      'select' { Select-Target $target }
      'focus' { $target.SetFocus() }
      'scroll' { Scroll-Target $target ([string]$Request.direction) }
      default { throw 'unsupported computer action' }
    }
  }
  Wait-WindowIdle $script:currentWindow
  $result = Observe-Window $script:currentWindowId
  $result.action = $action
  $result.summary = 'Windows action completed'
  return $result
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line.Trim().Length -eq 0) { continue }
  $id = $null
  try {
    $request = $line | ConvertFrom-Json
    $id = [string]$request.id
    $script:maxApps = [int]$request.maxApps
    $script:maxWindows = [int]$request.maxWindows
    $script:maxTargets = [int]$request.maxTargets
    $script:maxDepth = [int]$request.maxDepth
    $result = Run-Request $request
    $response = [ordered]@{ id = $id; ok = $true; result = $result }
  } catch {
    $response = [ordered]@{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 8))
  [Console]::Out.Flush()
}
`
