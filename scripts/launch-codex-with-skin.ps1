param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'

$running = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -notmatch '--type=' }

if ($running) {
  throw 'Codex is already running. Close all Codex windows, wait a few seconds, and run this launcher again.'
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
Write-Output "Started Codex with the local skin bridge debug port on 127.0.0.1:$Port."
