# Scale the Windows icon artwork without changing the source or startup-page image.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = [Drawing.Image]::FromFile((Join-Path $desktopRoot 'build/installer-icon-source.png'))
try {
  $bitmap = [Drawing.Bitmap]::new($source.Width, $source.Height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scale = 1.10
      $width = $source.Width * $scale
      $height = $source.Height * $scale
      $target = [Drawing.RectangleF]::new(($source.Width - $width) / 2, ($source.Height - $height) / 2, $width, $height)
      $graphics.DrawImage($source, $target)
    } finally {
      $graphics.Dispose()
    }
    foreach ($relativePath in @('build/app-icon.png', 'assets/windows-icon.png')) {
      $bitmap.Save((Join-Path $desktopRoot $relativePath), [Drawing.Imaging.ImageFormat]::Png)
    }
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $source.Dispose()
}
