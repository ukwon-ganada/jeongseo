// ============================================================================
//  형사 법정기한 간단 계산 (잠정) — 석원 결정 2026-11-13 "지금 간단 계산으로 먼저"
//
//  규칙서 엔진이 완성되면 이 파일 대신 엔진 결과를 쓴다. 그때까지 타임라인·기한 탭에
//  "잠정" 표시로만 보여 준다(알림은 보내지 않음).
//
//    선고           → 7일 안에 항소장(1심) / 상고장(항소심)      (형소법 358·374조)
//    소송기록접수통지 → 도달 후 20일 안에 항소이유서 / 상고이유서 (형소법 361조의3·379조)
//                     피고인·우리 법인 중 먼저 받은 날 기준 (규칙서 E2, 석원 확정)
//    날 세기: 첫날 빼고(형소법 66조①), 마지막 날이 토·일·공휴일이면 다음 평일(66조③)
//
//  로웨어 진행내역에는 하급심 기록이 같이 들어 있어서, 사건번호(고/노/도)와
//  "선고 → 기록접수통지" 순서를 보고 몇 심인지 거꾸로 맞춘다.
// ============================================================================

// 확실한 공휴일만 넣는다(모르는 날을 넣으면 기한이 늦게 잡혀 위험. 빼면 일찍 잡힐 뿐).
const HOLIDAYS = new Set([
  // 2025
  "2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30", "2025-03-03", "2025-05-05", "2025-05-06",
  "2025-06-03", "2025-06-06", "2025-08-15", "2025-10-03", "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09", "2025-12-25",
  // 2026
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-05", "2026-05-25", "2026-06-03",
  "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-28", "2026-10-05", "2026-10-09", "2026-12-25",
  // 2027
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-05", "2027-05-13", "2027-08-16", "2027-09-14",
  "2027-09-15", "2027-09-16", "2027-10-04", "2027-10-11", "2027-12-27",
]);

const nz = (v: unknown) => (v == null ? "" : String(v).trim());
const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}/.test(nz(s));
const OUR_FIRM = /법무법인\s*정서/;
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const md = (d: string) => Number(d.slice(5, 7)) + "." + d.slice(8, 10);

export function isOff(d: string): boolean {
  const w = new Date(d + "T00:00:00Z").getUTCDay();
  return w === 0 || w === 6 || HOLIDAYS.has(d);
}

// 기산일 d(사유 발생일)부터 n일. 첫날 빼고 세고, 마지막 날이 쉬는 날이면 다음 평일로.
export function dueDate(d: string, n: number): { due: string; moved: boolean } {
  let due = addDays(d, n), moved = false;
  while (isOff(due)) { due = addDays(due, 1); moved = true; }
  return { due, moved };
}

// 사건번호로 지금 몇 심인지: 고(1심) / 노(항소심) / 도(상고심). 그 밖(약식·신청 등)은 계산 안 함.
export function courtStage(code: string): number {
  const m = nz(code).match(/\d{2,4}\s*([가-힣]+)/);
  const k = m ? m[1] : "";
  if (/^노/.test(k)) return 2;
  if (/^도/.test(k)) return 3;
  if (/^고(단|합|정)?$/.test(k)) return 1;
  return 0;
}

export function isVerdict(e: any): boolean {
  const c = nz(e.lp_contents), r = nz(e.lp_remark);
  if (e.lp_set === "접수") return /종국\s*:\s*선고/.test(c);
  if (e.lp_set !== "기일" || !/선고/.test(c)) return false;
  return /선고/.test(r) && !/연기|변경|취소|추정/.test(r);
}

// 우리가 맡은 피고인 번호들. "피고인3 변호인 법무법인 정서" → {"3"}. "피고인들의 변호인"이면 전원(null).
export function ourDefendants(evs: any[]): Set<string> | null {
  const out = new Set<string>();
  for (const e of evs || []) {
    const c = nz(e.lp_contents);
    if (!OUR_FIRM.test(c)) continue;
    const m = c.match(/^피고인(\d*)\s*(들의)?\s*변호인/);
    if (!m) continue;
    if (m[2] || !m[1]) return null;
    out.add(m[1]);
  }
  return out.size ? out : null;
}

// 소송기록접수통지 중 우리 의뢰인(피고인) 본인 또는 우리 법인이 받은 것 (검사·다른 변호인·다른 피고인 제외)
export function isNotice(e: any, ours: Set<string> | null = null): boolean {
  const c = nz(e.lp_contents);
  if (e.lp_set !== "송달" || !/소송기록접수통지/.test(c)) return false;
  if (OUR_FIRM.test(c)) return true;
  const m = c.match(/^피고인(\d*)\s+(\S+)/);
  if (!m || /변호인/.test(m[2])) return false; // 받는 사람이 피고인 본인일 때만 (문서 이름의 '국선변호인'은 상관없음)
  return !ours || ours.has(m[1] || "1");
}

