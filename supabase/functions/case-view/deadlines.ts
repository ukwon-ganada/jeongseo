// ============================================================================
//  형사 법정기한 간단 계산 (잠정) — 석원 결정 2026-11-13 "지금 간단 계산으로 먼저"
//
//  규칙서 엔진이 완성되면 이 파일 대신 엔진 결과를 쓴다. 그때까지 타임라인·기한 탭에
//  "잠정" 표시로만 보여 준다(알림은 보내지 않음).
//
//    선고           → 7일 안에 항소장(1심) / 상고장(항소심)      (형소법 358·374조)
//    소송기록접수통지 → 도달 후 20일 안에 항소이유서 / 상고이유서 (형소법 361조의3·379조)
//                     피고인·우리 법인 중 먼저 받은 날 기준 (규칙서 E2, 석원 확정)
//    공소장 부본   → 도달 후 7일 안에 공소사실 의견서 (형소법 266조의2), 합의부면 국민참여재판 의사확인서도
//                     (국민참여재판법 8조②, 안 내면 원하지 않는 것으로 봄). 1심 사건만, 첫 도달 기준
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
// 우리 법인 수신 판별. 송달 기록에는 "피고인1 변호인 양선화"처럼 소속 변호사 개인 이름으로 오는 경우가 많다.
// 퇴직자(우숭민)도 재직 중 받은 송달은 우리 수신이 맞다. 법원 기록 오타(우승민, 김흥일, 깅홍일)도 그대로 넣는다.
// (사무실 PC extract_deadlines.py 명단을 옮김 + 서고은 팀 강현구·박종덕, 2026-11-20)
const OUR_NAMES = ["서고은", "정필성", "김홍일", "김흥일", "깅홍일", "양선화", "손영우", "이예나", "우숭민", "우승민", "강현구", "박종덕"];
const OUR_FIRM_ONLY = /법무법인\s*정서/;
const OUR_FIRM = { test: (c: string) => OUR_FIRM_ONLY.test(c) || (/변호인|소송대리인/.test(c) && OUR_NAMES.some((n) => c.includes(n))) };
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
  return toUs(c, ours); // 받는 사람이 피고인 본인일 때만 (문서 이름의 '국선변호인'은 상관없음)
}

// 송달 줄이 우리 의뢰인(피고인) 본인 또는 우리 법인에게 간 것인지 (검사·다른 변호인·다른 피고인 제외)
function toUs(c: string, ours: Set<string> | null): boolean {
  if (OUR_FIRM.test(c)) return true;
  const m = c.match(/^피고인(\d*)\s+(\S+)/);
  if (!m || /변호인/.test(m[2])) return false;
  return !ours || ours.has(m[1] || "1");
}

// 공소장 부본 송달(공소장 변경·병합 사건 공소장은 뺀다)
export function isIndictCopy(e: any, ours: Set<string> | null = null): boolean {
  const c = nz(e.lp_contents);
  if (e.lp_set !== "송달" || !/공소장\s*부본/.test(c) || /변경|병합/.test(c)) return false;
  return toUs(c, ours);
}

export type Deadline = { t: string; d: string; why: string; st: "open" | "done" | "expected"; kind: string; doneOn?: string; hold?: string; warn?: string; who?: string };

// ── 사무실 PC(extract_deadlines.py)에만 있던 규칙 (2026-11-20 일원화, 석원 "슈파베이스로 몰아 일원화") ──
// 상소·이유서를 낼 주체가 아닌 지위. 피해자·고소인 사건에 항소이유서 기한을 붙이면 오판이다(형소법 361조의3①은 '항소인').
export const NOT_APPELLANT = new Set(["피해자", "고소인", "피고소인", "고발인", "피고발인", "신청인", "참고인"]);
// 공판기일이 실제로 '진행'된 결과. 이유서 문제는 이미 정리된 것이므로 기한을 더 울리지 않는다.
const HEARING_HELD = /^(속행|변론종결|판결선고|심문종결|변론재개|종결)/;
const TRIAL_DATE = /공판기일|변론기일/;
const APPEAL_NOTICE = /(항소장|상고장)\s*접수통지/;

