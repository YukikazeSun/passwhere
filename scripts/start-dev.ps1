$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ToolingRoot = Join-Path $ProjectRoot ".tooling"
$LocalCargoHome = Join-Path $ToolingRoot "cargo"
$LocalRustupHome = Join-Path $ToolingRoot "rustup"
$DebugExecutable = Join-Path $ProjectRoot "src-tauri\target\debug\account-notebook.exe"
$RuntimeCommand = Join-Path $PSScriptRoot "start-dev-command.cmd"
$OutputDirectory = Join-Path $ProjectRoot "output"
$LauncherLog = Join-Path $OutputDirectory "start-dev-launcher.log"
$StandardOutputLog = Join-Path $OutputDirectory "start-dev.stdout.log"
$StandardErrorLog = Join-Path $OutputDirectory "start-dev.stderr.log"
$LaunchMutexName = "Local\PasswhereDevelopmentLauncher"
$DevPort = 1422
$StartupTimeoutSeconds = 180
$VsCandidates = @(
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat"
)

$ExitCode = 0
$DevProcess = $null
$DevPortOwner = $null
$StartedSession = $false
$LaunchMutex = $null
$OwnsMutex = $false

function Write-LauncherLog([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
    $Line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"), $Message
    Write-Host $Message -ForegroundColor $Color
    Add-Content -LiteralPath $LauncherLog -Value $Line -Encoding UTF8
}

function Get-RunningDevelopmentApp {
    @(Get-Process -Name "account-notebook" -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -eq $DebugExecutable } catch { $false }
    })
}

function Get-DevPortOwner {
    $Pattern = "^\s*TCP\s+\S+:$DevPort\s+\S+\s+LISTENING\s+(\d+)\s*$"
    # Vite defaults to IPv6 localhost on this machine, so inspect both TCP stacks.
    foreach ($Line in (& netstat.exe -ano)) {
        if ($Line -match $Pattern) { return [int]$Matches[1] }
    }
    return $null
}

function Wait-ForDevPortOwner([int]$TimeoutSeconds) {
    $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $Owner = Get-DevPortOwner
        if ($null -ne $Owner) { return $Owner }
        Start-Sleep -Milliseconds 150
    } while ((Get-Date) -lt $Deadline)
    return $null
}

