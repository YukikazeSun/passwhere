$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ToolingRoot = Join-Path $ProjectRoot ".tooling"
$LocalCargoHome = Join-Path $ToolingRoot "cargo"
$LocalRustupHome = Join-Path $ToolingRoot "rustup"
$VsCandidates = @(
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat"
)

function Stop-WithMessage([string]$Message) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    exit 1
}

Write-Host "我密码呢 - 开发版启动器" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithMessage "Node.js was not found. Install Node.js 20 or newer and try again."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Stop-WithMessage "npm was not found. Reinstall Node.js with npm included."
}

$CargoExecutable = Join-Path $LocalCargoHome "bin\cargo.exe"
if (Test-Path -LiteralPath $CargoExecutable) {
    $env:CARGO_HOME = $LocalCargoHome
    $env:RUSTUP_HOME = $LocalRustupHome
    $env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = "sparse"
    $env:CARGO_HTTP_MULTIPLEXING = "false"
    $env:CARGO_HTTP_CHECK_REVOKE = "false"
    $env:Path = "$(Join-Path $LocalCargoHome 'bin');$env:Path"
} elseif (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Stop-WithMessage "Rust was not found. The local .tooling directory is incomplete and cargo is not available on PATH."
}

$VsDevCmd = $VsCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $VsDevCmd) {
    Stop-WithMessage "Visual Studio C++ Build Tools were not found. Tauri development requires the Windows C++ toolchain."
}

Push-Location $ProjectRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
        Write-Host "Installing frontend dependencies for the first run..." -ForegroundColor Yellow
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { Stop-WithMessage "npm install failed with exit code $LASTEXITCODE." }
    }

    Write-Host "Starting the Tauri development window..." -ForegroundColor Green
    $DevCommand = '"{0}" -arch=x64 && npm run tauri dev' -f $VsDevCmd
    & cmd.exe /d /c $DevCommand
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Tauri development failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}
