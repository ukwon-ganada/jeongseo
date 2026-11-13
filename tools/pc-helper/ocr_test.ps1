# 정서 사건 도우미 — 화면 글자 읽기(OCR) 시험
# 웍스 메인 창 위쪽(방 제목 줄)을 찍어서 윈도우 내장 글자 인식으로 읽는다. 결과는 이 PC 화면에만 보이고 아무 데도 보내지 않는다.
# 실행: powershell -ExecutionPolicy Bypass -File ocr_test.ps1
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
  public static Bitmap Capture(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    var b = new Bitmap(Math.Max(1, r.R - r.L), Math.Max(1, r.B - r.T));
    using (var g = Graphics.FromImage(b)) { var dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
    return b;
  }
}
"@
[void][JsWin]::SetProcessDPIAware()

# 윈도우 내장 글자 인식(WinRT) 불러오기
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(); $task.Result }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ko'))
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { Write-Host '글자 인식 기능을 쓸 수 없습니다 (한국어 OCR 미설치).' -ForegroundColor Red; exit 1 }
Write-Host ('글자 인식 언어: ' + $engine.RecognizerLanguage.DisplayName)

$p = Get-Process | Where-Object { $_.MainWindowTitle -eq 'WORKS' } | Select-Object -First 1
if (-not $p) { Write-Host '웍스 메인 창을 찾지 못했습니다.' -ForegroundColor Red; exit 1 }
$h = $p.MainWindowHandle
if ([JsWin]::IsIconic($h)) { Write-Host '웍스 창이 최소화돼 있습니다. 창을 열어 두고 다시 실행하세요.' -ForegroundColor Red; exit 1 }

$sw = [Diagnostics.Stopwatch]::StartNew()
$full = [JsWin]::Capture($h)
# 위쪽 18%만 (방 제목 줄), 글자 인식이 잘 되게 2배 확대
$cropH = [int]($full.Height * 0.18)
$crop = New-Object Drawing.Bitmap ($full.Width * 2), ($cropH * 2)
$g = [Drawing.Graphics]::FromImage($crop)
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($full, (New-Object Drawing.Rectangle 0, 0, $crop.Width, $crop.Height), (New-Object Drawing.Rectangle 0, 0, $full.Width, $cropH), 'Pixel')
$g.Dispose()
$ms = New-Object IO.MemoryStream
$crop.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $ms.Position = 0
$stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
$dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
$sw.Stop()

Write-Host ('창 크기: ' + $full.Width + 'x' + $full.Height + ', 걸린 시간: ' + $sw.ElapsedMilliseconds + 'ms')
Write-Host '--- 읽은 줄 ---'
foreach ($l in $res.Lines) { Write-Host $l.Text }
