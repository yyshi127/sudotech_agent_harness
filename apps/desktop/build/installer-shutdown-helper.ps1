param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDirectory,

  [Parameter(Mandatory = $true)]
  [int]$InstallerProcessId,

  [int]$GracefulTimeoutSeconds = 4
)

$ErrorActionPreference = 'Stop'
$expectedDirectoryName = 'xiaojing-agent-desktop'
$shutdownArgument = '--xiaojing-shutdown-for-update'
$maximumLegacyPathLength = 259

function Resolve-NormalizedPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}

function Test-PathInsideInstallDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $normalizedCandidate = Resolve-NormalizedPath -Path $Candidate
  $prefix = $Root + [System.IO.Path]::DirectorySeparatorChar
  return $normalizedCandidate.Equals($Root, [System.StringComparison]::OrdinalIgnoreCase) `
    -or $normalizedCandidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Convert-ToExtendedPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ($Path.StartsWith('\\')) {
    return '\\?\UNC\' + $Path.TrimStart('\')
  }
  return '\\?\' + $Path
}

function Remove-OverlongLegacyInstallEntries {
  param([Parameter(Mandatory = $true)][string]$Root)

  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    return
  }

  $entries = @(Get-ChildItem -LiteralPath $Root -Force -Recurse -ErrorAction Stop)
  $reparsePoint = [System.IO.FileAttributes]::ReparsePoint
  if ($entries | Where-Object { ($_.Attributes -band $reparsePoint) -ne 0 }) {
    throw 'Refusing to clean an installation tree that contains reparse points.'
  }

  foreach ($file in @($entries | Where-Object { -not $_.PSIsContainer -and $_.FullName.Length -gt $maximumLegacyPathLength })) {
    if (-not (Test-PathInsideInstallDirectory -Candidate $file.FullName -Root $Root)) {
      throw 'Refusing to clean a file outside the fixed Xiaojing installation directory.'
    }
    [System.IO.File]::Delete((Convert-ToExtendedPath -Path $file.FullName))
  }

  $directories = @(
    $entries |
      Where-Object { $_.PSIsContainer -and ($_.FullName.Length + '\\*.*'.Length) -gt $maximumLegacyPathLength } |
      Sort-Object { $_.FullName.Length } -Descending
  )
  foreach ($directory in $directories) {
    if (-not (Test-PathInsideInstallDirectory -Candidate $directory.FullName -Root $Root)) {
      throw 'Refusing to clean a directory outside the fixed Xiaojing installation directory.'
    }
    [System.IO.Directory]::Delete((Convert-ToExtendedPath -Path $directory.FullName), $true)
  }

  $unsafeEntry = Get-ChildItem -LiteralPath $Root -Force -Recurse -ErrorAction Stop |
    Where-Object {
      $_.FullName.Length -gt $maximumLegacyPathLength `
        -or ($_.PSIsContainer -and ($_.FullName.Length + '\\*.*'.Length) -gt $maximumLegacyPathLength)
    } |
    Select-Object -First 1
  if ($unsafeEntry) {
    throw "The legacy installation still contains an unsafe path: $($unsafeEntry.FullName)"
  }
}

function Get-XiaojingInstallProcesses {
  param([Parameter(Mandatory = $true)][string]$Root)

  $currentHelperProcessId = $PID
  return @(
    Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
      Where-Object {
        $_.ProcessId -ne $InstallerProcessId `
          -and $_.ProcessId -ne $currentHelperProcessId `
          -and $_.ExecutablePath `
          -and (Test-PathInsideInstallDirectory -Candidate $_.ExecutablePath -Root $Root)
      }
  )
}

function Wait-ForInstallProcessesToExit {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (@(Get-XiaojingInstallProcesses -Root $Root).Count -eq 0) {
      return $true
    }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)

  return @(Get-XiaojingInstallProcesses -Root $Root).Count -eq 0
}

try {
  $installRoot = Resolve-NormalizedPath -Path $InstallDirectory
  if ([System.IO.Path]::GetFileName($installRoot) -cne $expectedDirectoryName) {
    throw 'Refusing to inspect a directory outside the fixed Xiaojing installation identity.'
  }

  $running = @(Get-XiaojingInstallProcesses -Root $installRoot)
  if ($running.Count -gt 0) {
    $appExecutable = Join-Path $installRoot '小兢会计.exe'
    if (Test-Path -LiteralPath $appExecutable -PathType Leaf) {
      try {
        Start-Process -FilePath $appExecutable -ArgumentList $shutdownArgument -WindowStyle Hidden | Out-Null
        [void](Wait-ForInstallProcessesToExit -Root $installRoot -TimeoutSeconds $GracefulTimeoutSeconds)
      } catch {
        # Legacy releases do not understand the update shutdown argument; the exact-path fallback below handles them.
      }
    }

    $running = @(Get-XiaojingInstallProcesses -Root $installRoot)
    foreach ($process in $running) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }

    if (-not (Wait-ForInstallProcessesToExit -Root $installRoot -TimeoutSeconds 3)) {
      exit 1
    }
  }

  Remove-OverlongLegacyInstallEntries -Root $installRoot
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 2
}