// 피고인이 한 명뿐인가 — '피고인2' 같은 번호가 기록에 없으면 한 명이다.
export function singleDefendant(evs: any[]): boolean {
  return !(evs || []).some((e) => [...nz(e.lp_contents).matchAll(/피고인\s?(\d+)/g)].some((m) => Number(m[1]) >= 2));
}

// 이 서면이 우리 의뢰인 쪽 것인가 (검사·다른 피고인 것 제외).
//  번호 없는 '변호인' → 우리 것. '피고인들' → 우리 것. 번호 없는 '피고인(항소인)의 변호인' → 피고인이 한 명일 때만.
export function ourFiling(c: string, ours: Set<string> | null, single: boolean): boolean {
  const t = nz(c);
  if (/^\s*검사/.test(t)) return false;
  // 서면 기록에서 우리 법인은 '법OOOOOO'로 가려진다. 다른 법무법인 이름이 그대로 보이면 남의 서면
  if (/법무법인\s*[가-힣]/.test(t) && !OUR_FIRM.test(t)) return false;
  if (!ours) return true;
  const m = t.match(/피고인(들|\s?\d+)?/);
  if (!m) return true;
  if (m[1] === "들") return true;
  if (!m[1]) return single;
  return ours.has(m[1].trim());
}

// 병합 사건(규칙서 R21~R23, 석원 확정 2026-11-17): 같은 방의 다른 사건(주 사건)에 병합되면 이유서는 주 사건 기록에만 남는다.
//  ① 다른 사건 기록에 "항소이유서(26-100177)"처럼 이 사건번호가 괄호로 붙은 이유서 줄 → 제출
//  ② 다른 사건에 병합심리결정·분리.병합결정이 있고 그날 이후 우리 쪽 이유서 제출 줄 → 제출
//  병합은 됐는데 제출 줄이 없으면 열어 두고 "○○에 병합됨, 그 사건에 제출"을 적는다.
export type OtherCase = { code: string; evs: any[] };
const MERGE_RE = /병합심리결정|분리\s*[.·]?\s*병합\s*결정/;
const OURS_RE = /법무법인\s*정서|법O{6}(?!O)/;
export function shortNos(code: string): string[] {
  const m = nz(code).replace(/\s/g, "").match(/^(\d{2}|\d{4})[가-힣]+0*(\d+)$/);
  if (!m) return [];
  const y2 = m[1].slice(-2);
  return [y2 + "-" + m[2], "20" + y2 + "-" + m[2], nz(code).replace(/\s/g, "")];
}
export function mergedReason(code: string, from: string, others: OtherCase[]): { done?: string; into?: string } {
  const mine = shortNos(code);
  let best: string | undefined, into: string | undefined;
  for (const o of others || []) {
    const list = (o.evs || []).filter((e) => isDate(e.lp_appoint_date)).map((e) => ({ d: nz(e.lp_appoint_date).slice(0, 10), c: nz(e.lp_contents), set: e.lp_set }));
    for (const e of list) {
      if (e.d < from || !/이유서/.test(e.c) || /연장|기간/.test(e.c)) continue;
      const paren = e.c.match(/이유서\s*\(([^)]*)\)/);
      if (paren && mine.some((n) => paren[1].replace(/\s/g, "") === n)) { if (!best || e.d < best) best = e.d; }
    }
    const merge = list.filter((e) => MERGE_RE.test(e.c)).map((e) => e.d).sort()[0];
    if (!merge) continue;
    into = into || o.code;
    const f = list.find((e) => e.set === "서면" && e.d >= merge && e.d >= from && /이유서/.test(e.c) && !/연장|기간|보충/.test(e.c) && OURS_RE.test(e.c));
    if (f && (!best || f.d < best)) best = f.d;
  }
  return { done: best, into };
}

