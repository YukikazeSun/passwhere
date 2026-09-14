param(
    [switch]$ValidateOnly,
    [string]$SmokeTestArchive = ""
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ToolingRoot = Join-Path $ProjectRoot ".tooling"
$CargoHome = Join-Path $ToolingRoot "cargo"
$RustupHome = Join-Path $ToolingRoot "rustup"
$VsCandidates = @(
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat"
)
$PackageMetadata = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "package.json") | ConvertFrom-Json
$PackageLock = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "package-lock.json")
$TauriMetadata = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "src-tauri\tauri.conf.json") | ConvertFrom-Json
$CargoManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "src-tauri\Cargo.toml")
$CargoLock = Get-Content -Raw -Encoding UTF8 (Join-Path $ProjectRoot "src-tauri\Cargo.lock")
$Version = [string]$PackageMetadata.version
$PackageLockVersionMatch = [regex]::Match($PackageLock, '(?s)^\s*\{\s*"name"\s*:\s*"account-notebook"\s*,\s*"version"\s*:\s*"([^\"]+)"')
$PackageLockRootVersionMatch = [regex]::Match($PackageLock, '(?s)"packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"account-notebook"\s*,\s*"version"\s*:\s*"([^\"]+)"')
$CargoVersionMatch = [regex]::Match($CargoManifest, '(?m)^version\s*=\s*"([^\"]+)"\s*$')
$CargoLockVersionMatch = [regex]::Match($CargoLock, '(?ms)\[\[package\]\]\s+name\s*=\s*"account-notebook"\s+version\s*=\s*"([^\"]+)"')
if (-not $Version `
    -or -not $PackageLockVersionMatch.Success `
    -or $PackageLockVersionMatch.Groups[1].Value -ne $Version `
    -or -not $PackageLockRootVersionMatch.Success `
    -or $PackageLockRootVersionMatch.Groups[1].Value -ne $Version `
    -or [string]$TauriMetadata.version -ne $Version `
    -or -not $CargoVersionMatch.Success `
    -or $CargoVersionMatch.Groups[1].Value -ne $Version `
    -or -not $CargoLockVersionMatch.Success `
    -or $CargoLockVersionMatch.Groups[1].Value -ne $Version) {
    throw "Version mismatch across package.json, package-lock.json, tauri.conf.json, Cargo.toml, and Cargo.lock"
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

function Test-PortableArchive(
    [string]$Path,
    [string]$ExpectedPackageName,
    [string]$ExpectedProductName,
    [string]$ExpectedUsageName
) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $ResolvedArchivePath = (Resolve-Path -LiteralPath $Path).Path
    $Archive = [IO.Compression.ZipFile]::OpenRead($ResolvedArchivePath)
    try {
        $EntryNames = @($Archive.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('/', '\') })
        $ExpectedEntries = @(
            "$ExpectedPackageName\$ExpectedProductName.exe",
            "$ExpectedPackageName\$ExpectedUsageName"
        )
        $EntryDifference = @(Compare-Object -ReferenceObject $ExpectedEntries -DifferenceObject $EntryNames)
        if ($EntryNames.Count -ne 2 -or $EntryDifference.Count -ne 0) {
            throw "Portable archive contents are invalid: $($EntryNames -join ', ')"
        }
    }
    finally {
        $Archive.Dispose()
    }

    $TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    $SmokeRoot = Join-Path $TempRoot ("passwhere-release-smoke-{0}" -f [Guid]::NewGuid().ToString("N"))
    $ResolvedSmokeRoot = [IO.Path]::GetFullPath($SmokeRoot).TrimEnd('\')
    if (-not $ResolvedSmokeRoot.StartsWith("$TempRoot\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Release smoke directory escaped the system temporary directory"
    }

    $SmokeProcess = $null
    try {
        New-Item -ItemType Directory -Path $ResolvedSmokeRoot | Out-Null
        [IO.Compression.ZipFile]::ExtractToDirectory($ResolvedArchivePath, $ResolvedSmokeRoot)
        $SmokePackageDirectory = Join-Path $ResolvedSmokeRoot $ExpectedPackageName
        $SmokeExecutable = Join-Path $SmokePackageDirectory "$ExpectedProductName.exe"
        $SmokeDataDirectory = Join-Path $SmokePackageDirectory "data"
        if (-not (Test-Path -LiteralPath $SmokeExecutable -PathType Leaf)) {
            throw "Portable smoke executable is missing after extraction"
        }
        if (Test-Path -LiteralPath $SmokeDataDirectory) {
            throw "Portable archive unexpectedly contains a data directory"
        }

        $SmokeProcess = Start-Process -FilePath $SmokeExecutable `
            -WorkingDirectory $SmokePackageDirectory `
            -WindowStyle Hidden `
            -PassThru
        $StartupDeadline = (Get-Date).AddSeconds(30)
        $StartupReady = $false
        do {
            Start-Sleep -Milliseconds 250
            $SmokeProcess.Refresh()
            if ($SmokeProcess.HasExited) {
                throw "Portable smoke process exited early with code $($SmokeProcess.ExitCode)"
            }
            $ExpectedDataFiles = @(
                (Join-Path $SmokeDataDirectory "account-notebook.sqlite3"),
                (Join-Path $SmokeDataDirectory "device.json"),
                (Join-Path $SmokeDataDirectory "security.json")
            )
            $StartupReady = @($ExpectedDataFiles | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }).Count -eq 0 `
                -and $SmokeProcess.MainWindowTitle -eq $ExpectedProductName
        } while (-not $StartupReady -and (Get-Date) -lt $StartupDeadline)
        if (-not $StartupReady) {
            throw "Portable smoke process did not initialize its window and data within 30 seconds"
        }

        Start-Sleep -Milliseconds 750
        $SmokeProcess.Refresh()
        if ($SmokeProcess.HasExited) {
            throw "Portable smoke process did not remain running after initialization"
        }
        foreach ($DirectoryName in @("backups", "exports", "icons", "images")) {
            $ContentDirectory = Join-Path $SmokeDataDirectory $DirectoryName
            if (-not (Test-Path -LiteralPath $ContentDirectory -PathType Container)) {
                throw "Fresh portable data directory is missing: data\$DirectoryName"
            }
            if (@(Get-ChildItem -LiteralPath $ContentDirectory -Recurse -File -ErrorAction SilentlyContinue).Count -gt 0) {
                throw "Fresh portable data unexpectedly contains files under data\$DirectoryName"
            }
        }

        $SmokeWindowTitle = $SmokeProcess.MainWindowTitle
        $SmokeProcess.Refresh()
        if (-not $SmokeProcess.HasExited) {
            [void]$SmokeProcess.CloseMainWindow()
            if (-not $SmokeProcess.WaitForExit(5000)) {
                Stop-Process -Id $SmokeProcess.Id -Force -ErrorAction SilentlyContinue
                [void]$SmokeProcess.WaitForExit(5000)
            }
        }
        $VerificationProcess = Start-Process -FilePath $SmokeExecutable `
            -ArgumentList "--verify-first-run" `
            -WorkingDirectory $SmokePackageDirectory `
            -WindowStyle Hidden `
            -Wait `
            -PassThru
        if ($VerificationProcess.ExitCode -ne 0) {
            throw "Portable first-run encrypted empty-state verification failed with code $($VerificationProcess.ExitCode)"
        }

        [pscustomobject]@{
            ProcessId = $SmokeProcess.Id
            WindowTitle = $SmokeWindowTitle
            DataDirectory = $SmokeDataDirectory
            ArchiveEntries = $EntryNames.Count
        }
    }
    finally {
        if ($null -ne $SmokeProcess) {
            $SmokeProcess.Refresh()
            if (-not $SmokeProcess.HasExited) {
                [void]$SmokeProcess.CloseMainWindow()
                if (-not $SmokeProcess.WaitForExit(5000)) {
                    Stop-Process -Id $SmokeProcess.Id -Force -ErrorAction SilentlyContinue
                    [void]$SmokeProcess.WaitForExit(5000)
                }
            }
            $SmokeProcess.Dispose()
        }
        if (Test-Path -LiteralPath $ResolvedSmokeRoot) {
            $Removed = $false
            foreach ($Attempt in 1..5) {
                try {
                    Remove-Item -LiteralPath $ResolvedSmokeRoot -Recurse -Force
                    $Removed = $true
                    break
                }
                catch {
                    if ($Attempt -eq 5) { throw }
                    Start-Sleep -Milliseconds 250
                }
            }
            if (-not $Removed) { throw "Release smoke directory was not removed" }
        }
    }
}

