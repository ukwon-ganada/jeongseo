# 정서 사건 도우미 — 사건방 "이 방 사건 보기"를 누르면 이 PC 브라우저에 사건 화면을 연다.
# 화면 없이 뒤에서 돈다. 설정: %APPDATA%\JeongseoHelper\config.json (설치 때 만들어짐)
# 끄기: 작업 관리자 > powershell(정서 사건 도우미) 끝내기, 또는 uninstall.cmd
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:APPDATA 'JeongseoHelper'
$cfg = Get-Content (Join-Path $dir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$log = Join-Path $dir 'helper.log'
function Write-Log($m) { try { Add-Content $log ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m) -Encoding UTF8 } catch {} }

# 같은 도우미가 두 개 뜨지 않게
$mutex = New-Object System.Threading.Mutex($false, 'Global\JeongseoHelper')
if (-not $mutex.WaitOne(0)) { exit }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ Authorization = "Bearer $($cfg.token)"; apikey = $cfg.anon }
Write-Log '시작'
$fail = 0
while ($true) {
  try {
    $r = Invoke-WebRequest -Uri $cfg.endpoint -Headers $headers -TimeoutSec 40 -UseBasicParsing
    $fail = 0
    if ($r.StatusCode -eq 200) {
      $url = ($r.Content | ConvertFrom-Json).url
      # 웍스 사건 화면 주소만 연다 (다른 주소는 무시)
      if ($url -like 'https://woff.worksmobile.com/woff/*') { Start-Process $url; Write-Log "열기 $url" }
      else { Write-Log "무시한 주소 $url" }
    }
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 401) { Write-Log '토큰이 막혔거나 틀림 - 종료'; break }
    $fail++
    Write-Log "연결 실패($fail): $($_.Exception.Message)"
    Start-Sleep -Seconds ([Math]::Min(60, 3 * $fail))
  }
}
