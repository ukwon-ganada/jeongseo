# 정서 사건 도우미 설치 — install.cmd 가 부름
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $env:APPDATA 'JeongseoHelper'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
# 이미 돌고 있는 옛 도우미가 있으면 끄고 새로 깐다
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*jeongseo-helper.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Copy-Item (Join-Path $src 'jeongseo-helper.ps1') $dir -Force

Write-Host ''
Write-Host '정서 사건 도우미 설치' -ForegroundColor Cyan
Write-Host '관리자에게 받은 도우미 토큰(48자리)을 붙여 넣고 Enter를 누르세요.'
Write-Host '(토큰은 이 PC에만 저장됩니다. 메신저·채팅에 붙이지 마세요.)'
$token = (Read-Host '토큰').Trim()
if ($token -notmatch '^[0-9a-f]{48}$') { Write-Host '토큰 모양이 맞지 않습니다. 다시 실행해 주세요.' -ForegroundColor Red; exit 1 }

$cfg = Get-Content (Join-Path $src 'server.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$out = [ordered]@{ endpoint = $cfg.endpoint; anon = $cfg.anon; token = $token }
($out | ConvertTo-Json) | Set-Content (Join-Path $dir 'config.json') -Encoding UTF8

# 윈도우 켜질 때 자동 시작 (시작프로그램 폴더 바로가기, 창 숨김)
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) '정서 사건 도우미.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = 'powershell.exe'
$s.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dir 'jeongseo-helper.ps1') + '"'
$s.WindowStyle = 7
$s.Save()

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
Start-Process powershell.exe -ArgumentList $s.Arguments -WindowStyle Hidden
Write-Host '설치 끝. 지금부터 사건방 메뉴 "이 방 사건 보기"를 누르면 이 PC에 사건 화면이 열립니다.' -ForegroundColor Green
