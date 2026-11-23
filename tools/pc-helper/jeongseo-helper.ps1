# 정서 사건 도우미 — 사건방 "이 방 사건 보기"를 누르면 이 PC 브라우저에 사건 화면을 연다.
# v2.5: ≡ 누른 순간 찍은 그림의 글자 읽기를 뒤에서 미리 해 둔다(사건 화면이 물을 때 바로 답함, 약 0.4초 단축).
#       미리 읽기가 아직 안 끝났거나 실패하면 예전처럼 그 자리에서 읽는다
# v2.4: 웍스에서 ≡ 메뉴를 누르는 순간(웍스 작은 창이 새로 뜸, 웍스가 맨 앞) 웍스 창 위쪽을 화면 그대로 찍어 둔다.
#       사건 화면이 방을 물으면 그 그림을 먼저 읽고(브라우저에 가려지기 전 모습), 안 되면 예전처럼 찍어서 읽는다.
#       (그때 화면을 다시 찍지는 않는다: 브라우저가 앞에 있어 다른 글자를 읽을 수 있음) 읽은 방법·못 읽은 이유를 함께 보낸다
#       (웍스는 창 안 글자를 윈도우에 알려 주지 않아 직접 읽기는 불가: 2026-11-13·11-20 시험)
# v2.3: 스스로 업데이트(6시간마다 GitHub의 version.txt 확인, 지문(SHA-256)이 맞을 때만 바꿔 끼움)
# v2.2: 절전·네트워크 끊김·서버 오류가 있어도 꺼지지 않고 계속 다시 연결(401이어도 5분 뒤 다시 시도)
# v2.1: 따로 띄운 대화방 창도 찾음(창 제목=방 이름), 메인 창이 숨어 있어도 찾음
# v2: 사건 화면이 "지금 어느 방?"을 물으면 웍스 창 위쪽 방 제목을 윈도우 글자 인식으로 읽어 서버에 알려 준다.
#     (방 제목 줄만 보냄: 왼쪽 방 목록·대화 내용은 보내지 않음)
# 화면 없이 뒤에서 돈다. 설정: %APPDATA%\JeongseoHelper\config.json (설치 때 만들어짐)
# 끄기: 작업 관리자 > powershell(정서 사건 도우미) 끝내기, 또는 uninstall.cmd
$ErrorActionPreference = 'Stop'
$HelperVersion = '2.5'
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
  // 위쪽 띠가 한 가지 색뿐이면 빈 그림
  public static bool Blank(Bitmap b, int h) {
    var c0 = b.GetPixel(0, 0); int n = 0;
    for (int y = 0; y < h; y += 3) for (int x = 0; x < b.Width; x += 7) { if (b.GetPixel(x, y) != c0) { n++; if (n > 20) return false; } }
    return true;
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
  $script:ocrReady = $true
}
function Await($op, [Type]$t) {
  $task = $script:asTask.MakeGenericMethod($t).Invoke($null, @($op))
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while (-not $task.IsCompleted) { Start-Sleep -Milliseconds 20; if ($sw.ElapsedMilliseconds -gt 8000) { throw '글자 인식 응답 없음' } }
  $task.Result
}
# ── ≡ 메뉴 지켜보기 (따로 준비: 여기서 문제가 나도 예전 방식은 그대로 돈다) ─────
$script:menuOn = $false
function Start-MenuWatch {
  try {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Runtime.InteropServices; using System.Collections.Generic; using System.Threading;
public static class MenuWatch {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  static Bitmap last; static DateTime lastAt; static readonly object lk = new object(); static bool started;
  public static int Seq;
  public static string LastError = "";
  static string Title(IntPtr h) { var sb = new System.Text.StringBuilder(64); GetWindowText(h, sb, 64); return sb.ToString(); }
  static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static void Start() {
    if (started) return; started = true;
    var t = new Thread(Loop); t.IsBackground = true; t.Priority = ThreadPriority.BelowNormal; t.Start();
  }
  static void Loop() {
    var seen = new HashSet<IntPtr>(); bool first = true;
    while (true) {
      try {
        Thread.Sleep(150);
        var wins = new List<IntPtr>();
        EnumWindows(delegate (IntPtr h, IntPtr l) { wins.Add(h); return true; }, IntPtr.Zero);
        var pids = new HashSet<uint>();
        foreach (var w in wins) if (Title(w) == "WORKS") pids.Add(Pid(w));
        if (pids.Count == 0) { seen.Clear(); first = true; continue; }
        var now = new HashSet<IntPtr>(); IntPtr main = IntPtr.Zero; bool fresh = false;
        foreach (var w in wins) {
          if (!IsWindowVisible(w) || !pids.Contains(Pid(w))) continue;
          now.Add(w);
          RECT r; GetWindowRect(w, out r); int ww = r.R - r.L, hh = r.B - r.T;
          if (main == IntPtr.Zero && Title(w) == "WORKS" && !IsIconic(w) && ww >= 300 && hh >= 150) main = w;
          if (!first && !seen.Contains(w) && ww < 500 && hh < 500) fresh = true;
        }
        seen = now; first = false;
        if (!fresh || main == IntPtr.Zero) continue;
        var fg = GetForegroundWindow();
        if (fg == IntPtr.Zero || !pids.Contains(Pid(fg))) continue;
        RECT m; GetWindowRect(main, out m);
        var b = new Bitmap(Math.Max(1, m.R - m.L), Math.Max(1, m.B - m.T));
        using (var g = Graphics.FromImage(b)) { g.CopyFromScreen(m.L, m.T, 0, 0, b.Size); }
        lock (lk) { if (last != null) last.Dispose(); last = b; lastAt = DateTime.UtcNow; Seq++; Monitor.PulseAll(lk); }
      } catch (Exception e) { LastError = e.Message; }
    }
  }
  // 새 그림(번호가 seen과 다름)이 올 때까지 기다린다 (뒤에서 미리 읽기용)
  public static bool WaitNew(int seen, int timeoutMs) {
    lock (lk) { if (Seq != seen) return true; Monitor.Wait(lk, timeoutMs); return Seq != seen; }
  }
  // maxAgeMs 안에 찍어 둔 그림의 복사본 (없으면 null)
  public static Bitmap Take(int maxAgeMs) {
    lock (lk) {
      if (last == null || (DateTime.UtcNow - lastAt).TotalMilliseconds > maxAgeMs) return null;
      return (Bitmap)last.Clone();
    }
  }
}
"@
    [MenuWatch]::Start()
    $script:menuOn = $true
  } catch { Write-Log "메뉴 지켜보기 준비 실패: $($_.Exception.Message)" }
  if ($script:menuOn) { Start-PreOcr }
}

