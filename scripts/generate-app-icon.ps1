param(
  [string]$SourceLogo = (Join-Path $PSScriptRoot '..\logo\透明.png'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\apps\desktop\build'),
  [string]$RendererAsset = (Join-Path $PSScriptRoot '..\apps\desktop\src\renderer\src\assets\logo.png')
)

Add-Type -AssemblyName System.Drawing

$sourceLogo = [System.IO.Path]::GetFullPath($SourceLogo)
$outputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$rendererAsset = [System.IO.Path]::GetFullPath($RendererAsset)

if (-not (Test-Path $sourceLogo)) {
  throw "Logo source not found: $sourceLogo"
}

[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($rendererAsset)) | Out-Null
Copy-Item -Force $sourceLogo $rendererAsset

$srcImg = [System.Drawing.Image]::FromFile($sourceLogo)
$sizes = @(256, 128, 64, 48, 32, 16)
$bitmaps = @()

foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $scale = [Math]::Min(($s * 0.92) / $srcImg.Width, ($s * 0.92) / $srcImg.Height)
  $w = [int]($srcImg.Width * $scale)
  $h = [int]($srcImg.Height * $scale)
  $x = [int](($s - $w) / 2)
  $y = [int](($s - $h) / 2)
  $g.DrawImage($srcImg, $x, $y, $w, $h)
  $g.Dispose()
  $bitmaps += $bmp
}

$pngPath = Join-Path $outputDirectory 'icon.png'
$icoPath = Join-Path $outputDirectory 'icon.ico'
$bitmaps[0].Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$bitmaps.Count)
$imageData = New-Object System.Collections.Generic.List[byte[]]
$offset = 6 + (16 * $bitmaps.Count)
for ($i = 0; $i -lt $bitmaps.Count; $i++) {
  $b = $bitmaps[$i]
  $pms = New-Object System.IO.MemoryStream
  $b.Save($pms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $pms.ToArray()
  $pms.Dispose()
  $imageData.Add($bytes)
  $bw.Write([Byte]($(if ($b.Width -ge 256) { 0 } else { $b.Width })))
  $bw.Write([Byte]($(if ($b.Height -ge 256) { 0 } else { $b.Height })))
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$bytes.Length)
  $bw.Write([UInt32]$offset)
  $offset += $bytes.Length
}
foreach ($bytes in $imageData) { $bw.Write($bytes) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose()
$ms.Dispose()
$srcImg.Dispose()
foreach ($b in $bitmaps) { $b.Dispose() }

Write-Output $icoPath
