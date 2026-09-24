# Compile the installer artwork into white-backed NSIS bitmaps.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourcePath = Join-Path $PSScriptRoot '../build/installer-robot-source.png'
$buildPath = Join-Path $PSScriptRoot '../build'
$sourceImage = [System.Drawing.Image]::FromFile([System.IO.Path]::GetFullPath($sourcePath))
try {
    $sourceArea = [System.Drawing.RectangleF]::new(0, 70, 1254, 1110)
    $outputs = @(
        @{ Name = 'installer-product-logo.bmp'; Width = 480; Height = 400 },
        @{ Name = 'installer-product-logo-small.bmp'; Width = 72; Height = 72 }
    )
    foreach ($output in $outputs) {
        $bitmap = [System.Drawing.Bitmap]::new($output.Width, $output.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::White)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $scale = [Math]::Min($output.Width / $sourceArea.Width, $output.Height / $sourceArea.Height)
                $width = $sourceArea.Width * $scale
                $height = $sourceArea.Height * $scale
                $targetArea = [System.Drawing.RectangleF]::new(($output.Width - $width) / 2, ($output.Height - $height) / 2, $width, $height)
                $graphics.DrawImage($sourceImage, $targetArea, $sourceArea, [System.Drawing.GraphicsUnit]::Pixel)
            } finally {
                $graphics.Dispose()
            }
            $bitmap.Save((Join-Path $buildPath $output.Name), [System.Drawing.Imaging.ImageFormat]::Bmp)
        } finally {
            $bitmap.Dispose()
        }
    }
} finally {
    $sourceImage.Dispose()
}
