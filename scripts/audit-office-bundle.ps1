$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AssetsDirectory = Join-Path $ProjectRoot "dist\assets"
$Bundles = @(Get-ChildItem -LiteralPath $AssetsDirectory -Filter "exceljs.bare.min-*.js" -File)
if ($Bundles.Count -ne 1) {
    throw "Expected exactly one browser-only ExcelJS bundle under dist/assets"
}

$Bundle = $Bundles[0]
$MaxBytes = 900000
if ($Bundle.Length -gt $MaxBytes) {
    throw "ExcelJS browser bundle is $($Bundle.Length) bytes, above the $MaxBytes byte guard"
}

$Text = Get-Content -Raw -Encoding UTF8 $Bundle.FullName
$ForbiddenMarkers = @(
    "archiver",
    "readdir-glob",
    "unzipper",
    "child_process",
    "node:fs",
    "node:path"
)
$UnexpectedMarkers = @($ForbiddenMarkers | Where-Object { $Text.Contains($_) })
if ($UnexpectedMarkers.Count -gt 0) {
    throw "Browser-only ExcelJS bundle contains Node-only markers: $($UnexpectedMarkers -join ', ')"
}

$IndexFile = Join-Path $ProjectRoot "dist\index.html"
if (-not (Test-Path -LiteralPath $IndexFile -PathType Leaf)) {
    throw "Production entry file is missing: dist/index.html"
}

$IndexText = Get-Content -Raw -Encoding UTF8 $IndexFile
$OfficePreloads = [regex]::Matches(
    $IndexText,
    '<link[^>]+rel=["'']modulepreload["''][^>]+href=["''][^"'']*(?:exceljs|dist-)[^"'']*["'']',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)
if ($OfficePreloads.Count -gt 0) {
    throw "Office bundles must remain lazy-loaded and cannot be modulepreloaded from dist/index.html"
}

$OfficeChunks = @(Get-ChildItem -LiteralPath $AssetsDirectory -Filter "officeExchange-*.js" -File)
if ($OfficeChunks.Count -ne 1) {
    throw "Expected exactly one officeExchange chunk under dist/assets"
}

Write-Host "Office bundle guard passed: $($Bundle.Name), $($Bundle.Length) bytes; office chunks remain lazy-loaded"