export type Deadline = { t: string; d: string; why: string; st: "open" | "done" | "expected"; kind: string; doneOn?: string };

export function computeDeadlines(code: string, evs: any[], today: string): Deadline[] {
  const top = courtStage(code);
  if (!top) return [];
  const list = (evs || []).filter((e) => isDate(e.lp_appoint_date))
    .map((e) => ({ ...e, _d: nz(e.lp_appoint_date).slice(0, 10) }))
    .sort((a, b) => a._d.localeCompare(b._d) || (a.lp_num || 0) - (b.lp_num || 0));
  const filings = list.filter((e) => e.lp_set === "서면");
  const ours = ourDefendants(list);

  // 1) 선고(날짜별 하나)와 통지 묶음(선고 사이마다 한 묶음)을 시간 순서로
  type Item = { kind: "v"; d: string; future: boolean } | { kind: "n"; first: string; got: { d: string; who: string }[] };
  const items: Item[] = [];
  const seenV = new Set<string>();
  for (const e of list) {
    const futureVerdict = e.lp_set === "기일" && /선고/.test(nz(e.lp_contents)) && !nz(e.lp_remark) && e._d >= today;
    if (isVerdict(e) || futureVerdict) {
      if (seenV.has(e._d)) continue;
      seenV.add(e._d);
      items.push({ kind: "v", d: e._d, future: !isVerdict(e) });
    } else if (isNotice(e, ours)) {
      const last = items[items.length - 1];
      const round = last && last.kind === "n" ? last : null;
      const r = round ?? { kind: "n" as const, first: e._d, got: [] as { d: string; who: string }[] };
      if (!round) items.push(r);
      const dd = isDate(e.delivered_date) ? nz(e.delivered_date).slice(0, 10) : "";
      if (dd) r.got.push({ d: dd, who: OUR_FIRM.test(nz(e.lp_contents)) ? "우리" : "피고인" });
    }
  }

  // 2) 몇 심인지 거꾸로: 마지막 통지 묶음 = 지금 법원, 그 앞 묶음은 한 심씩 아래
  const rounds = items.filter((x) => x.kind === "n");
  const stageOfRound = new Map<Item, number>();
  rounds.forEach((r, i) => stageOfRound.set(r, Math.max(2, top - (rounds.length - 1 - i))));

  const out: Deadline[] = [];
  items.forEach((it, i) => {
    if (it.kind === "v") {
      const next = items.slice(i + 1).find((x) => x.kind === "n");
      const hadRound = items.slice(0, i).some((x) => x.kind === "n");
      const stage = next ? stageOfRound.get(next)! - 1 : hadRound || top === 1 ? top : top - 1;
      if (stage >= 3) return; // 대법원 선고는 상소 없음
      const what = stage === 1 ? "항소" : "상고";
      const { due, moved } = dueDate(it.d, 7);
      const done = filings.find((f) => f._d >= it.d && f._d <= addDays(due, 3) && new RegExp(what + "장").test(nz(f.lp_contents)));
      out.push({
        t: what + " 마감", d: due, kind: what, doneOn: done?._d,
        st: done ? "done" : it.future ? "expected" : "open",
        why: (it.future ? "선고 예정 " : "선고 ") + md(it.d) + " + 7일" + (moved ? " (쉬는 날이라 다음 평일)" : ""),
      });
    } else {
      const stage = stageOfRound.get(it)!;
      const what = stage === 2 ? "항소이유서" : "상고이유서";
      if (!it.got.length) {
        out.push({ t: what + " 마감", d: "", kind: what, st: "expected", why: "기록접수통지 발송 " + md(it.first) + " · 아직 도달 전" });
        return;
      }
      const first = it.got.slice().sort((a, b) => a.d.localeCompare(b.d))[0];
      const { due, moved } = dueDate(first.d, 20);
      const nextV = items.slice(i + 1).find((x) => x.kind === "v");
      const done = filings.find((f) => f._d >= it.first && (!nextV || f._d <= nextV.d) && /이유서/.test(nz(f.lp_contents)) && !/연장|기간/.test(nz(f.lp_contents)));
      out.push({
        t: what + " 마감", d: due, kind: what, doneOn: done?._d, st: done ? "done" : "open",
        why: "기록접수통지 도달 " + md(first.d) + "(" + first.who + ") + 20일" + (moved ? " (쉬는 날이라 다음 평일)" : ""),
      });
    }
  });
  return out;
}

// 타임라인 줄로: 이미 낸 기한은 '제출' 줄이 따로 있으니 빼고, 남은 것만 기한 줄로.
export function deadlineEvents(dls: Deadline[], today: string) {
  return dls.filter((x) => x.d && x.st !== "done").map((x) => ({
    d: x.d, k: x.d >= today ? "due" : "done", g: "limit", lim: x.d >= today ? 1 : 0,
    t: x.t + (x.st === "expected" ? " (선고되면)" : "") + " · " + x.why, f: null,
  }));
}
