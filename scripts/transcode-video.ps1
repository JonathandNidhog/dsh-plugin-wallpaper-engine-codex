param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [ValidateRange(640, 3840)]
  [int]$MaxWidth = 2560,

  [ValidateRange(360, 2160)]
  [int]$MaxHeight = 1440,

  [ValidateRange(1000, 50000)]
  [int]$VideoBitrateKbps = 10000,

  [ValidateRange(15, 60)]
  [int]$MaxFrameRate = 30
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskOperation = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
  $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$asTaskActionWithProgress = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
  $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1'
} | Select-Object -First 1

function Wait-WinRtResult($Operation, [Type]$ResultType) {
  $task = $script:asTaskOperation.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

function Wait-WinRtActionWithProgress($Operation, [Type]$ProgressType) {
  $task = $script:asTaskActionWithProgress.MakeGenericMethod($ProgressType).Invoke($null, @($Operation))
  $task.Wait()
}

$inputFile = Wait-WinRtResult ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime]::GetFileFromPathAsync((Get-Item -LiteralPath $InputPath).FullName)) ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime])
$videoProperties = Wait-WinRtResult ($inputFile.Properties.GetVideoPropertiesAsync()) ([Windows.Storage.FileProperties.VideoProperties,Windows,ContentType=WindowsRuntime])
$sourceWidth = [int]$videoProperties.Width
$sourceHeight = [int]$videoProperties.Height
if ($sourceWidth -le 0 -or $sourceHeight -le 0) { throw 'Could not read the source video dimensions.' }

$scale = [Math]::Min(1.0, [Math]::Min($MaxWidth / [double]$sourceWidth, $MaxHeight / [double]$sourceHeight))
$outputWidth = [Math]::Max(2, [int]([Math]::Round($sourceWidth * $scale / 2) * 2))
$outputHeight = [Math]::Max(2, [int]([Math]::Round($sourceHeight * $scale / 2) * 2))

$outputDirectory = Split-Path -Parent $OutputPath
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$outputFolder = Wait-WinRtResult ([Windows.Storage.StorageFolder,Windows,ContentType=WindowsRuntime]::GetFolderFromPathAsync($outputDirectory)) ([Windows.Storage.StorageFolder,Windows,ContentType=WindowsRuntime])
$outputFile = Wait-WinRtResult ($outputFolder.CreateFileAsync((Split-Path -Leaf $OutputPath), [Windows.Storage.CreationCollisionOption,Windows,ContentType=WindowsRuntime]::ReplaceExisting)) ([Windows.Storage.StorageFile,Windows,ContentType=WindowsRuntime])

$profile = [Windows.Media.MediaProperties.MediaEncodingProfile,Windows,ContentType=WindowsRuntime]::CreateMp4([Windows.Media.MediaProperties.VideoEncodingQuality,Windows,ContentType=WindowsRuntime]::HD1080p)
$profile.Audio = $null
$profile.Video.Width = $outputWidth
$profile.Video.Height = $outputHeight
$profile.Video.Bitrate = $VideoBitrateKbps * 1000
$profile.Video.FrameRate.Numerator = $MaxFrameRate
$profile.Video.FrameRate.Denominator = 1

$transcoder = [Windows.Media.Transcoding.MediaTranscoder,Windows,ContentType=WindowsRuntime]::new()
$transcoder.HardwareAccelerationEnabled = $true
$prepared = Wait-WinRtResult ($transcoder.PrepareFileTranscodeAsync($inputFile, $outputFile, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult,Windows,ContentType=WindowsRuntime])
if (-not $prepared.CanTranscode) { throw "Windows Media Foundation cannot transcode this file: $($prepared.FailureReason)" }
Wait-WinRtActionWithProgress ($prepared.TranscodeAsync()) ([double])

$outputInfo = Get-Item -LiteralPath $OutputPath
[pscustomobject]@{
  sourceWidth = $sourceWidth
  sourceHeight = $sourceHeight
  outputWidth = $outputWidth
  outputHeight = $outputHeight
  outputBytes = $outputInfo.Length
  bitrateKbps = $VideoBitrateKbps
  frameRate = $MaxFrameRate
} | ConvertTo-Json -Compress
