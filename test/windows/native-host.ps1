# Developer bootstrap acceptance only. Runs on the disposable Windows runner.
# It does not open a library, install a package or touch production profiles.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReaderWindowProbe {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@

$root = (Resolve-Path "$PSScriptRoot\..\..\apps\windows\windows").Path
$executables = @(Get-ChildItem $root -Recurse -Filter ManabiReaderWindows.exe |
  Where-Object { $_.FullName -match '\\Release\\' -and $_.FullName -notmatch '\\(AppPackages|obj|BundleArtifacts)\\' })
if ($executables.Count -ne 1) {
  $executables | Select-Object FullName | Format-Table | Out-String | Write-Host
  throw "Expected one built Release executable, found $($executables.Count)."
}

$app = $null
$window = $null
function Wait-For([string]$description, [scriptblock]$condition) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    $app.Refresh()
    if ($app.HasExited) { throw "Host exited with $($app.ExitCode) while waiting for $description." }
    $value = & $condition
    if ($value) { return $value }
    Start-Sleep -Milliseconds 200
  }
  throw "Timed out waiting for $description."
}
function Find-Id([string]$id) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
  return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

try {
  $app = Start-Process $executables[0].FullName -WorkingDirectory $executables[0].DirectoryName -PassThru
  $handle = Wait-For 'native window' { if ($app.MainWindowHandle -ne [IntPtr]::Zero) { $app.MainWindowHandle } }
  $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $platform = Wait-For 'React Native Windows content' {
    $element = Find-Id 'host-platform'
    if ($element -and $element.Current.Name -match '^windows') { $element }
  }
  Write-Host "Rendered host: $($platform.Current.Name)"

  $inputControl = Wait-For 'native input control' { Find-Id 'host-input' }
  $valuePattern = $inputControl.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $valuePattern.SetValue('Reader offline input check')
  Wait-For 'input state reflected in React text' {
    $echo = Find-Id 'host-input-echo'
    $echo -and $echo.Current.Name -eq 'Reader offline input check'
  } | Out-Null
  $button = Wait-For 'native button' { Find-Id 'host-increment' }
  $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  Wait-For 'button updates React state' { (Find-Id 'host-increment').Current.Name -match 'Interaction check: 1' } | Out-Null

  foreach ($width in @(540, 1100)) {
    if (![ReaderWindowProbe]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, $width, 760, 0x0006)) {
      throw 'Native window resize failed.'
    }
    Wait-For "React dimensions after resize to $width" {
      $name = (Find-Id 'host-platform').Current.Name
      if ($name -match '^windows.*?(\d+)') {
        $actual = [int]$Matches[1]
        if ($width -eq 540) { $actual -gt 0 -and $actual -lt 700 }
        else { $actual -gt 900 }
      }
    } | Out-Null
  }
  [ordered]@{
    nativeRuntime = 'bootstrap-pass'
    platform = 'windows'
    architecture = 'x64'
    executableSha256 = (Get-FileHash $executables[0].FullName -Algorithm SHA256).Hash
    rendered = $true
    inputState = $true
    buttonState = $true
    resize = $true
    readerPersistence = 'unqualified'
    installerAndUpgrade = 'unqualified'
  } | ConvertTo-Json | Write-Host
}
catch {
  if ($window) {
    $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition) |
      Select-Object -First 40 | ForEach-Object {
        Write-Host "UIA: $($_.Current.AutomationId) | $($_.Current.Name)"
      }
  }
  throw
}
finally {
  if ($app -and !$app.HasExited) {
    $app.CloseMainWindow() | Out-Null
    if (!$app.WaitForExit(10000)) {
      Stop-Process -Id $app.Id
      $app.WaitForExit()
    }
  }
}
