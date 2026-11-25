// ============================================================================
//  기일 결과 보충 (2026-11-25 석원, 2026푸104128)
//   로웨어 진행내역 기일 줄의 결과(lp_remark)가 비어 있어도, 로웨어가 받아 온 대법원 기일 정보
//   (lw_case_detail.scourt_appoint_log)에는 "기일변경" 같은 결과가 있을 수 있다.
//   가장 최근에 받아 온 기일 정보로 빈 결과만 채운다(이미 있는 결과는 그대로).
// ============================================================================
const nz = (v: unknown) => (v == null ? "" : String(v));
const norm = (s: string) => s.replace(/\s+/g, "");

// 마지막으로 받아 온 기일 정보에서 날짜별 {제목, 결과}
export function logResults(log: string): { d: string; t: string; r: string }[] {
  const blocks = nz(log).split(/^\[\d{4}-\d{2}-\d{2} [\d:]+\]\s*$/m).map((b) => b.trim()).filter((b) => /\d{4}\.\d{2}\.\d{2}/.test(b));
  const last = blocks.pop() || "";
  const out: { d: string; t: string; r: string }[] = [];
  for (const line of last.split("\n")) {
    const m = line.trim().match(/^(\d{4})\.(\d{2})\.(\d{2})(?:\t+| {2,})(.+)$/);
    if (!m) continue;
    const parts = m[4].split(/\t+| {2,}/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length || parts[0].startsWith("-")) continue; // 참석자 줄
    out.push({ d: `${m[1]}-${m[2]}-${m[3]}`, t: parts[0], r: parts.slice(1).join(" ") });
  }
  return out;
}

// 기일 줄의 빈 결과를 채운 새 목록(원본은 건드리지 않음)
export function fillHearingResults(evs: any[], log: string): any[] {
  const res = logResults(log).filter((x) => x.r);
  if (!res.length) return evs;
  return evs.map((e) => {
    if (e.lp_set !== "기일" || nz(e.lp_remark).trim()) return e;
    const d = nz(e.lp_appoint_date).slice(0, 10);
    const same = res.filter((x) => x.d === d);
    const hit = same.find((x) => norm(x.t) === norm(nz(e.lp_contents)))
      || (same.length === 1 && evs.filter((y) => y.lp_set === "기일" && nz(y.lp_appoint_date).slice(0, 10) === d).length === 1 ? same[0] : null);
    return hit ? { ...e, lp_remark: hit.r } : e;
  });
}
