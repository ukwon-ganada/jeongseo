// ============================================================================
//  빠진 기일 알림에 대법원 원문 더하기 (석원 2026-11-25 "로웨어 또는 대법원 사건 원본기록에는 기일이 있는데 웍스에 없는 것")
//   scourt_progress_rows(석원 PC 크롬 확장이 모은 원문 진행내용)의 앞으로 기일 줄과 로웨어 기일을 맞춰 본다.
//   - 짝이 맞고 원문에 결과(기일변경·추정 등)가 붙었으면: 바뀐 기일 → 로웨어 줄을 알림에서 뺀다
//   - 원문에만 있고 결과가 없는 기일: 로웨어가 빠뜨린 기일 → 알림 후보로 더한다(lp_num은 음수 가짜 번호)
// ============================================================================
export type LwH = { lp_num: number; l_num: number; date: string; time: string; contents: string };
export type ScH = { l_num: number; date: string; content: string; result: string | null };

const norm = (s: string) => String(s || "").replace(/\s+/g, "");
export const isScHearing = (c: string) => /기일\(|조정사무수행일\(/.test(String(c || "")) && !/(발송|송달|제출|신청)$/.test(String(c || "").trim());
const kind = (c: string) => norm(String(c || "").replace(/\(.*$/, ""));
const timeOf = (c: string) => { const m = String(c || "").match(/(\d{1,2}):(\d{2})\)/); return m ? m[1].padStart(2, "0") + ":" + m[2] : ""; };
// 원문에만 있는 기일의 가짜 번호: -(사건번호×10^12 + YYYYMMDD×10^4 + HHMM). hearing_notice 의 "한 번만" 기록용
export const fakeLp = (l_num: number, date: string, time: string) => -(l_num * 1e12 + Number(date.replace(/-/g, "")) * 1e4 + (time ? Number(time.replace(":", "")) : 0));

export function scourtAdjust(lw: LwH[], sc: ScH[]): { drop: Set<number>; add: LwH[] } {
  const drop = new Set<number>();
  const add: LwH[] = [];
  const used = new Set<number>();
  for (const s of sc) {
    if (!isScHearing(s.content)) continue;
    const t = timeOf(s.content);
    const m = lw.find((e) => !used.has(e.lp_num) && e.l_num === s.l_num && e.date === s.date && kind(e.contents) === kind(s.content) && (!t || !e.time || e.time === t))
      ?? lw.find((e) => !used.has(e.lp_num) && e.l_num === s.l_num && e.date === s.date && kind(e.contents) === kind(s.content));
    const res = String(s.result || "").trim();
    if (m) { used.add(m.lp_num); if (res) drop.add(m.lp_num); continue; }
    if (res) continue;
    add.push({ lp_num: fakeLp(s.l_num, s.date, t), l_num: s.l_num, date: s.date, time: t, contents: String(s.content).replace(/\s*\[[^\]]*\]/g, "").trim() });
  }
  return { drop, add };
}
