[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int] $InstallerProcessId,

  [Parameter(Mandatory = $true)]
  [string] $InstallDirectory,

  [string] $InstallRegistryKey = '',
  [string] $UninstallRegistryKey = '',
  [string] $UninstallRegistryKey2 = '',
  [string] $DesktopShortcut = '',
  [string] $StartMenuShortcut = '',
  [switch] $SuppressUi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$logPath = Join-Path ([IO.Path]::GetTempPath()) "xiaojing-installer-cancel-$InstallerProcessId.log"

function Write-CancelStatus {
  param([string] $Status)

  Set-Content -LiteralPath $logPath -Value $Status -Encoding UTF8
}

try {
  $resolvedInstallDirectory = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if ([IO.Path]::GetFileName($resolvedInstallDirectory) -cne 'xiaojing-agent-desktop') {
    throw 'Refusing to clean an unexpected installation directory.'
  }

  $installerProcess = Get-Process -Id $InstallerProcessId -ErrorAction SilentlyContinue
  if ($null -ne $installerProcess) {
    $installerProcess | Wait-Process -Timeout 30 -ErrorAction Stop
  }

  if (Test-Path -LiteralPath $resolvedInstallDirectory) {
    Remove-Item -LiteralPath $resolvedInstallDirectory -Recurse -Force
  }

  foreach ($registryKey in @($InstallRegistryKey, $UninstallRegistryKey, $UninstallRegistryKey2)) {
    if ($registryKey -ne '') {
      Remove-Item -LiteralPath "Registry::HKEY_CURRENT_USER\$registryKey" -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  foreach ($shortcut in @($DesktopShortcut, $StartMenuShortcut)) {
    if ($shortcut -ne '' -and [IO.Path]::GetExtension($shortcut) -ieq '.lnk') {
      Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
    }
  }

  if (Test-Path -LiteralPath $resolvedInstallDirectory) {
    throw 'The partial installation directory still exists after cleanup.'
  }

  Write-CancelStatus 'completed'
  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
  exit 0
} catch {
  Write-CancelStatus ('failed:' + $_.Exception.GetType().Name)
  if (-not $SuppressUi) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "安装已停止，但未能完整清理临时程序文件。请重新运行安装包完成安装。`n`n诊断日志：$logPath",
      '小兢会计安装清理失败',
      [System.Windows.MessageBoxButton]::OK,
      [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
  }
  exit 1
}
