# 정서 사건 도우미 — 웍스 창 글자를 "직접" 읽을 수 있는지 시험 (UI Automation)
# 지금 도우미는 웍스 창을 찍어 글자를 알아본다(약 0.5초). 웍스 PC 앱이 창 안 글자를 윈도우에 알려 주면 찍지 않고 바로 읽을 수 있다(0.05초 안팎).
# 결과(읽은 글자·걸린 시간)는 이 PC 화면에만 보이고 아무 데도 보내지 않는다.
# 실행: 웍스에서 아무 사건방을 열어 둔 채 → powershell -ExecutionPolicy Bypass -File uia_test.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class UiaWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static List<IntPtr> Top() { var l = new List<IntPtr>(); EnumWindows((h, p) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static string Title(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
}
"@
$h = [IntPtr]::Zero
foreach ($w in [UiaWin]::Top()) { if ([UiaWin]::Title($w) -eq 'WORKS' -and [UiaWin]::IsWindowVisible($w) -and -not [UiaWin]::IsIconic($w)) { $h = $w; break } }
if ($h -eq [IntPtr]::Zero) { Write-Host '보이는 WORKS 창을 찾지 못했습니다. 웍스 창을 최소화하지 말고 다시 실행해 주세요.'; exit 1 }

$A = [System.Windows.Automation.AutomationElement]
$T = [System.Windows.Automation.TreeScope]
foreach ($round in 1..2) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $root = $A::FromHandle($h)
  $r = $root.Current.BoundingRectangle
  $all = $root.FindAll($T::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $ms = $sw.ElapsedMilliseconds
  $top = @()
  foreach ($e in $all) {
    try {
      $b = $e.Current.BoundingRectangle; $n = $e.Current.Name
      if ($n -and $b.Top -lt ($r.Top + $r.Height * 0.15) -and $b.Left -gt ($r.Left + $r.Width * 0.15)) { $top += ('{0} [{1}]' -f $n, $e.Current.ControlType.ProgrammaticName) }
    } catch {}
  }
  Write-Host ("[{0}회] 요소 {1}개, 읽는 데 {2}ms" -f $round, $all.Count, $ms)
}
Write-Host '--- 창 위쪽(방 제목 자리)에서 읽힌 글자 ---'
if ($top.Count -eq 0) { Write-Host '(없음) → 웍스가 창 안 글자를 알려 주지 않습니다. 직접 읽기는 안 됩니다.' }
else { $top | Select-Object -First 15 | ForEach-Object { Write-Host $_ } ; Write-Host '→ 위에 지금 연 방 이름이 보이면 직접 읽기가 됩니다.' }
