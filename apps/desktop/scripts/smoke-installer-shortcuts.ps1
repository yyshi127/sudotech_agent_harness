param(
  [Parameter(Mandatory)][string]$Makensis,
  [Parameter(Mandatory)][string]$BuilderInclude,
  [Parameter(Mandatory)][string]$PluginDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('xiaojing-shortcut-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$shell = New-Object -ComObject WScript.Shell
$shellApplication = New-Object -ComObject Shell.Application

function Assert-Link([string]$Path, [string]$Target, [string]$Icon) {
  $link = $shell.CreateShortcut($Path)
  if ($link.TargetPath -ne $Target -or $link.IconLocation -ne "$Icon,0") {
    throw "Shortcut target or icon mismatch: $Path"
  }
  $item = $shellApplication.NameSpace((Split-Path $Path)).ParseName([IO.Path]::GetFileName($Path))
  if ($item.ExtendedProperty('System.AppUserModel.ID') -ne 'com.sudotech.xiaojing-icon-smoke') {
    throw "Shortcut lost its application identity: $Path"
  }
}

function Run-Installer([string]$Path, [int]$Expected = 0) {
  $process = Start-Process -FilePath $Path -ArgumentList '/S' -WindowStyle Hidden -PassThru
  try {
    if (-not $process.WaitForExit(15000)) {
      $process.Kill()
      $process.WaitForExit()
      throw 'Shortcut smoke installer did not exit'
    }
    if ($process.ExitCode -ne $Expected) { throw "Installer exited with $($process.ExitCode), expected $Expected" }
  } finally {
    $process.Dispose()
  }
}

try {
  $target = Join-Path $scratch 'custom path/xiaojing-agent-desktop'
  $desktop = Join-Path $scratch 'Desktop'
  $startMenu = Join-Path $scratch 'Start Menu'
  $oldResources = Join-Path $scratch 'old-icons'
  foreach ($directory in @($target, $desktop, $startMenu, $oldResources)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  $exe = Join-Path $target 'Xiaojing.exe'
  Copy-Item -LiteralPath "$env:WINDIR/System32/where.exe" -Destination $exe
  $desktopLink = Join-Path $desktop 'Xiaojing.lnk'
  $menuLink = Join-Path $startMenu 'Xiaojing.lnk'
  foreach ($path in @($desktopLink, $menuLink)) {
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $exe
    $link.IconLocation = "$exe,0"
    $link.Save()
  }
  $oldIcon = [IO.File]::Create((Join-Path $oldResources 'installer-runtime-icon.ico'))
  try { [Drawing.SystemIcons]::Application.Save($oldIcon) } finally { $oldIcon.Dispose() }
  $fixture = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/installer-shortcut-icons-smoke.nsi'))
  $currentResources = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../build'))
  $previousIcon = ''
  foreach ($entry in @(@{ Name = 'old'; Resources = $oldResources }, @{ Name = 'new'; Resources = $currentResources })) {
    $installer = Join-Path $scratch ($entry.Name + '.exe')
    & $Makensis /V2 "/DOUTPUT_FILE=$installer" "/DBUILDER_INCLUDE=$BuilderInclude" "/DPLUGIN_DIR=$PluginDirectory" `
      "/DBUILD_RESOURCES_DIR=$($entry.Resources)" "/DTARGET_DIR=$target" "/DDESKTOP_LINK=$desktopLink" "/DSTART_MENU_LINK=$menuLink" $fixture | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Shortcut smoke compilation failed' }
    Run-Installer $installer
    $digest = (Get-FileHash -LiteralPath (Join-Path $entry.Resources 'installer-runtime-icon.ico') -Algorithm SHA256).Hash.ToLowerInvariant()
    $icon = Join-Path $target "resources/xiaojing-character-$digest.ico"
    if (-not (Test-Path -LiteralPath $icon)) { throw 'Content-addressed icon was not installed' }
    if ((Get-FileHash -LiteralPath $icon).Hash.ToLowerInvariant() -ne $digest) { throw 'Installed icon contents differ' }
    Assert-Link $desktopLink $exe $icon
    Assert-Link $menuLink $exe $icon
    if ($icon -eq $previousIcon) { throw 'Changed artwork reused the old icon path' }
    $previousIcon = $icon
    Write-Output "Shortcut icon smoke passed: $($entry.Name)"
  }
  Run-Installer $installer
  Assert-Link $desktopLink $exe $previousIcon
  Write-Output 'Shortcut icon smoke passed: same-build reinstall'
  Remove-Item -LiteralPath $desktopLink
  Run-Installer $installer
  if (Test-Path -LiteralPath $desktopLink) { throw 'User-deleted Desktop shortcut was recreated' }
  Assert-Link $menuLink $exe $previousIcon
  Write-Output 'Shortcut icon smoke passed: missing Desktop shortcut preserved'
  $lockedIcon = [IO.File]::Open($previousIcon, 'Open', 'Read', 'None')
  try { Run-Installer $installer 2 } finally { $lockedIcon.Dispose() }
  Write-Output 'Shortcut icon smoke passed: icon write failure is reported'
} finally {
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shellApplication) | Out-Null
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
  $resolvedScratch = [IO.Path]::GetFullPath($scratch)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolvedScratch.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing cleanup outside the temporary directory: $resolvedScratch"
  }
  Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
}
