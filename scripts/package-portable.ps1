$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ToolingRoot = Join-Path $ProjectRoot ".tooling"
$CargoHome = Join-Path $ToolingRoot "cargo"
$RustupHome = Join-Path $ToolingRoot "rustup"
$VsDevCmd = "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat"
$PackageMetadata = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "package.json") | ConvertFrom-Json
$TauriMetadata = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "src-tauri\tauri.conf.json") | ConvertFrom-Json
$CargoManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "src-tauri\Cargo.toml")
$Version = [string]$PackageMetadata.version
$CargoVersionMatch = [regex]::Match($CargoManifest, '(?m)^version\s*=\s*"([^\"]+)"\s*$')
if (-not $Version -or $TauriMetadata.version -ne $Version -or -not $CargoVersionMatch.Success -or $CargoVersionMatch.Groups[1].Value -ne $Version) {
    throw "Version mismatch across package.json, tauri.conf.json, and Cargo.toml"
}
$ReleaseRoot = Join-Path $ProjectRoot "release"
$ProductName = "{0}{1}{2}{3}" -f [char]0x6211, [char]0x5BC6, [char]0x7801, [char]0x5462
$PackageName = "{0}-v{1}-{2}{3}{4}" -f $ProductName, $Version, [char]0x7EFF, [char]0x8272, [char]0x7248
$UsageName = "{0}{1}{2}{3}.txt" -f [char]0x4F7F, [char]0x7528, [char]0x8BF4, [char]0x660E
$PackageDirectory = Join-Path $ReleaseRoot $PackageName
$ArchivePath = Join-Path $ReleaseRoot "$PackageName.zip"
$BuiltExecutable = Join-Path $ProjectRoot "src-tauri\target\release\account-notebook.exe"
$PackagedExecutable = Join-Path $PackageDirectory "$ProductName.exe"
$UsageSource = Join-Path $ProjectRoot "packaging\$UsageName"

if (-not (Test-Path -LiteralPath $VsDevCmd)) {
    throw "Visual Studio 2019 Build Tools not found: $VsDevCmd"
}
if (-not (Test-Path -LiteralPath (Join-Path $CargoHome "bin\cargo.exe"))) {
    throw "Project Rust toolchain not found under .tooling"
}
if (-not (Test-Path -LiteralPath $UsageSource)) {
    throw "Portable usage guide not found: $UsageSource"
}

$env:CARGO_HOME = $CargoHome
$env:RUSTUP_HOME = $RustupHome
$env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = "sparse"
$env:CARGO_HTTP_MULTIPLEXING = "false"
$env:CARGO_HTTP_CHECK_REVOKE = "false"
$env:Path = "$(Join-Path $CargoHome 'bin');$env:Path"

Push-Location $ProjectRoot
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE" }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE" }

    $BuildCommand = '"{0}" -arch=x64 && npm run tauri build -- --no-bundle' -f $VsDevCmd
    & cmd.exe /d /c $BuildCommand
    if ($LASTEXITCODE -ne 0) { throw "Tauri build failed with exit code $LASTEXITCODE" }

    New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
    $ResolvedReleaseRoot = [IO.Path]::GetFullPath($ReleaseRoot).TrimEnd('\')
    $ResolvedPackageDirectory = [IO.Path]::GetFullPath($PackageDirectory).TrimEnd('\')
    if (-not $ResolvedPackageDirectory.StartsWith("$ResolvedReleaseRoot\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Package directory escaped the release root"
    }

    if (Test-Path -LiteralPath $PackageDirectory) {
        Remove-Item -LiteralPath $PackageDirectory -Recurse -Force
    }
    if (Test-Path -LiteralPath $ArchivePath) {
        Remove-Item -LiteralPath $ArchivePath -Force
    }

    New-Item -ItemType Directory -Force -Path $PackageDirectory | Out-Null
    Copy-Item -LiteralPath $BuiltExecutable -Destination $PackagedExecutable
    $UsageText = (Get-Content -Raw -Encoding UTF8 $UsageSource).Replace("{{VERSION}}", $Version)
    Set-Content -LiteralPath (Join-Path $PackageDirectory $UsageName) -Value $UsageText -Encoding UTF8
    $ArchiveCreated = $false
    foreach ($Attempt in 1..5) {
        try {
            Compress-Archive -LiteralPath $PackageDirectory -DestinationPath $ArchivePath -CompressionLevel Optimal
            $ArchiveCreated = $true
            break
        }
        catch {
            if ($Attempt -eq 5) { throw }
            Start-Sleep -Milliseconds 800
            if (Test-Path -LiteralPath $ArchivePath) {
                Remove-Item -LiteralPath $ArchivePath -Force
            }
        }
    }
    if (-not $ArchiveCreated) {
        throw "Portable archive was not created"
    }

    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ArchivePath).Hash
    Write-Host "Package directory: $PackageDirectory"
    Write-Host "Archive: $ArchivePath"
    Write-Host "SHA256: $Hash"
}
finally {
    Pop-Location
}
