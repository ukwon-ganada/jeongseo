# 정서 사건 도우미 설치 — install.cmd 가 부름
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $env:APPDATA 'JeongseoHelper'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
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

Start-Process powershell.exe -ArgumentList $s.Arguments -WindowStyle Hidden
Write-Host '설치 끝. 지금부터 사건방 메뉴 "이 방 사건 보기"를 누르면 이 PC에 사건 화면이 열립니다.' -ForegroundColor Green