# ── 뒤에서 미리 읽기: 새 그림이 찍히면 바로 글자를 읽어 $script:pre 에 둔다 (따로 도는 작업, 실패해도 본래 흐름은 그대로) ──
$script:pre = [hashtable]::Synchronized(@{ seq = -1; lines = $null; err = '' })
$preScript = @'
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ko'))
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $engine) { throw '한국어 글자 인식 없음' }
} catch { $pre.err = "준비 실패: $($_.Exception.Message)"; return }
function AwaitP($op, [Type]$t) {
  $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op))
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while (-not $task.IsCompleted) { Start-Sleep -Milliseconds 15; if ($sw.ElapsedMilliseconds -gt 8000) { throw '글자 인식 응답 없음' } }
  $task.Result
}
$seen = [MenuWatch]::Seq
while ($true) {
  try {
    if (-not [MenuWatch]::WaitNew($seen, 30000)) { continue }
    $seen = [MenuWatch]::Seq
    $full = [MenuWatch]::Take(10000)
    if (-not $full) { continue }
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
      $dec = AwaitP ($([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bmp = AwaitP ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $res = AwaitP ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
      $out = @()
      foreach ($l in $res.Lines) {
        $first = $null; foreach ($wd in $l.Words) { $first = $wd; break }
        if (-not $first) { continue }
        $rr = $first.BoundingRect
        $x = [int](100.0 * [double]$rr.X / [double]$crop.Width)
        $y = [int](18.0 * [double]$rr.Y / [double]$crop.Height)
        if ($x -ge 20 -and $y -le 12) { $out += @{ x = $x; y = $y; t = $l.Text } }
      }
      $crop.Dispose(); $ms.Dispose()
      $pre.lines = $out; $pre.seq = $seen
    } finally { $full.Dispose() }
  } catch { $pre.err = $_.Exception.Message; Start-Sleep -Milliseconds 500 }
}
'@
function Start-PreOcr {
  try {
    $rs = [runspacefactory]::CreateRunspace(); $rs.Open()
    $rs.SessionStateProxy.SetVariable('pre', $script:pre)
    $ps = [powershell]::Create(); $ps.Runspace = $rs
    [void]$ps.AddScript($preScript)
    $script:preHandle = $ps.BeginInvoke()
    $script:prePs = $ps
  } catch { Write-Log "미리 읽기 준비 실패: $($_.Exception.Message)" }
}

# 웍스 창의 방 제목 줄을 돌려준다: ≡ 누른 순간 찍어 둔 그림 → 지금 찍어서 읽기(PrintWindow)
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
    # 웍스가 잠깐 띄우는 작은 창(메뉴·알림 등, 제목 'Form')은 건너뛴다
    if ($t -match '^Form\d*$') { continue }
    $rc = New-Object JsWin+RECT; [void][JsWin]::GetWindowRect($w, [ref]$rc)
    if (($rc.R - $rc.L) -lt 300 -or ($rc.B - $rc.T) -lt 150) { continue }
    $h = $w; $title = $t; break
  }
  if ($h -eq [IntPtr]::Zero) { throw '보이는 웍스 창 없음' }
  # 대화방을 따로 띄운 창은 창 제목이 곧 방 이름 → 글자 인식 없이 바로
  if ($title -ne 'WORKS') { $script:via = 'title'; return ,@(@{ x = 30; y = 5; t = $title }) }
  if (-not $script:engine) { throw '한국어 글자 인식 없음' }
  $why = @()
  # ≡ 누른 순간 찍어 둔 그림(10초 안: 다른 방 그림을 잘못 쓰지 않게 짧게)이 있으면 그것부터
  $mb = $null
  if ($script:menuOn) {
    # 뒤에서 미리 읽어 둔 결과가 지금 그림(번호 같음)의 것이면 바로 쓴다. 읽는 중이면 0.8초까지 기다린다
    try {
      $probe = [MenuWatch]::Take(10000)
      if ($probe) {
        $probe.Dispose()
        $want = [MenuWatch]::Seq
        $sw2 = [Diagnostics.Stopwatch]::StartNew()
        while ($script:pre.seq -ne $want -and $sw2.ElapsedMilliseconds -lt 800 -and $script:prePs -and -not $script:preHandle.IsCompleted) { Start-Sleep -Milliseconds 20 }
        $pl = $script:pre.lines
        if ($script:pre.seq -eq $want -and $pl -and $pl.Count) { $script:via = 'menu-pre'; return ,@($pl) }
      }
    } catch {}
    $mb = [MenuWatch]::Take(10000)
  }
  if ($mb) {
    try { $out = Read-ByOcr $mb; if ($out.Count) { $script:via = 'menu'; return ,$out }; $why += 'menu 0줄' } finally { $mb.Dispose() }
  } else { $why += 'menu 없음' }
  $full = [JsWin]::Capture($h)
  try {
    $blank = [JsWin]::Blank($full, [int]($full.Height * 0.18))
    $out = @()
    if (-not $blank) { $out = Read-ByOcr $full }
    if ($out.Count) { $script:via = 'ocr'; return ,$out }
    $why += $(if ($blank) { 'ocr 빈그림' } else { 'ocr 0줄' })
  } finally { $full.Dispose() }
  $script:via = 'none'; $script:why = ($why -join ', ')
  return ,@()
}

