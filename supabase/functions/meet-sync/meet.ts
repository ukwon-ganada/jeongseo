// ============================================================================
//  접견 일정 → 사건 타임라인 (meet-sync 가 씀)
//
//  웍스 캘린더(변호사 각자 일정)에 "접견_이름,이름(장소)" 모양으로 들어간 일정을 읽어
//  진행 사건의 의뢰인 이름과 맞춰 meet_event 표에 남긴다. (석원 2026-11-13: 캘린더가 가장 정확)
//    · 제목 원문은 저장하지 않는다. 사건·날짜·시각·변호사·장소만.
//    · "취소"가 들어간 일정은 빼고, 전에 남긴 줄이 있으면 지운다.
//    · 이름 하나가 사건 하나에만 맞을 때만 붙인다(같은 이름이 여럿이면 일정 주인이 담당인 사건만, 그래도 여럿이면 안 붙임).
// ============================================================================

export type Parsed = { names: string[]; place: string; canceled: boolean };

// "접견_김도현, 박찬욱,박병진(인천)" → 이름 3개, 장소 인천
export function parseMeet(summary: string): Parsed | null {
  const s = String(summary || "").trim();
  if (!/접견/.test(s)) return null;
  const canceled = /취소/.test(s);
  let rest = s.slice(s.indexOf("접견") + 2).replace(/^[_\s:·-]+/, "");
  rest = rest.replace(/^(\([^)]*\)\s*)+/, ""); // 앞에 붙은 (이송취소) 같은 표시
  let place = "";
  const m = rest.match(/\(([^()]*)\)\s*$/);
  if (m) { place = m[1].trim(); rest = rest.slice(0, m.index).trim(); }
  const names = rest.split(/[,.，、\s]+/)
    .map((n) => n.replace(/^국선/, "").replace(/\([^)]*\)/g, "").trim())
    .filter((n) => /^[가-힣]{2,4}$/.test(n));
  return { names: [...new Set(names)], place, canceled };
}

// 로웨어 의뢰인 칸 "홍길동, 김철수 (관계)" / "홍길동 外9" → 이름들
export function clientNames(client: string): string[] {
  const s = String(client || "").replace(/\([^()]*(\([^()]*\))?[^()]*\)/g, " ").replace(/外\s*\d+|외\s*\d+\s*명?/g, " ");
  return [...new Set(s.split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^[가-힣]{2,4}$/.test(x)))];
}

export type CaseRow = { l_num: number; client: string; lawyer: string };
export function matchCase(name: string, owner: string, cases: CaseRow[], index?: Map<string, CaseRow[]>): number | null {
  const hits = index ? (index.get(name) || []) : cases.filter((c) => clientNames(c.client).includes(name));
  if (hits.length === 1) return hits[0].l_num;
  const mine = hits.filter((c) => owner && c.lawyer.includes(owner));
  return mine.length === 1 ? mine[0].l_num : null;
}
export function buildIndex(cases: CaseRow[]): Map<string, CaseRow[]> {
  const ix = new Map<string, CaseRow[]>();
  for (const c of cases) for (const n of clientNames(c.client)) { const a = ix.get(n) || []; a.push(c); ix.set(n, a); }
  return ix;
}

// 웍스 일정 시작 시각 → 한국 날짜·시각
export function kstStart(start: any): { date: string; time: string } | null {
  if (start?.dateTime) {
    const raw = String(start.dateTime);
    // 시간대 표시가 없으면 timeZone(보통 Asia/Seoul) 기준의 현지 시각으로 본다
    if (!/[zZ]|[+-]\d\d:?\d\d$/.test(raw)) return { date: raw.slice(0, 10), time: raw.slice(11, 16) };
    const k = new Date(Date.parse(raw) + 9 * 3600e3).toISOString();
    return { date: k.slice(0, 10), time: k.slice(11, 16) };
  }
  if (start?.date) return { date: String(start.date).slice(0, 10), time: "" };
  return null;
}
