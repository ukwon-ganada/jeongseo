# 정서 사건 도우미 — "≡ 메뉴를 누르는 순간" 방 제목을 읽을 수 있는지 시험
# 20초 동안 웍스 창을 지켜보다가 ≡ 메뉴(작은 창)가 뜨면 그 순간 웍스 창 위쪽을 화면에서 찍어 글자를 읽어 보여 준다.
# 같은 순간 지금 방식(PrintWindow)으로 찍은 그림이 비었는지도 함께 보여 준다. 결과는 이 화면에만 나오고 아무 데도 보내지 않는다.
# 실행 뒤 20초 안에 웍스 사건방에서 오른쪽 아래 ≡ 를 한 번 눌러 주세요(메뉴 항목은 누르지 않아도 됩니다).
$ErrorActionPreference = 'Stop'
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
  // 화면에 보이는 그대로 찍기 (PrintWindow가 빈 그림을 줄 때 대신)
  public static Bitmap CaptureScreen(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    var b = new Bitmap(Math.Max(1, r.R - r.L), Math.Max(1, r.B - r.T));
    using (var g = Graphics.FromImage(b)) { g.CopyFromScreen(r.L, r.T, 0, 0, b.Size); }
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

function Await($op, [Type]$t) {
  $task = $script:asTask.MakeGenericMethod($t).Invoke($null, @($op))
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while (-not $task.IsCompleted) { Start-Sleep -Milliseconds 20; if ($sw.ElapsedMilliseconds -gt 8000) { throw '글자 인식 응답 없음' } }
  $task.Result
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

function Get-Wins {
  $pids = @{}
  foreach ($w in [JsWin]::TopWindows()) { if ([JsWin]::Title($w) -eq 'WORKS') { $pids[[int][JsWin]::Pid($w)] = 1 } }
  if ($pids.Count -eq 0) { Get-Process | Where-Object { $_.ProcessName -match 'works' } | ForEach-Object { $pids[$_.Id] = 1 } }
  $out = @()
  foreach ($w in [JsWin]::TopWindows()) {
    if (-not $pids.ContainsKey([int][JsWin]::Pid($w))) { continue }
    if (-not [JsWin]::IsWindowVisible($w)) { continue }
    $rc = New-Object JsWin+RECT; [void][JsWin]::GetWindowRect($w, [ref]$rc)
    $out += [pscustomobject]@{ h = $w; t = [JsWin]::Title($w); w = $rc.R - $rc.L; ht = $rc.B - $rc.T }
  }
  return ,$out
}
$main = (Get-Wins | Where-Object { $_.t -eq 'WORKS' } | Select-Object -First 1)
if (-not $main) { Write-Host '보이는 WORKS 창을 찾지 못했습니다.'; exit 1 }
Write-Host ("WORKS 창 {0}x{1}, 화면 배율 {2}%" -f $main.w, $main.ht, [int](100 * [Drawing.Graphics]::FromHwnd([IntPtr]::Zero).DpiX / 96))
$before = @{}; foreach ($x in (Get-Wins)) { $before[[string]$x.h] = 1 }
Write-Host '지금 웍스 사건방에서 오른쪽 아래 ≡ 를 눌러 주세요 (20초 기다립니다)...'
$sw = [Diagnostics.Stopwatch]::StartNew(); $hit = $null
while ($sw.ElapsedMilliseconds -lt 20000 -and -not $hit) {
  Start-Sleep -Milliseconds 150
  foreach ($x in (Get-Wins)) { if (-not $before.ContainsKey([string]$x.h)) { $hit = $x; break } }
}
if (-not $hit) { Write-Host '20초 동안 새 창이 뜨지 않았습니다(≡ 메뉴가 별도 창이 아님).'; }
else { Write-Host ("새 창 감지: 제목 '{0}' {1}x{2}, {3}ms 만에" -f $hit.t, $hit.w, $hit.ht, $sw.ElapsedMilliseconds) }
$t0 = [Diagnostics.Stopwatch]::StartNew()
$scr = [JsWin]::CaptureScreen($main.h); $lines = Read-ByOcr $scr; $scr.Dispose()
Write-Host ("[화면에서 찍기] {0}줄, {1}ms" -f $lines.Count, $t0.ElapsedMilliseconds)
$lines | ForEach-Object { Write-Host ("  x{0} y{1} {2}" -f $_.x, $_.y, $_.t) }
$t0.Restart()
$pw = [JsWin]::Capture($main.h); $blank = [JsWin]::Blank($pw, [int]($pw.Height * 0.18)); $l2 = @(); if (-not $blank) { $l2 = Read-ByOcr $pw }; $pw.Dispose()
Write-Host ("[지금 방식(PrintWindow)] 빈 그림={0}, {1}줄, {2}ms" -f $blank, $l2.Count, $t0.ElapsedMilliseconds)
$l2 | ForEach-Object { Write-Host ("  x{0} y{1} {2}" -f $_.x, $_.y, $_.t) }
