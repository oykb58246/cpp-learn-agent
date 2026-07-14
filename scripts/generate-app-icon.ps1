param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\apps\desktop\build')
)

Add-Type -AssemblyName System.Drawing

$outputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$size = 256
$bitmap = [System.Drawing.Bitmap]::new($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

function New-RoundedPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$tilePath = New-RoundedPath 18 18 220 220 42
$tileBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 8, 127, 106))
$graphics.FillPath($tileBrush, $tilePath)

$panelPath = New-RoundedPath 48 58 160 140 22
$panelBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 10, 54, 48))
$graphics.FillPath($panelBrush, $panelPath)

$dotBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 110, 231, 199))
foreach ($x in 70, 88, 106) {
  $graphics.FillEllipse($dotBrush, $x, 78, 10, 10)
}

$codePen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 11)
$codePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$codePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLines($codePen, @(
  [System.Drawing.PointF]::new(101, 116),
  [System.Drawing.PointF]::new(81, 136),
  [System.Drawing.PointF]::new(101, 156)
))
$graphics.DrawLines($codePen, @(
  [System.Drawing.PointF]::new(155, 116),
  [System.Drawing.PointF]::new(175, 136),
  [System.Drawing.PointF]::new(155, 156)
))

$statusBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 110, 231, 199))
$graphics.FillEllipse($statusBrush, 116, 174, 24, 24)

$pngPath = Join-Path $outputDirectory 'icon.png'
$icoPath = Join-Path $outputDirectory 'icon.ico'
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Create($icoPath)
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Dispose()

$codePen.Dispose()
$statusBrush.Dispose()
$dotBrush.Dispose()
$panelBrush.Dispose()
$panelPath.Dispose()
$tileBrush.Dispose()
$tilePath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output $icoPath