if ($ValidateOnly -and $SmokeTestArchive) {
    throw "ValidateOnly and SmokeTestArchive cannot be used together"
}
if ($SmokeTestArchive) {
    $SmokeResult = Test-PortableArchive $SmokeTestArchive $PackageName $ProductName $UsageName
    Write-Host "Portable smoke test passed: $($SmokeResult.WindowTitle), entries=$($SmokeResult.ArchiveEntries)"
    exit 0
}
$VsDevCmd = $VsCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $VsDevCmd) { throw "Visual Studio C++ Build Tools were not found" }
if (-not (Test-Path -LiteralPath (Join-Path $CargoHome "bin\cargo.exe"))) {
    throw "Project Rust toolchain not found under .tooling"
}
$env:CARGO_HOME = $CargoHome
$env:RUSTUP_HOME = $RustupHome
$env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = "sparse"
$env:CARGO_HTTP_MULTIPLEXING = "false"
$env:CARGO_HTTP_CHECK_REVOKE = "false"
$env:Path = "$(Join-Path $CargoHome 'bin');$env:Path"
$CargoVersionOutput = & (Join-Path $CargoHome "bin\cargo.exe") --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Project Rust toolchain is not runnable: $($CargoVersionOutput -join ' ')"
}
if (-not (Test-Path -LiteralPath $UsageSource)) {
    throw "Portable usage guide not found: $UsageSource"
}
if ($ValidateOnly) {
    Write-Host "Release preflight passed for v$Version"
    Write-Host "Visual Studio environment: $VsDevCmd"
    exit 0
}

Push-Location $ProjectRoot
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE" }

    $RustTestCommand = '"{0}" -arch=x64 && cargo test --manifest-path src-tauri\Cargo.toml' -f $VsDevCmd
    & cmd.exe /d /c $RustTestCommand
    if ($LASTEXITCODE -ne 0) { throw "Rust tests failed with exit code $LASTEXITCODE" }

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

    $SmokeResult = Test-PortableArchive $ArchivePath $PackageName $ProductName $UsageName

    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ArchivePath).Hash
    Write-Host "Package directory: $PackageDirectory"
    Write-Host "Archive: $ArchivePath"
    Write-Host "SHA256: $Hash"
    Write-Host "Smoke test: $($SmokeResult.WindowTitle), entries=$($SmokeResult.ArchiveEntries)"
}
finally {
    Pop-Location
}
