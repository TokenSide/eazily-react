# Re-encode generated originals at 192px (3x the largest common artwork slot), preserving alpha.
# No source renders are shipped. Sources stay in .tmp/realistic-art-sources.
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
public static class UserArtBounds {
  public static int[] Inspect(Bitmap bitmap) {
    int left=bitmap.Width,top=bitmap.Height,right=0,bottom=0,transparent=0;
    for(int y=0;y<bitmap.Height;y++) for(int x=0;x<bitmap.Width;x++) {
      byte alpha=bitmap.GetPixel(x,y).A;
      if(alpha==0) transparent++;
      if(alpha>16) { left=Math.Min(left,x); right=Math.Max(right,x); top=Math.Min(top,y); bottom=Math.Max(bottom,y); }
    }
    return new int[]{left,top,right,bottom,transparent};
  }
}
'@
$sourceFolder = Join-Path $PSScriptRoot '../.tmp/realistic-art-sources'
$destinationFolder = Join-Path $PSScriptRoot '../.tmp/realistic-art-optimized'
New-Item -ItemType Directory -Force -Path $destinationFolder | Out-Null
$report = @()
foreach ($file in Get-ChildItem -LiteralPath $sourceFolder -Filter '*.png') {
  $original = [System.Drawing.Bitmap]::new($file.FullName)
  try {
    $left,$top,$right,$bottom,$transparent=[UserArtBounds]::Inspect($original)
    if ($transparent -eq 0 -or $right -le $left) { throw "Missing genuine transparency or subject: $($file.Name)" }
    $crop=[System.Drawing.Rectangle]::new($left,$top,$right-$left+1,$bottom-$top+1)
    $scale=204.0/[Math]::Max($crop.Width,$crop.Height)
    $width=[int][Math]::Round($crop.Width*$scale); $height=[int][Math]::Round($crop.Height*$scale)
    $image=[System.Drawing.Bitmap]::new(216,216,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics=[System.Drawing.Graphics]::FromImage($image)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode=[System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $target=[System.Drawing.Rectangle]::new([int]((216-$width)/2),[int]((216-$height)/2),$width,$height)
      $graphics.DrawImage($original,$target,$crop,[System.Drawing.GraphicsUnit]::Pixel)
      $output=Join-Path $destinationFolder $file.Name
      $image.Save($output,[System.Drawing.Imaging.ImageFormat]::Png)
      $report += [PSCustomObject]@{Id=$file.BaseName; Bytes=(Get-Item -LiteralPath $output).Length; Width=216; Height=216; SourceTransparentPixels=$transparent}
    } finally { $graphics.Dispose(); $image.Dispose() }
  } finally { $original.Dispose() }
}
$report | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot '../docs/realistic-artwork-assets.json')
Write-Output "Optimized $($report.Count) alpha PNG assets, $(($report | Measure-Object -Property Bytes -Sum).Sum) bytes total."