function Show-LogTail([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $Tail = @(Get-Content -LiteralPath $Path -Tail 30 -ErrorAction SilentlyContinue)
    if ($Tail.Count -eq 0) { return }
    Write-Host ""
    Write-Host "--- $Label ---" -ForegroundColor DarkYellow
    $Tail | ForEach-Object { Write-Host $_ }
}

try {
    $LaunchMutex = New-Object System.Threading.Mutex($false, $LaunchMutexName)
    try {
        $OwnsMutex = $LaunchMutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $OwnsMutex = $true
    }
    if (-not $OwnsMutex) {
        throw "Another development launcher is already active. Use the existing window or close it first."
    }

    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    Set-Content -LiteralPath $LauncherLog -Value "" -Encoding UTF8
    Set-Content -LiteralPath $StandardOutputLog -Value "" -Encoding UTF8
    Set-Content -LiteralPath $StandardErrorLog -Value "" -Encoding UTF8

    Write-LauncherLog "Passwhere - Development Launcher" Cyan
    Write-LauncherLog "Project: $ProjectRoot"
    Write-LauncherLog "Logs: $StandardOutputLog | $StandardErrorLog"

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js was not found. Install Node.js 20 or newer and try again."
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw "npm was not found. Reinstall Node.js with npm included."
    }
    if (-not (Test-Path -LiteralPath $RuntimeCommand)) {
        throw "Development command helper is missing: $RuntimeCommand"
    }

    $CargoExecutable = Join-Path $LocalCargoHome "bin\cargo.exe"
    if (Test-Path -LiteralPath $CargoExecutable) {
        $env:CARGO_HOME = $LocalCargoHome
        $env:RUSTUP_HOME = $LocalRustupHome
        $env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = "sparse"
        $env:CARGO_HTTP_MULTIPLEXING = "false"
        $env:CARGO_HTTP_CHECK_REVOKE = "false"
        $env:Path = "$(Join-Path $LocalCargoHome 'bin');$env:Path"
    }
    elseif (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw "Rust was not found. The local .tooling directory is incomplete and cargo is not available on PATH."
    }
    $CargoVersionOutput = & cargo.exe --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Rust toolchain is not runnable: $($CargoVersionOutput -join ' ')"
    }

    $VsDevCmd = $VsCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $VsDevCmd) {
        throw "Visual Studio C++ Build Tools were not found. Tauri development requires the Windows C++ toolchain."
    }

    $RunningApp = @(Get-RunningDevelopmentApp)
    if ($RunningApp.Count -gt 0) {
        throw "The development app is already running. Close its window before starting it again."
    }

    $PortOwner = Get-DevPortOwner
    if ($null -ne $PortOwner) {
        throw "Port $DevPort is already occupied by process $PortOwner. Close that process or change the Vite port."
    }

    Push-Location $ProjectRoot
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
            Write-LauncherLog "Installing frontend dependencies for the first run..." Yellow
            & npm.cmd install 2>&1 | Tee-Object -FilePath $StandardOutputLog -Append
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed with exit code $LASTEXITCODE."
            }
        }

        $env:PASSWHERE_PROJECT_ROOT = $ProjectRoot
        $env:PASSWHERE_VSDEVCMD = $VsDevCmd
        Write-LauncherLog "Starting the Tauri development window..." Green
        $DevProcess = Start-Process -FilePath $env:ComSpec `
            -ArgumentList "/d /c call `"$RuntimeCommand`"" `
            -WorkingDirectory $ProjectRoot `
            -RedirectStandardOutput $StandardOutputLog `
            -RedirectStandardError $StandardErrorLog `
            -NoNewWindow `
            -PassThru
        $StartedSession = $true

        $StartupDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
        $DevelopmentApp = $null
        while ((Get-Date) -lt $StartupDeadline) {
            $DevelopmentApp = @(Get-RunningDevelopmentApp) | Select-Object -First 1
            if ($null -ne $DevelopmentApp) { break }
            $DevProcess.Refresh()
            if ($DevProcess.HasExited) {
                throw "Tauri development exited before opening the app (exit code $($DevProcess.ExitCode))."
            }
            Start-Sleep -Milliseconds 250
        }
        if ($null -eq $DevelopmentApp) {
            throw "The development app did not open within $StartupTimeoutSeconds seconds."
        }

        $DevPortOwner = Wait-ForDevPortOwner 10
        if ($null -eq $DevPortOwner) {
            throw "The development window opened, but Vite is not listening on port $DevPort."
        }

        Write-LauncherLog "Development window is running. Close it to stop the local dev server." Green
        $MissingSince = $null
        while ($true) {
            $CurrentApp = @(Get-RunningDevelopmentApp) | Select-Object -First 1
            if ($null -ne $CurrentApp) {
                $MissingSince = $null
            }
            elseif ($null -eq $MissingSince) {
                $MissingSince = Get-Date
            }
            elseif (((Get-Date) - $MissingSince).TotalSeconds -ge 2) {
                break
            }

            $DevProcess.Refresh()
            if ($DevProcess.HasExited -and $null -eq $CurrentApp) {
                throw "The development command stopped unexpectedly (exit code $($DevProcess.ExitCode))."
            }
            Start-Sleep -Milliseconds 250
        }

        Write-LauncherLog "Development window closed; stopping the local dev server..." Yellow
    }
    finally {
        Pop-Location
    }
}
catch {
    $ExitCode = 1
    $Message = $_.Exception.Message
    if ($OwnsMutex -and (Test-Path -LiteralPath $LauncherLog)) {
        Write-LauncherLog "Startup failed: $Message" Red
    }
    else {
        Write-Host "Startup failed: $Message" -ForegroundColor Red
    }
    if ($StartedSession) {
        Show-LogTail $StandardErrorLog "Tauri stderr (last 30 lines)"
        Show-LogTail $StandardOutputLog "Tauri stdout (last 30 lines)"
    }
}
finally {
    if ($StartedSession) {
        @(Get-RunningDevelopmentApp) | ForEach-Object {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
        $CurrentPortOwner = Get-DevPortOwner
        if ($null -ne $DevPortOwner -and $CurrentPortOwner -eq $DevPortOwner) {
            Stop-Process -Id $DevPortOwner -Force -ErrorAction SilentlyContinue
        }
        if ($null -ne $DevProcess) {
            $DevProcess.Refresh()
            if (-not $DevProcess.HasExited) {
                Stop-Process -Id $DevProcess.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }
    if ($ExitCode -eq 0 -and (Test-Path -LiteralPath $LauncherLog)) {
        Write-LauncherLog "Development session stopped cleanly." Green
    }
    if ($OwnsMutex -and $null -ne $LaunchMutex) {
        $LaunchMutex.ReleaseMutex()
    }
    if ($null -ne $LaunchMutex) {
        $LaunchMutex.Dispose()
    }
}

exit $ExitCode