export function computeDeadlines(code: string, evs: any[], today: string, others: OtherCase[] = [], position = ""): Deadline[] {
  const top = courtStage(code);
  if (!top) return [];
  if (NOT_APPELLANT.has(nz(position))) return []; // 우리 의뢰인이 피해자·고소인이면 상소·이유서 주체가 아니다
  const list = (evs || []).filter((e) => isDate(e.lp_appoint_date))
    .map((e) => ({ ...e, _d: nz(e.lp_appoint_date).slice(0, 10) }))
    .sort((a, b) => a._d.localeCompare(b._d) || (a.lp_num || 0) - (b.lp_num || 0));
  // 검사가 낸 항소장·이유서는 우리 제출이 아니다 (박큰별 1심: 검사 항소 11.04를 '제출'로 봄, 2026-11-19)
  const ours = ourDefendants(list);
  const single = singleDefendant(list);
  // 공동피고인 사건에서 다른 피고인이 낸 이유서를 우리 제출로 보면 기한을 놓친다 → 우리 쪽 서면만
  const filings = list.filter((e) => e.lp_set === "서면" && ourFiling(nz(e.lp_contents), ours, single));

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
  // 공소장 부본 + 7일(형소법 266조의2 의견서)은 훈시 기한이라 기한으로 띄우지 않는다(2026-11-20 석원 결정). '공소장 부본 도달' 줄만 타임라인에 남는다
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
      const prevV = items.slice(0, i).reverse().find((x) => x.kind === "v") as { d: string } | undefined;
      const inRound = (e: any) => e._d >= (prevV ? prevV.d : "0000") && (!nextV || e._d <= nextV.d);
      // 통지 전에 미리 낸 이유서도 제출로 본다. 범위는 앞 선고 뒤부터
      const done = filings.find((f) => inRound(f) && /이유서/.test(nz(f.lp_contents)) && !/연장|기간/.test(nz(f.lp_contents)));
      const mg = done ? {} : mergedReason(code, it.first, others);
      const doneOn = done?._d || mg.done;
      // 이 심급이 종국(상고기각결정 등)으로 끝났으면 더 울리지 않는다(사무실 PC 규칙). 선고는 다음 상소 기한이 따로 잡힌다
      const ended = doneOn ? undefined : list.find((e) => e.lp_set === "접수" && /종국/.test(nz(e.lp_contents)) && !/선고/.test(nz(e.lp_contents)) && e._d >= first.d && (!nextV || e._d <= nextV.d));
      // 기산일 뒤 공판기일이 실제로 열렸으면 상소가 각하되지 않고 진행 중 → 더 울리지 않는다
      const held = doneOn ? undefined : ended || list.find((e) => e.lp_set === "기일" && TRIAL_DATE.test(nz(e.lp_contents)) && HEARING_HELD.test(nz(e.lp_remark)) && e._d >= first.d && (!nextV || e._d <= nextV.d));
      // 상소장접수통지는 '상대방'이 받는다. 우리 쪽만 받았으면 검사만 상소했을 수 있다(그러면 이유서 의무 없음)
      const an = list.filter((e) => APPEAL_NOTICE.test(nz(e.lp_contents)) && inRound(e));
      const prosOnly = an.length > 0 && !an.some((e) => /^\s*검사/.test(nz(e.lp_contents)));
      // 검사만 상소 + 우리가 '항소이유에 대한 답변서'를 냈으면 우리는 피항소인 → 이유서 의무 없음
      // 상소장접수통지 기록이 없어도(로웨어에 하급심 줄이 빠진 사건) 우리가 이유서 없이 '항소이유에 대한 답변서'만 냈으면
      // 검사 상소에 답한 피항소인으로 본다 → 이유서 의무 없음, 알림 끔 (2026-11-24 석원, 천준명 2026노100191)
      const answered = !doneOn ? filings.find((f) => inRound(f) && /이유에\s*대한\s*답변서/.test(nz(f.lp_contents))) : undefined;
      const warn = prosOnly && !answered ? "상소장접수통지서가 우리 측에만 송달됨 — 검사만 상소했다면 이유서 제출 의무가 없습니다. 확인 필요"
        : first.who !== "우리" && !it.got.some((g) => g.who === "우리") ? "우리 법인 수신 기록이 없어 의뢰인 수신일로 계산했습니다. 기간이 이미 진행 중일 수 있습니다" : undefined;
      out.push({
        t: what + " 마감", d: due, kind: what, doneOn, st: doneOn || held || answered ? "done" : "open", who: first.who,
        hold: held ? (held === ended ? "종국 " + md(held._d) : "공판기일 진행 " + md(held._d)) : answered ? "검사 상소 · 답변서 " + md(answered._d) : undefined, warn,
        why: "기록접수통지 도달 " + md(first.d) + "(" + first.who + ") + 20일" + (moved ? " (쉬는 날이라 다음 평일)" : "") +
          (mg.into ? " · " + mg.into + "에 병합됨" + (mg.done ? ", 그 사건에 제출 " + md(mg.done) : ", 그 사건에 제출") : ""),
      });
    }
  });
  return out;
}

