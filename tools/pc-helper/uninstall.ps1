# 정서 사건 도우미 지우기 — uninstall.cmd 가 부름
$dir = Join-Path $env:APPDATA 'JeongseoHelper'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*jeongseo-helper.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) '정서 사건 도우미.lnk') -ErrorAction SilentlyContinue
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host '정서 사건 도우미를 지웠습니다.'
