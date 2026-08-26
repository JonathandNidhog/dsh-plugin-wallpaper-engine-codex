param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [ValidateRange(4, 60)]
  [int]$FrameCount = 60,

  [ValidateRange(1, 30)]
  [double]$DurationSeconds = 4,

  [ValidateRange(320, 1920)]
  [int]$MaxWidth = 1280,

  [ValidateRange(30, 95)]
  [int]$JpegQuality = 75
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$inputFile = Get-Item -LiteralPath $InputPath
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$player = [System.Windows.Media.MediaPlayer]::new()
$opened = $false
$failure = $null
$player.add_MediaOpened({ $script:opened = $true })
$player.add_MediaFailed({ $script:failure = $_.ErrorException })

function Invoke-DispatcherPump([int]$Milliseconds) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($Milliseconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    [System.Windows.Threading.Dispatcher]::CurrentDispatcher.Invoke(
      [System.Windows.Threading.DispatcherPriority]::Background,
      [System.Action]{ }
    )
    Start-Sleep -Milliseconds 20
  }
}

try {
  $player.Volume = 0
  $player.ScrubbingEnabled = $true
  $player.Open([System.Uri]::new($inputFile.FullName))
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while (-not $opened -and -not $failure -and [DateTime]::UtcNow -lt $deadline) {
    Invoke-DispatcherPump 40
  }
  if ($failure) { throw $failure }
  if (-not $opened -or $player.NaturalVideoWidth -le 0 -or $player.NaturalVideoHeight -le 0) {
    throw 'Timed out while decoding the video dimensions.'
  }
  $player.Play()
  Invoke-DispatcherPump 350
  $player.Pause()

  $sourceWidth = $player.NaturalVideoWidth
  $sourceHeight = $player.NaturalVideoHeight
  $scale = [Math]::Min(1.0, $MaxWidth / [double]$sourceWidth)
  $width = [Math]::Max(2, [int]([Math]::Round($sourceWidth * $scale / 2) * 2))
  $height = [Math]::Max(2, [int]([Math]::Round($sourceHeight * $scale / 2) * 2))
  $startSeconds = 1.0
  if ($player.NaturalDuration.HasTimeSpan) {
    $available = [Math]::Max(1.0, $player.NaturalDuration.TimeSpan.TotalSeconds - $startSeconds - 0.2)
    $DurationSeconds = [Math]::Min($DurationSeconds, $available)
  }

  for ($index = 0; $index -lt $FrameCount; $index++) {
    $seconds = $startSeconds + ($DurationSeconds * $index / $FrameCount)
    $player.Position = [TimeSpan]::FromSeconds($seconds)
    Invoke-DispatcherPump 80

    $visual = [System.Windows.Media.DrawingVisual]::new()
    $context = $visual.RenderOpen()
    $context.DrawVideo($player, [System.Windows.Rect]::new(0, 0, $width, $height))
    $context.Close()
    $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(
      $width, $height, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32
    )
    $bitmap.Render($visual)
    $encoder = [System.Windows.Media.Imaging.JpegBitmapEncoder]::new()
    $encoder.QualityLevel = $JpegQuality
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $path = Join-Path $OutputDirectory ('frame-{0:D3}.jpg' -f $index)
    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Create)
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
  }

  [pscustomobject]@{
    sourceWidth = $sourceWidth
    sourceHeight = $sourceHeight
    renderWidth = $width
    renderHeight = $height
    frameCount = $FrameCount
    frameDelayMs = [int]([Math]::Round($DurationSeconds * 1000 / $FrameCount))
    frameRate = [Math]::Round($FrameCount / $DurationSeconds, 2)
  } | ConvertTo-Json -Compress
} finally {
  $player.Close()
}
