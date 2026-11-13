# 정서 사건 도우미 새 버전으로 바꾸기 — update.cmd 가 부름 (토큰은 그대로 씀)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $env:APPDATA 'JeongseoHelper'
if (-not (Test-Path (Join-Path $dir 'config.json'))) { Write-Host '도우미가 설치돼 있지 않습니다. install.cmd 로 먼저 설치해 주세요.' -ForegroundColor Red; exit 1 }
# 돌고 있는 옛 도우미 끄기
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*jeongseo-helper.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 500
Copy-Item (Join-Path $src 'jeongseo-helper.ps1') $dir -Force
$args2 = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dir 'jeongseo-helper.ps1') + '"'
Start-Process powershell.exe -ArgumentList $args2 -WindowStyle Hidden
Write-Host '업데이트 끝. 새 도우미가 켜졌습니다.' -ForegroundColor Green