// 타임라인 줄로: 이미 낸 기한은 '제출' 줄이 따로 있으니 빼고, 남은 것만 기한 줄로.
export function deadlineEvents(dls: Deadline[], today: string) {
  // 제출이 끝난 기한도 지우지 않고 회색 "제출 m.d"로 남긴다 (2026-11-19 석원, 이강효 사건)
  return dls.filter((x) => x.d).map((x) => x.st === "done" ? {
    d: x.d, k: "done", g: "limit", lim: 0, dk: x.kind, cfa: x.hold && !x.doneOn ? x.hold : "제출" + (x.doneOn ? " " + md(x.doneOn) : ""),
    t: x.t + " · " + x.why, f: null,
  } : {
    d: x.d, k: x.d >= today ? "due" : "done", g: "limit", lim: x.d >= today ? 1 : 0, dk: x.kind,
    t: x.t + (x.st === "expected" ? " (선고되면)" : "") + " · " + x.why, f: null,
  });
}

// 한 방에 사건이 둘 이상일 때 본 사건·병합된 사건 가리기 (2026-11-17 석원 요청)
// 근거 순서: ①방 제목 "본사건 (병합)병합사건" ②"종국 : 병합" 줄이 있는 쪽 = 병합된 사건
// ③병합 결정 줄(병합심리결정·분리.병합결정)이 있는 쪽 = 본 사건 (결정은 본 사건 기록에만 남음)
export function mergeRoles(cases: { code: string; evs: any[] }[], title = ""): { main: string; merged: string[] } | null {
  const list = (cases || []).filter((x) => x.code);
  if (list.length < 2) return null;
  const text = (e: any) => nz(e?.lp_contents ?? e?.c);
  const has = (x: any, re: RegExp) => (x.evs || []).some((e: any) => re.test(text(e)));
  const hit = (x: any, t: string) => {
    const m = nz(x.code).replace(/\s/g, "").match(/^(\d{2}|\d{4})([가-힣]+)0*(\d+)$/);
    return !!m && new RegExp("(^|[^0-9])(20)?" + m[1].slice(-2) + m[2] + m[3] + "(?![0-9])").test(t);
  };
  const t = nz(title).replace(/\s/g, "");
  const mt = t.match(/^(.*?)\(병합\)(.*)$/);
  let main = mt ? list.find((x) => hit(x, mt[1]) && !hit(x, mt[2])) : undefined;
  if (!main) {
    const ended = list.filter((x) => has(x, /종국\s*:\s*[^,]*병합/));
    const deciders = list.filter((x) => has(x, MERGE_RE) && !ended.includes(x));
    if (deciders.length === 1) main = deciders[0];
    else if (ended.length && ended.length === list.length - 1) main = list.find((x) => !ended.includes(x));
  }
  if (!main) return null;
  return { main: main.code, merged: list.filter((x) => x !== main).map((x) => x.code) };
}

// 기한 사람 확정 (규칙서 R17, 2026-11-19 석원): 웍스 알림 카드 버튼이나 기한 탭 [수정]에서 누른 기록(deadline_confirm)
export const DL_ACTS: Record<string, string> = { f: "제출함", n: "상소 안 함", c: "종결·사임" };
export function applyConfirms(shaped: any, rows: any[]) {
  const key = (kind: unknown, d: unknown) => nz(kind) + "|" + nz(d).slice(0, 10);
  const m = new Map<string, any>();
  for (const r of rows || []) if (!r.undone_at && !m.has(key(r.kind, r.due))) m.set(key(r.kind, r.due), r);
  for (const x of shaped.deadlines || []) {
    const r = x.d ? m.get(key(x.kind, x.d)) : null;
    if (r) x.cf = { a: nz(r.action), id: r.id };
  }
  for (const e of shaped.events || []) {
    if (e.g !== "limit" || !e.dk) continue;
    const r = m.get(key(e.dk, e.d));
    if (r) { e.cfa = nz(r.action); e.k = "done"; e.lim = 0; }
  }
}
