# Normalize generated transparent portraits before WebP encoding.
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
public static class HeroAlphaBounds {
  public static int[] Inspect(Bitmap bitmap) {
    int left=bitmap.Width,top=bitmap.Height,right=0,bottom=0,transparent=0;
    for(int y=0;y<bitmap.Height;y++) for(int x=0;x<bitmap.Width;x++) {
      byte alpha=bitmap.GetPixel(x,y).A;
      if(alpha==0) transparent++;
      if(alpha>12) { left=Math.Min(left,x);right=Math.Max(right,x);top=Math.Min(top,y);bottom=Math.Max(bottom,y); }
    }
    return new int[]{left,top,right,bottom,transparent};
  }
}
'@
$sourceFolder = Join-Path $PSScriptRoot '../.tmp/home-carousel-sources'
$outputFolder = Join-Path $PSScriptRoot '../.tmp/home-carousel-optimized'
New-Item -ItemType Directory -Force -Path $outputFolder | Out-Null
$report=@()
foreach($file in Get-ChildItem -LiteralPath $sourceFolder -Filter '*.png') {
  $source=[System.Drawing.Bitmap]::new($file.FullName)
  try {
    $left,$top,$right,$bottom,$transparent=[HeroAlphaBounds]::Inspect($source)
    if($transparent -eq 0 -or $right -le $left){throw "Missing genuine alpha: $($file.Name)"}
    $crop=[Drawing.Rectangle]::new($left,$top,$right-$left+1,$bottom-$top+1)
    $scale=[Math]::Min(460.0/$crop.Width,590.0/$crop.Height)
    $width=[int][Math]::Round($crop.Width*$scale);$height=[int][Math]::Round($crop.Height*$scale)
    $image=[Drawing.Bitmap]::new(480,600,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics=[Drawing.Graphics]::FromImage($image)
    try {
      $graphics.Clear([Drawing.Color]::Transparent)
      $graphics.CompositingMode=[Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $target=[Drawing.Rectangle]::new([int]((480-$width)/2),600-$height,$width,$height)
      $graphics.DrawImage($source,$target,$crop,[Drawing.GraphicsUnit]::Pixel)
      $output=Join-Path $outputFolder $file.Name
      $image.Save($output,[Drawing.Imaging.ImageFormat]::Png)
      $report += [PSCustomObject]@{id=$file.BaseName;width=480;height=600;sourceTransparentPixels=$transparent;intermediateBytes=(Get-Item $output).Length}
    } finally {$graphics.Dispose();$image.Dispose()}
  } finally {$source.Dispose()}
}
$report | ConvertTo-Json | Set-Content (Join-Path $outputFolder 'manifest.json')
Write-Output "Prepared $($report.Count) transparent 480x600 carousel portraits."
