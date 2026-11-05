param([string]$Root = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
function Get-RepairLatestVersion {
  $response = Invoke-WebRequest -UseBasicParsing -Uri 'https://api.github.com/repos/bhb414/binance-tradingbot-ko/releases/latest' -Headers @{ 'User-Agent' = 'binance-workroom-repair' } -TimeoutSec 30
  $release = $response.Content | ConvertFrom-Json
  if ($release.draft -or $release.prerelease -or $release.tag_name -cnotmatch '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { throw '정식 공개 릴리즈를 확인하지 못했습니다.' }
  return $release.tag_name.Substring(1)
}
function Save-RepairFile([string]$Uri, [string]$Filename) {
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Filename -Headers @{ 'User-Agent' = 'binance-workroom-repair' } -TimeoutSec 60
}
function Expand-RepairPackage([string]$Archive, [string]$Destination) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    if ($zip.Entries.Count -lt 1 -or $zip.Entries.Count -gt 5000) { throw '배포 ZIP 파일 수를 확인해 주세요.' }
    $base = [System.IO.Path]::GetFullPath($Destination) + [System.IO.Path]::DirectorySeparatorChar
    $names = @{}
    [long]$expanded = 0
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName
      if (-not $name.StartsWith('binance-tradingbot-ko/', [System.StringComparison]::Ordinal) -or $name.Contains('\') -or $name.Contains(':')) { throw '배포 ZIP 경로를 확인해 주세요.' }
      $relative = $name.Substring('binance-tradingbot-ko/'.Length).TrimEnd('/')
      if ($relative) {
        foreach ($part in $relative.Split('/')) {
          if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$|^[\s]|[<>"|?*\x00-\x1f]' -or $part -match '^(\.git|con|prn|aux|nul|com[1-9]|lpt[1-9])($|\.)') { throw '배포 ZIP에 안전하지 않은 경로가 있습니다.' }
        }
        if ($relative -match '^(\.runtime|\.migration-backup|dist|node_modules|asset-sources|previews)($|/)|(^|/)\.env($|\.)|\.(dpapi|pem|key)$') { throw '배포 ZIP에 개인 파일 경로가 포함되어 있습니다.' }
      }
      $target = [System.IO.Path]::GetFullPath((Join-Path $Destination ($name.Replace('/', [System.IO.Path]::DirectorySeparatorChar))))
      if (-not $target.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) { throw '배포 ZIP이 임시 폴더를 벗어났습니다.' }
      $mode = ($entry.ExternalAttributes -shr 16) -band 61440
      if ($mode -ne 0 -and $mode -ne 32768 -and $mode -ne 16384) { throw '배포 ZIP 링크를 사용할 수 없습니다.' }
      if ($names.ContainsKey($name)) { throw '배포 ZIP 경로가 중복되었습니다.' }
      $names[$name] = $true
      $expanded += $entry.Length
      if ($entry.Length -gt 16777216 -or $expanded -gt 134217728) { throw '배포 ZIP 압축 해제 크기를 초과했습니다.' }
    }
  } finally { $zip.Dispose() }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
  $candidate = Join-Path $Destination 'binance-tradingbot-ko'
  if (-not (Test-Path -LiteralPath (Join-Path $candidate 'tools/update.mjs') -PathType Leaf)) { throw '배포본의 복구 도구가 없습니다.' }
  return $candidate
}
function Invoke-RepairNode([string]$Candidate, [string]$Installation) {
  & node.exe (Join-Path $Candidate 'tools/update.mjs') --repair --root $Installation
  if ($LASTEXITCODE -ne 0) { throw '파일 복구를 완료하지 못했습니다. 위의 오류를 확인해 주세요.' }
}
function Invoke-WorkroomRepair([string]$Installation) {
  $Installation = (Resolve-Path -LiteralPath $Installation).ProviderPath
  $package = Join-Path $Installation 'package.json'
  if (-not (Test-Path -LiteralPath $package -PathType Leaf) -or (Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).name -ne 'binance-tradingbot-ko') { throw 'repair.cmd와 repair.ps1을 run.cmd가 있는 프로그램 폴더에 넣고 실행해 주세요.' }
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $stage = Join-Path ([System.IO.Path]::GetTempPath()) ('binance-workroom-repair-' + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $stage | Out-Null
  try {
    Write-Host '공식 배포본으로 전체 프로그램 파일을 검사·복구합니다. 키·봇 설정·매매 기록은 유지합니다.'
    $version = Get-RepairLatestVersion
    if ([Version]$version -lt [Version]'0.4.54') { throw '전체 파일 복구를 지원하는 정식 릴리즈가 아직 준비되지 않았습니다. 잠시 후 다시 실행해 주세요.' }
    $name = 'binance-tradingbot-ko-v' + $version + '-windows.zip'
    $base = 'https://github.com/bhb414/binance-tradingbot-ko/releases/download/v' + $version + '/'
    $checksumFile = Join-Path $stage 'SHA256SUMS.txt'
    $archive = Join-Path $stage $name
    Save-RepairFile ($base + 'SHA256SUMS.txt') $checksumFile
    $checks = @(Get-Content -LiteralPath $checksumFile | ForEach-Object { if ($_ -cmatch ('^([a-fA-F0-9]{64}) [ *]' + [regex]::Escape($name) + '$')) { $Matches[1] } })
    if ($checks.Count -ne 1) { throw '공식 ZIP 체크섬을 확인하지 못했습니다.' }
    Save-RepairFile ($base + $name) $archive
    if ((Get-Item -LiteralPath $archive).Length -gt 33554432) { throw '배포 ZIP 다운로드 크기를 초과했습니다.' }
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($archive)
    try { $actualHash = [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') } finally { $stream.Dispose(); $algorithm.Dispose() }
    if ($actualHash -ne $checks[0]) { throw '다운로드 체크섬이 다릅니다. 프로그램 파일은 변경하지 않았습니다.' }
    $candidate = Expand-RepairPackage $archive (Join-Path $stage 'verified')
    Invoke-RepairNode $candidate $Installation
  } finally {
    $resolved = [System.IO.Path]::GetFullPath($stage)
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not [System.IO.Path]::GetFileName($resolved).StartsWith('binance-workroom-repair-')) { throw '복구 임시 폴더 경로를 확인하지 못했습니다.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
if ($MyInvocation.InvocationName -ne '.') {
  try { Invoke-WorkroomRepair $Root } catch { Write-Host ('복구 중단: ' + $_.Exception.Message); exit 1 }
}
