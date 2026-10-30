# Recreate the app icon without installing a graphics tool (Windows PowerShell).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../desktop'))
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $bitmap = New-Object Drawing.Bitmap($size, $size)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size / 256.0, $size / 256.0)
  $background = New-Object Drawing.Drawing2D.GraphicsPath
  $background.AddArc(8, 8, 104, 104, 180, 90)
  $background.AddArc(144, 8, 104, 104, 270, 90)
  $background.AddArc(144, 144, 104, 104, 0, 90)
  $background.AddArc(8, 144, 104, 104, 90, 90)
  $background.CloseFigure()
  $brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#2879c8'))
  $graphics.FillPath($brush, $background)
  $bolt = New-Object Drawing.Drawing2D.GraphicsPath
  $bolt.AddPolygon([Drawing.PointF[]]@([Drawing.PointF]::new(146,40),[Drawing.PointF]::new(65,139),[Drawing.PointF]::new(125,139),[Drawing.PointF]::new(110,216),[Drawing.PointF]::new(192,107),[Drawing.PointF]::new(132,107)))
  $pen = New-Object Drawing.Pen([Drawing.Color]::White, 14)
  $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawPath($pen, $bolt)
  $stream = New-Object IO.MemoryStream
  $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
  $images += ,$stream.ToArray()
  if ($size -eq 256) { $bitmap.Save((Join-Path $outputDirectory 'icon.png'), [Drawing.Imaging.ImageFormat]::Png) }
  $stream.Dispose(); $pen.Dispose(); $bolt.Dispose(); $brush.Dispose(); $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$iconStream = [IO.File]::Create((Join-Path $outputDirectory 'icon.ico'))
$writer = New-Object IO.BinaryWriter($iconStream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
  $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
  $offset += $images[$i].Length
}
foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
$writer.Dispose(); $iconStream.Dispose()
Write-Output 'Created desktop/icon.ico and desktop/icon.png'
