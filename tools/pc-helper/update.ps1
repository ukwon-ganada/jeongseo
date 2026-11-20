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
# 도우미 지킴이: 로그인할 때·절전 해제/잠금 해제 뒤에도 꺼져 있으면 다시 켠다 (10분마다 확인, 이미 돌고 있으면 그냥 지나감)
$vbs = Join-Path $dir 'start-hidden.vbs'
$ps = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + (Join-Path $dir 'jeongseo-helper.ps1') + '""'
Set-Content $vbs ('CreateObject("WScript.Shell").Run "' + $ps + '", 0, False') -Encoding ASCII
try {
  $act = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')
  $t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
  $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName 'JeongseoHelperWatch' -Action $act -Trigger @($t1, $t2) -Settings $set -Force | Out-Null
  Write-Host '지킴이 등록: 도우미가 꺼져도 10분 안에 다시 켜집니다.'
} catch { Write-Host ('지킴이 등록 실패(도우미는 그대로 동작): ' + $_.Exception.Message) -ForegroundColor Yellow }
$args2 = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dir 'jeongseo-helper.ps1') + '"'
Start-Process powershell.exe -ArgumentList $args2 -WindowStyle Hidden
Write-Host '업데이트 끝. 새 도우미가 켜졌습니다.' -ForegroundColor Green
