param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9222,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework

function Show-LauncherMessage {
  param(
    [string]$Text,
    [string]$Title = 'Codex Wallpaper Skin',
    [System.Windows.MessageBoxButton]$Buttons = [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]$Icon = [System.Windows.MessageBoxImage]::Information
  )
  return [System.Windows.MessageBox]::Show($Text, $Title, $Buttons, $Icon)
}

if ($ValidateOnly) {
  Write-Output 'Launcher validation passed.'
  exit 0
}

try {
  $running = @(Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -notmatch '--type=' })

  $alreadyEnabled = @($running | Where-Object { $_.CommandLine -match "--remote-debugging-port(?:=|\s)$Port(?:\s|$)" })
  if ($alreadyEnabled.Count -gt 0) {
    Show-LauncherMessage -Text 'Codex is already running with Wallpaper Skin support enabled.' | Out-Null
    exit 0
  }

  if ($running.Count -gt 0) {
    $choice = Show-LauncherMessage `
      -Text "Codex is already running without Wallpaper Skin support.`n`nRestart it now with skin support enabled? Running tasks may be interrupted." `
      -Buttons ([System.Windows.MessageBoxButton]::YesNo) `
      -Icon ([System.Windows.MessageBoxImage]::Warning)
    if ($choice -ne [System.Windows.MessageBoxResult]::Yes) { exit 0 }

    $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 250
      $stillRunning = @(Get-CimInstance Win32_Process |
        Where-Object { $_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -notmatch '--type=' })
    } while ($stillRunning.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
    if ($stillRunning.Count -gt 0) { throw 'Codex did not close within 15 seconds.' }
  }

  $package = Get-AppxPackage -Name 'OpenAI.Codex'
  if (-not $package) {
    throw 'The installed OpenAI Codex Windows package was not found.'
  }

  $executable = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
  if (-not (Test-Path -LiteralPath $executable)) {
    throw "Codex executable not found at $executable"
  }

  Start-Process -FilePath $executable -ArgumentList "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=$Port"
} catch {
  Show-LauncherMessage -Text "Could not start Codex Wallpaper Skin.`n`n$($_.Exception.Message)" -Icon ([System.Windows.MessageBoxImage]::Error) | Out-Null
  exit 1
}
