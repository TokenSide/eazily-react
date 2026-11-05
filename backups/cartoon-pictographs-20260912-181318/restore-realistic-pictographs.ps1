$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$targetFolder = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'src/features/user-art'))
if (-not $targetFolder.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar)) {
  throw 'Refusing to restore outside the Eazily project.'
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'realistic/artwork.js') -Destination (Join-Path $targetFolder 'artwork.js') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'realistic/ServiceIllustration.jsx') -Destination (Join-Path $targetFolder 'ServiceIllustration.jsx') -Force
Write-Output 'Restored the realistic WebP pictographs and mapping. Layout and application files were not changed.'
