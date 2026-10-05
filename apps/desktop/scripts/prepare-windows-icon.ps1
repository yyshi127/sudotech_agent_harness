# Crop native icon padding while retaining the original browser and download artwork.
$ErrorActionPreference = 'Stop'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePath = Join-Path $desktopRoot 'build/installer-icon-source.png'
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
if ($sourceHash -ne '586221BFC8C3CB1B8C12B0EB43443469EA5974D98D025215B5BA6FB3DC2C1E04') {
  throw 'The branded icon source changed; review its native crop before generating Windows icons.'
}
Add-Type -AssemblyName System.Drawing
$sourceBitmap = [Drawing.Bitmap]::new($sourcePath)
try {
  if ($sourceBitmap.Width -ne 1254 -or $sourceBitmap.Height -ne 1254) {
    throw 'The branded icon source must be 1254 by 1254 pixels.'
  }
  # This crop keeps two source pixels beyond the alpha-128 tile bounds.
  $nativeBitmap = $sourceBitmap.Clone([Drawing.Rectangle]::new(49, 49, 1157, 1157), [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $stream = [IO.MemoryStream]::new()
    try {
      $nativeBitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
      $nativeBytes = $stream.ToArray()
    } finally { $stream.Dispose() }
  } finally { $nativeBitmap.Dispose() }
} finally { $sourceBitmap.Dispose() }
$hasher = [Security.Cryptography.SHA256]::Create()
try { $nativeHash = [BitConverter]::ToString($hasher.ComputeHash($nativeBytes)).Replace('-', '') }
finally { $hasher.Dispose() }
foreach ($relativePath in @(
  'build/app-icon.png',
  'assets/windows-icon.png',
  'assets/app-icon.png',
  'assets/taskbar-icon.png'
)) {
  $destinationPath = Join-Path $desktopRoot $relativePath
  if ((Test-Path -LiteralPath $destinationPath) -and (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash -eq $nativeHash) { continue }
  [IO.File]::WriteAllBytes($destinationPath, $nativeBytes)
}
foreach ($relativePath in @(
  '../web/public/xiaojing-character-logo.png',
  '../xiaojing-download/assets/app-icon.png'
)) {
  $destinationPath = Join-Path $desktopRoot $relativePath
  if ((Test-Path -LiteralPath $destinationPath) -and (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash -eq $sourceHash) { continue }
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}
