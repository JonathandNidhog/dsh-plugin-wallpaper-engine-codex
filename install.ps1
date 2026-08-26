param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE 'plugins\dsh-plugin-wallpaper-engine-codex'),
  [string]$MarketplacePath = (Join-Path $env:USERPROFILE '.agents\plugins\marketplace.json'),
  [switch]$SkipCodexRegistration,
  [switch]$SkipShortcuts
)

$ErrorActionPreference = 'Stop'
$pluginName = 'dsh-plugin-wallpaper-engine-codex'
$repository = 'https://github.com/JonathandNidhog/dsh-plugin-wallpaper-engine-codex.git'
$archiveUrl = 'https://github.com/JonathandNidhog/dsh-plugin-wallpaper-engine-codex/archive/refs/heads/main.zip'

function Install-PluginSource {
  param([string]$Destination)

  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git -and (Test-Path -LiteralPath (Join-Path $Destination '.git'))) {
    & $git.Source -C $Destination pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Could not update the existing plugin checkout.' }
    return
  }
  if ($git -and -not (Test-Path -LiteralPath $Destination)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    & $git.Source clone --depth 1 $repository $Destination
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone the plugin repository.' }
    return
  }

  $temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("codex-wallpaper-install-" + [guid]::NewGuid().ToString('N'))
  $archive = Join-Path $temporaryRoot 'plugin.zip'
  $expanded = Join-Path $temporaryRoot 'expanded'
  New-Item -ItemType Directory -Force -Path $expanded | Out-Null
  try {
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
    $downloaded = Get-ChildItem -LiteralPath $expanded -Directory | Select-Object -First 1
    if (-not $downloaded -or -not (Test-Path -LiteralPath (Join-Path $downloaded.FullName '.codex-plugin\plugin.json'))) {
      throw 'The downloaded archive is not a valid Codex plugin.'
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    if (Test-Path -LiteralPath $Destination) {
      $item = Get-Item -LiteralPath $Destination
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing to replace the existing linked plugin directory: $Destination"
      }
      $backup = "$Destination.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      Move-Item -LiteralPath $Destination -Destination $backup
      Write-Host "Previous installation backed up to $backup"
    }
    Move-Item -LiteralPath $downloaded.FullName -Destination $Destination
  } finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
      $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
      $resolvedTempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
      if (-not $resolvedTemporaryRoot.StartsWith($resolvedTempBase, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean an unexpected temporary path: $resolvedTemporaryRoot"
      }
      Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
    }
  }
}

function Register-PersonalMarketplace {
  param([string]$Path)

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  if (Test-Path -LiteralPath $Path) {
    $marketplace = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    if ($marketplace.name -ne 'personal') {
      throw "The existing marketplace is named '$($marketplace.name)', not 'personal': $Path"
    }
  } else {
    $marketplace = [pscustomobject]@{
      name = 'personal'
      interface = [pscustomobject]@{ displayName = 'Personal' }
      plugins = @()
    }
  }

  $entry = [pscustomobject]@{
    name = $pluginName
    source = [pscustomobject]@{ source = 'local'; path = "./plugins/$pluginName" }
    policy = [pscustomobject]@{ installation = 'AVAILABLE'; authentication = 'ON_INSTALL' }
    category = 'Productivity'
  }
  $plugins = @($marketplace.plugins | Where-Object { $_.name -ne $pluginName })
  $marketplace.plugins = @($plugins + $entry)
  $marketplace | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Install-CodexSkinShortcuts {
  param([string]$PluginRoot)

  $sourceLauncher = Join-Path $PluginRoot 'scripts\launch-codex-with-skin.ps1'
  $stableRoot = Join-Path $env:LOCALAPPDATA 'CodexWallpaperEngineSkin'
  $stableLauncher = Join-Path $stableRoot 'launch-codex-with-skin.ps1'
  New-Item -ItemType Directory -Force -Path $stableRoot | Out-Null
  Copy-Item -LiteralPath $sourceLauncher -Destination $stableLauncher -Force

  $package = Get-AppxPackage -Name 'OpenAI.Codex'
  if (-not $package) { throw 'OpenAI Codex for Windows is not installed.' }
  $codexExe = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
  $shell = New-Object -ComObject WScript.Shell
  $shortcutPaths = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex Wallpaper Skin.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Codex Wallpaper Skin.lnk')
  )
  foreach ($shortcutPath in $shortcutPaths) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = 'powershell.exe'
    $shortcut.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$stableLauncher`""
    $shortcut.WorkingDirectory = $stableRoot
    $shortcut.IconLocation = "$codexExe,0"
    $shortcut.Description = 'Launch Codex and restore the Wallpaper Engine skin'
    $shortcut.Save()
  }
}

Write-Host 'Installing Wallpaper Engine Skin for Codex...'
Install-PluginSource -Destination $InstallRoot
Register-PersonalMarketplace -Path $MarketplacePath

if (-not $SkipCodexRegistration) {
  $codex = Get-Command codex -ErrorAction SilentlyContinue
  if (-not $codex) { throw 'The codex command was not found. Install or update Codex, then run this installer again.' }
  & $codex.Source plugin add "$pluginName@personal"
  if ($LASTEXITCODE -ne 0) { throw 'Codex could not install the plugin from the personal marketplace.' }
}
if (-not $SkipShortcuts) { Install-CodexSkinShortcuts -PluginRoot $InstallRoot }

Write-Host ''
Write-Host 'Installation complete.' -ForegroundColor Green
Write-Host 'Close all Codex windows, then launch "Codex Wallpaper Skin" from the desktop or Start menu.'
Write-Host 'Run this installer again at any time to update the plugin.'
