// ============================================================================
//  기일별 우리 출석 여부 (2026-11-26 석원 결정, 김우석 2026고단1492)
//   공범이 많은 사건은 기일이 여러 개 잡히고, 우리 피고인은 그중 일부(예: 선고기일)에만 나간다.
//   전자기록에는 나오지 않아 직원이 [수정]에서 정하거나, 도우미가 방 글("4월 15일 선고만 갑니다")을 읽어 미리 채운다.
//   - 표시가 없는 기일은 출석(지금처럼 가장 빠른 기일이 우리 기일)
//   - 불출석 기일: 화면에서 흐리게(ab), [문자]·[일정]·빠진 기일 알림에서 빠짐
//   - 출석으로 표시했는데 로웨어에 아직 없는 기일: 우리 기일 줄로 더함(add)
// ============================================================================
const nz = (v: unknown) => (v == null ? "" : String(v));

export type AttendRow = { l_num: number; hdate: string; attend: boolean; htime?: string | null; kind?: string | null; place?: string | null; source?: string | null };

// 로웨어 기일 내용처럼: "선고기일(412호법정 14:00)"
export function attendTitle(r: AttendRow): string {
  const inner = [nz(r.place), nz(r.htime)].filter(Boolean).join(" ");
  return (nz(r.kind) || "기일") + (inner ? "(" + inner + ")" : "");
}

// 변경·연기·취소된 기일(화면의 isMoved와 같은 낱말)
const MOVED = /변론재개|선고연기|재판연기|기일변경|기일연기|연기|추정|취소/;
const HELD = /(변론종결|속행)\s*\(\s*추정\s*\)/;
const moved = (t: string) => MOVED.test(t) && !(HELD.test(t) && !/변론재개|선고연기|기일변경|연기\(/.test(t));

/**
 * shaped(사건 화면 자료)에 출석 표시를 입힌다.
 *  rows: 이 사건(lNum)과 '내 사건 전체'에 보이는 사건들의 출석 표시
 *  codeOf: l_num → 사건번호 ('내 사건 전체' 기일을 짝짓기)
 */
export function applyAttend(shaped: any, rows: AttendRow[], lNum: number, today: string, codeOf: Map<number, string> = new Map()) {
  if (!rows?.length) return;
  const caseNo = nz(shaped.caseNo);
  const mine = new Map<string, AttendRow>();
  const other = new Map<string, AttendRow>();
  for (const r of rows) {
    const d = nz(r.hdate).slice(0, 10);
    if (Number(r.l_num) === Number(lNum)) mine.set(d, r);
    else { const c = codeOf.get(Number(r.l_num)); if (c) other.set(c + "|" + d, r); }
  }
  const covered = new Set<string>();
  for (const h of shaped.hearings || []) {
    const r = h.c === caseNo ? mine.get(h.d) : other.get(h.c + "|" + h.d);
    if (!r) continue;
    if (h.c === caseNo && !moved(nz(h.t))) covered.add(h.d);
    if (r.attend === false) h.ab = 1;
    else if (h.c === caseNo) h.at = 1;
  }
  for (const e of shaped.events || []) {
    if (e.g !== "hearing" || (e.lc != null && Number(e.lc) !== Number(lNum))) continue;
    const r = mine.get(e.d);
    if (r && r.attend === false) e.ab = 1;
  }
  // 출석으로 표시했는데 로웨어에 아직 없는 앞으로의 기일(방 글로 먼저 안 선고기일 등)
  for (const [d, r] of mine) {
    if (!r.attend || d < today || covered.has(d)) continue;
    shaped.hearings.push({ c: caseNo, d, tm: nz(r.htime), t: nz(r.kind) || "기일", p: nz(r.place), at: 1, add: 1 });
    if (!(shaped.events || []).some((e: any) => e.g === "hearing" && e.d === d)) {
      shaped.events.push({ d, k: "due", g: "hearing", t: attendTitle(r), f: null, add: 1 });
    }
  }
}

// [수정]에서 보낸 값 다듬기
export function cleanAttendBody(b: any): { date: string; attend: boolean | null; htime: string; kind: string; place: string } | null {
  const date = nz(b?.date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const attend = b?.attend === true ? true : b?.attend === false ? false : null;
  const htime = (nz(b?.tm).match(/^\d{1,2}:\d{2}/) || [""])[0];
  return { date, attend, htime, kind: nz(b?.kind).slice(0, 30), place: nz(b?.place).slice(0, 60) };
}
