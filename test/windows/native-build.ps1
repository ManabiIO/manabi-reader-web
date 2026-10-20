# A successful CLI exit must also produce a fresh native executable.
param([Parameter(Mandatory)][ValidateSet('Debug', 'Release')][string]$Configuration)
$ErrorActionPreference = 'Stop'
if (!$env:READER_PNPM_ENTRY) { throw 'Missing verified pnpm entry point.' }
$started = [DateTime]::UtcNow
$arguments = @('--dir', 'apps/windows', 'windows')
if ($Configuration -eq 'Release') { $arguments += '--release' }
$arguments += @('--arch', 'x64', '--no-deploy', '--no-launch', '--logging',
  '--msbuildprops', 'AppxPackageSigningEnabled=false')
& node $env:READER_PNPM_ENTRY @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$root = (Resolve-Path "$PSScriptRoot\..\..\apps\windows\windows").Path
$executables = @(Get-ChildItem $root -Recurse -Filter ManabiReaderWindows.exe |
  Where-Object {
    $_.FullName -match "\\$Configuration\\" -and
    $_.FullName -notmatch '\\(AppPackages|obj|BundleArtifacts)\\'
  })
if ($executables.Count -ne 1 -or $executables[0].LastWriteTimeUtc -lt $started) {
  $executables | Select-Object FullName, LastWriteTimeUtc | Format-Table | Out-String | Write-Host
  throw "Expected one fresh $Configuration executable, found $($executables.Count)."
}
Get-FileHash $executables[0].FullName -Algorithm SHA256 | Format-List | Out-String | Write-Host
