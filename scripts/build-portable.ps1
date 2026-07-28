$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ToolingRoot = Join-Path $ProjectRoot ".tooling"
$CargoHome = Join-Path $ToolingRoot "cargo"
$RustupHome = Join-Path $ToolingRoot "rustup"
$VsDevCmd = "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat"
$ReleaseDirectory = Join-Path $ProjectRoot "release-demo"
$BuiltExecutable = Join-Path $ProjectRoot "src-tauri\target\release\account-notebook.exe"
$PortableName = "{0}{1}-demo.exe" -f [char]0x8D26, [char]0x9875
$PortableExecutable = Join-Path $ReleaseDirectory $PortableName

if (-not (Test-Path $VsDevCmd)) {
    throw "Visual Studio 2019 Build Tools not found: $VsDevCmd"
}

if (-not (Test-Path (Join-Path $CargoHome "bin\cargo.exe"))) {
    throw "Project Rust toolchain not found under .tooling"
}

$env:CARGO_HOME = $CargoHome
$env:RUSTUP_HOME = $RustupHome
$env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = "sparse"
$env:CARGO_HTTP_MULTIPLEXING = "false"
$env:CARGO_HTTP_CHECK_REVOKE = "false"
$env:Path = "$(Join-Path $CargoHome 'bin');$env:Path"

Push-Location $ProjectRoot
try {
    cmd /c npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE"
    }

    $BuildCommand = '"{0}" -arch=x64 && npm run tauri build -- --no-bundle' -f $VsDevCmd
    cmd /c $BuildCommand
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed with exit code $LASTEXITCODE"
    }

    New-Item -ItemType Directory -Force -Path $ReleaseDirectory | Out-Null
    Copy-Item -LiteralPath $BuiltExecutable -Destination $PortableExecutable -Force
    Write-Host "Portable demo: $PortableExecutable"
}
finally {
    Pop-Location
}
