// ============================================================================
//  증인신문 기일 구분 (2026-11-23 석원)
//   확정: 대법원 기일 정보(로웨어 사건 상세 scourt_appoint_log)의 그 기일 참석자에 "증인 ○○○"이 있으면 백퍼센트 증인신문 기일
//   추정: 확정 근거가 없을 때만, 증인소환장 송달 뒤 처음 열린 공판기일(변경·연기된 기일은 건너뜀, 75일 안)
//   표시는 제목(e.t)을 바꾸지 않고 e.wit = "확정" | "추정" 칸으로 (서면 파일 스레드의 파일 기억 열쇠가 제목 앞부분이라서)
// ============================================================================
const nz = (v: unknown) => (v == null ? "" : String(v));

export function witnessDates(log: string): Set<string> {
  const out = new Set<string>();
  for (const m of nz(log).matchAll(/(\d{4})\.(\d{2})\.(\d{2})\s+-\s*-\s*증인\s/g)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  return out;
}

const NOT_HELD = /변경|연기|재개|취소|추정/;
const HELD = /(변론종결|속행)\s*\(\s*추정\s*\)/;
const notHeld = (t: string) => NOT_HELD.test(t) && !HELD.test(t);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

// 기일 줄 목록(lp_set 기일)과 송달 줄로, 날짜별 증인신문 여부
export function witnessMap(evs: any[], log: string): Map<string, "확정" | "추정"> {
  const res = new Map<string, "확정" | "추정">();
  const trials = evs.filter((e) => e.lp_set === "기일" && /공판/.test(nz(e.lp_contents)))
    .map((e) => ({ d: nz(e.lp_appoint_date).slice(0, 10), t: nz(e.lp_contents) + " " + nz(e.lp_remark) }))
    .sort((a, b) => a.d.localeCompare(b.d));
  const sure = witnessDates(log);
  for (const h of trials) if (sure.has(h.d)) res.set(h.d, "확정");
  const summons = evs.filter((e) => e.lp_set === "송달" && /증인\s*소환장/.test(nz(e.lp_contents))).map((e) => nz(e.lp_appoint_date).slice(0, 10));
  for (const s of summons) {
    const h = trials.find((x) => x.d > s && x.d <= addDays(s, 75) && !notHeld(x.t));
    if (h && !res.has(h.d)) res.set(h.d, "추정");
  }
  return res;
}

export function applyWitness(shaped: any, evs: any[], log: string) {
  const m = witnessMap(evs, log);
  if (!m.size) return;
  // shapeCase 바로 뒤(이 사건 줄만 있을 때) 부른다
  for (const e of shaped.events || []) if (e.g === "hearing") {
    const w = m.get(nz(e.d));
    if (w && /공판|기일/.test(nz(e.t)) && !/선고/.test(nz(e.t))) e.wit = w;
  }
  for (const h of shaped.hearings || []) {
    if (h.c !== shaped.caseNo) continue;
    const w = m.get(nz(h.d));
    if (w && /공판/.test(nz(h.t))) h.wit = w;
  }
}
