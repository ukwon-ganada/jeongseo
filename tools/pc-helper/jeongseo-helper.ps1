# 정서 사건 도우미 — 사건방 "이 방 사건 보기"를 누르면 이 PC 브라우저에 사건 화면을 연다.
# v2.1: 따로 띄운 대화방 창도 찾음(창 제목=방 이름), 메인 창이 숨어 있어도 찾음
# v2: 사건 화면이 "지금 어느 방?"을 물으면 웍스 창 위쪽 방 제목을 윈도우 글자 인식으로 읽어 서버에 알려 준다.
#     (방 제목 줄만 보냄: 왼쪽 방 목록·대화 내용은 보내지 않음)
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
$base = ($cfg.endpoint -split '\?')[0]
$waitUrl = $base + '?v=2'

# ── 웍스 창 방 제목 읽기 (처음 필요할 때 한 번 준비) ─────────────────
$script:ocrReady = $false
function Initialize-Ocr {
  if ($script:ocrReady) { return }
  Add-Type -AssemblyName System.Drawing
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class JsWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  // 맨 위 창부터 차례로 (z-order)
  public static IntPtr[] TopWindows() {
    var list = new System.Collections.Generic.List<IntPtr>();
    EnumWindows((h, l) => { list.Add(h); return true; }, IntPtr.Zero);
    return list.ToArray();
  }
  public static string Title(IntPtr h) { var sb = new System.Text.StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static Bitmap Capture(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    var b = new Bitmap(Math.Max(1, r.R - r.L), Math.Max(1, r.B - r.T));
    using (var g = Graphics.FromImage(b)) { var dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
    return b;
  }
}
"@
  [void][JsWin]::SetProcessDPIAware()
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $script:engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ko'))
  if (-not $script:engine) { $script:engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $script:engine) { throw '한국어 글자 인식 없음' }
  $script:ocrReady = $true
}
function Await($op, [Type]$t) {
  $task = $script:asTask.MakeGenericMethod($t).Invoke($null, @($op))
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while (-not $task.IsCompleted) { Start-Sleep -Milliseconds 20; if ($sw.ElapsedMilliseconds -gt 8000) { throw '글자 인식 응답 없음' } }
  $task.Result
}
# 웍스 메인 창 위쪽 18%를 찍어 읽고, 방 제목 띠(왼쪽 20% 이후, 위 12% 안)의 줄만 돌려준다
function Read-WorksRoomTitle {
  Initialize-Ocr
  # 웍스 프로그램 찾기: 'WORKS' 제목 창(숨어 있어도)의 프로세스, 없으면 이름에 works 가 든 프로세스
  $wins = [JsWin]::TopWindows()
  $pids = @{}
  foreach ($w in $wins) { if ([JsWin]::Title($w) -eq 'WORKS') { $pids[[int][JsWin]::Pid($w)] = 1 } }
  if ($pids.Count -eq 0) { Get-Process | Where-Object { $_.ProcessName -match 'works' } | ForEach-Object { $pids[$_.Id] = 1 } }
  if ($pids.Count -eq 0) { throw '웍스 프로그램 없음' }
  # 그중 화면에 보이는 맨 위 창 = 직원이 방금 보던 창
  $h = [IntPtr]::Zero; $title = ''
  foreach ($w in $wins) {
    if (-not $pids.ContainsKey([int][JsWin]::Pid($w))) { continue }
    if (-not [JsWin]::IsWindowVisible($w) -or [JsWin]::IsIconic($w)) { continue }
    $t = [JsWin]::Title($w)
    if (-not $t) { continue }
    $h = $w; $title = $t; break
  }
  if ($h -eq [IntPtr]::Zero) { throw '보이는 웍스 창 없음' }
  # 대화방을 따로 띄운 창은 창 제목이 곧 방 이름 → 글자 인식 없이 바로
  if ($title -ne 'WORKS') { return ,@(@{ x = 30; y = 5; t = $title }) }
  $full = [JsWin]::Capture($h)
  try {
    $cropH = [int]($full.Height * 0.18)
    $crop = New-Object Drawing.Bitmap ($full.Width * 2), ($cropH * 2)
    $g = [Drawing.Graphics]::FromImage($crop)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.DrawImage($full, (New-Object Drawing.Rectangle 0, 0, $crop.Width, $crop.Height), (New-Object Drawing.Rectangle 0, 0, $full.Width, $cropH), 'Pixel')
    $g.Dispose()
    $ms = New-Object IO.MemoryStream
    $crop.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $ms.Position = 0
    $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $dec = Await ($([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($script:engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $out = @()
    foreach ($l in $res.Lines) {
      $first = $null; foreach ($wd in $l.Words) { $first = $wd; break }
      if (-not $first) { continue }
      $r = $first.BoundingRect
      $x = [int](100.0 * [double]$r.X / [double]$crop.Width)
      $y = [int](18.0 * [double]$r.Y / [double]$crop.Height)
      if ($x -ge 20 -and $y -le 12) { $out += @{ x = $x; y = $y; t = $l.Text } }
    }
    $crop.Dispose(); $ms.Dispose()
    return ,$out
  } finally { $full.Dispose() }
}
function Send-Report($id, $lines, $err) {
  $body = @{ id = $id; lines = $lines }
  if ($err) { $body.error = $err }
  $json = $body | ConvertTo-Json -Depth 4 -Compress
  Invoke-WebRequest -Uri $base -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 15 -UseBasicParsing | Out-Null
}

Write-Log '시작 v2'
$fail = 0
while ($true) {
  try {
    $r = Invoke-WebRequest -Uri $waitUrl -Headers $headers -TimeoutSec 40 -UseBasicParsing
    $fail = 0
    if ($r.StatusCode -eq 200) {
      $msg = $r.Content | ConvertFrom-Json
      if ($msg.task -eq 'ocr') {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        try { $lines = Read-WorksRoomTitle; Send-Report $msg.id $lines $null; Write-Log "방 제목 읽기 $($lines.Count)줄 $($sw.ElapsedMilliseconds)ms" }
        catch { $e = "$($_.Exception.Message)"; Write-Log "방 제목 읽기 실패: $e"; try { Send-Report $msg.id @() $e } catch {} }
        continue
      }
      $url = $msg.url
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