# 찍은 그림의 위쪽 18%를 두 배로 키워 읽고, 방 제목 띠(왼쪽 20% 이후, 위 12% 안)의 줄만 돌려준다
function Read-ByOcr($full) {
  $cropH = [int]($full.Height * 0.18)
  $crop = New-Object Drawing.Bitmap ($full.Width * 2), ($cropH * 2)
  $g = [Drawing.Graphics]::FromImage($crop)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($full, (New-Object Drawing.Rectangle 0, 0, $crop.Width, $crop.Height), (New-Object Drawing.Rectangle 0, 0, $full.Width, $cropH), 'Pixel')
  $g.Dispose()
  $ms = New-Object IO.MemoryStream
  try {
    $crop.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $ms.Position = 0
    $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $dec = Await ($([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($script:engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $out = @()
    foreach ($l in $res.Lines) {
      $first = $null; foreach ($wd in $l.Words) { $first = $wd; break }
      if (-not $first) { continue }
      $rr = $first.BoundingRect
      $x = [int](100.0 * [double]$rr.X / [double]$crop.Width)
      $y = [int](18.0 * [double]$rr.Y / [double]$crop.Height)
      if ($x -ge 20 -and $y -le 12) { $out += @{ x = $x; y = $y; t = $l.Text } }
    }
    return ,$out
  } finally { $crop.Dispose(); $ms.Dispose() }
}
function Send-Report($id, $lines, $err) {
  $body = @{ id = $id; lines = $lines; via = $script:via; ver = $HelperVersion }
  if ($err) { $body.error = $err }
  if ($script:why) { $body.why = $script:why }
  $json = $body | ConvertTo-Json -Depth 4 -Compress
  Invoke-WebRequest -Uri $base -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 15 -UseBasicParsing | Out-Null
}

# ── 스스로 업데이트 ─────────────────────────────────────────────
# version.txt 한 줄: "버전 SHA256" — 새 버전이고 받은 파일 지문이 같을 때만 바꾸고 새 도우미로 다시 켠다
$updBase = 'https://raw.githubusercontent.com/ukwon-ganada/jeongseo/main/tools/pc-helper/'
$script:nextUpdateCheck = (Get-Date).AddMinutes(1)
function Invoke-SelfUpdate {
  $script:nextUpdateCheck = (Get-Date).AddHours(6)
  try {
    $v = (Invoke-WebRequest -Uri ($updBase + 'version.txt?t=' + [DateTime]::UtcNow.Ticks) -TimeoutSec 20 -UseBasicParsing).Content
    if ($v -is [byte[]]) { $v = [Text.Encoding]::UTF8.GetString($v) }
    $parts = $v.Trim() -split '\s+'
    if ($parts.Count -lt 2) { return }
    if ([version]$parts[0] -le [version]$HelperVersion) { return }
    $tmp = Join-Path $dir 'jeongseo-helper.new.ps1'
    Invoke-WebRequest -Uri ($updBase + 'jeongseo-helper.ps1?t=' + [DateTime]::UtcNow.Ticks) -OutFile $tmp -TimeoutSec 30 -UseBasicParsing
    $h = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
    if ($h -ne $parts[1].ToLower()) { Write-Log "업데이트 취소: 지문 다름 ($($parts[0]))"; Remove-Item $tmp -Force -ErrorAction SilentlyContinue; return }
    Move-Item $tmp (Join-Path $dir 'jeongseo-helper.ps1') -Force
    Write-Log "업데이트 $HelperVersion -> $($parts[0]), 다시 시작"
    $mutex.ReleaseMutex(); $mutex.Dispose()
    $vbs = Join-Path $dir 'start-hidden.vbs'
    if (Test-Path $vbs) { Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"') }
    else { Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dir 'jeongseo-helper.ps1') + '"') }
    exit
  } catch { Write-Log "업데이트 확인 실패: $($_.Exception.Message)" }
}

Write-Log "시작 v$HelperVersion"
# 시작할 때 글자 인식·메뉴 지켜보기를 준비해 둔다 (실패해도 도우미는 계속 돈다)
try { Initialize-Ocr } catch { Write-Log "글자 인식 준비 실패: $($_.Exception.Message)" }
if ($script:ocrReady) { Start-MenuWatch }
$fail = 0
while ($true) {
  if ((Get-Date) -ge $script:nextUpdateCheck) { Invoke-SelfUpdate }
  try {
    $r = Invoke-WebRequest -Uri $waitUrl -Headers $headers -TimeoutSec 40 -UseBasicParsing
    $fail = 0
    if ($r.StatusCode -eq 200) {
      $msg = $r.Content | ConvertFrom-Json
      if ($msg.task -eq 'ocr') {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $script:via = $null; $script:why = $null
        try { $lines = Read-WorksRoomTitle; Send-Report $msg.id $lines $null; Write-Log "방 제목 읽기($($script:via)) $($lines.Count)줄 $($sw.ElapsedMilliseconds)ms $($script:why)" }
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
    # 절대 스스로 끝내지 않는다: 절전에서 깨어날 때 등 일시 오류로 401이 와도 기다렸다 다시 시도
    if ($code -eq 401) {
      Write-Log '토큰 확인 실패(401) - 5분 뒤 다시 시도'
      Start-Sleep -Seconds 300
      try { $cfg = Get-Content (Join-Path $dir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json; $headers = @{ Authorization = "Bearer $($cfg.token)"; apikey = $cfg.anon } } catch {}
      continue
    }
    $fail++
    Write-Log "연결 실패($fail): $($_.Exception.Message)"
    Start-Sleep -Seconds ([Math]::Min(60, 3 * $fail))
  }
}
