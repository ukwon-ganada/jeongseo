// ============================================================================
//  수사 단계 기한 (규칙서 R18~R20, 석원 확정 2026-11-16)
//
//  로웨어에는 경찰·검찰 통지일이 없어서, 사건방 줄(room_event)에서 처분·통지 날짜를 잡는다.
//    · 직원이 타임라인 [수정]으로 직접 넣은 줄(source manual) → "확정"
//    · 대화 파일에서 뽑은 줄(chat-export 등)                   → "미확정(대화 기준)"
//    · 처분일만 있으면 처분일을 통지일로 본다(실제보다 이르거나 같아 안전)
//  기간: 불기소 항고 30일 / 항고기각 → 재정신청 10일·재항고 30일 / 재정신청 기각 → 즉시항고 7일
//        / 불송치 이의신청 3개월(2026.10.2 이후 통지분만)
//  말일이 토·일·공휴일이면 다음 평일(R20). 미뤄졌으면 원래 말일도 적는다.
//  대상(R18): 우리 의뢰인이 고소인·피해자. 방 제목 괄호가 피의자·피고인 쪽이면 계산하지 않는다.
//  예외: 약식명령 → 정식재판청구 7일(형소법 453조)은 피의자·피고인 쪽 기한이라 고소인 방에서는 계산하지 않는다.
// ============================================================================
import { dueDate, type Deadline } from "./deadlines.ts";

const nz = (v: unknown) => (v == null ? "" : String(v).trim());
const md = (d: string) => Number(d.slice(5, 7)) + "." + d.slice(8, 10);
const WK = ["일", "월", "화", "수", "목", "금", "토"];
const wk = (d: string) => WK[new Date(d + "T00:00:00Z").getUTCDay()];

// 방 제목 괄호로 의뢰인 지위: "victim"(고소·피해·고발) / "suspect"(피의·피고·국선·항) / ""(모름)
export function clientRole(title: string): "victim" | "suspect" | "" {
  const p = (nz(title).match(/\(([^)]*)\)/) || [])[1] || "";
  if (/피고소|피의|피고|국선|\/피\d*$|\/피\//.test(p) || /^형\/항/.test(p)) return "suspect";
  if (/고소|피해|고발|\/고$/.test(p)) return "victim";
  return "";
}

type Rule = { side?: "suspect"; key: string; t: string; days?: number; months?: number; from?: string; strip: RegExp; done: RegExp };
type Ev = { key: string; d: string; manual: boolean; notice: boolean; label: string };

// 처분 줄 → 생기는 기한들
function eventOf(r: any): { key: string; label: string } | null {
  // 괄호 속 메모("(재정신청 마감 11/23)" 등)는 처분 종류 판단에서 뺀다
  const s = nz(r.summary).replace(/\([^)]*\)/g, " ");
  if (r.kind === "지시" || /예정|지시|이유서|신청서|항고장|제출|작성/.test(s)) return null;
  if (/재정신청\s*(이|은|에\s*대한)?\s*기각/.test(s)) return { key: "jaejeong_reject", label: "재정신청 기각" };
  if (/항고\s*(이|은|에\s*대한)?\s*기각/.test(s)) return { key: "hanggo_reject", label: "항고 기각" };
  if (/약식\s*명령/.test(s) && !/청구|기소|정식/.test(s)) return { key: "yaksik", label: "약식명령" };
  if (/불기소/.test(s)) return { key: "nopros", label: "불기소" };
  if (/불송치/.test(s) && !/이의/.test(s)) return { key: "nosend", label: "불송치" };
  return null;
}

const RULES: Record<string, Rule[]> = {
  nopros: [{ key: "항고", t: "항고 마감", days: 30, strip: /항고/, done: /항고장|항고\s*(서|이유서)?\s*(우편\s*)?제출/ }],
  hanggo_reject: [
    { key: "재정신청", t: "재정신청 마감", days: 10, strip: /재정/, done: /재정신청서?\s*(우편\s*)?제출/ },
    { key: "재항고", t: "재항고 마감 (재정신청 못 하는 경우)", days: 30, strip: /재항고/, done: /재항고(장|서)?\s*(우편\s*)?제출/ },
  ],
  jaejeong_reject: [{ key: "즉시항고", t: "재정신청 기각 즉시항고 마감", days: 7, strip: /즉시항고/, done: /즉시항고(장|서)?\s*(우편\s*)?제출/ }],
  yaksik: [{ side: "suspect", key: "정식재판청구", t: "정식재판청구 마감", days: 7, strip: /정식재판/, done: /정식\s*재판\s*청구(서)?\s*(우편\s*)?(제출|접수|완료)/ }],
  nosend: [{ key: "이의신청", t: "불송치 이의신청 마감", months: 3, from: "2026-10-02", strip: /이의/, done: /이의신청서?\s*(우편\s*)?제출/ }],
};

// 초일불산입 + n개월: 기산일과 같은 날짜(없으면 그 달 말일)
export function addMonths(d: string, n: number): string {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n, day = Number(d.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}
function dueMonths(d: string, n: number) {
  const raw = addMonths(d, n);
  const r = dueDate(raw, 0);
  return { due: r.due, moved: r.moved, raw };
}

// 제출로 보는 줄: 지시·기일(마감일 메모) 아님, '예정' 아님, 오늘 이후 날짜 아님, "미제출·마감·예정" 같은 말 없음
// (2026-11-20 석원: 2026형제42256 "항고 마감일(항고장 미제출)" 12.06 예정 줄을 제출로 봐서 회색 "제출 12.06"이 뜸)
const NOT_DONE = /미\s*제출|마감|예정|안\s*(냄|함)|못\s*(냄|함)|준비|작성/;
// 2026-11-20 석원 결정: 방 대화 AI가 맥락으로 "이 서류를 실제로 냈다"고 판단한 줄(filed)이 있으면 그 판단만 쓴다.
// filed 칸이 없는 줄(직원 입력, 예전 줄, 대화 가져오기)은 낱말 규칙으로 본다.
const FILED_KEY: Record<string, string> = { 항고장: "항고", 재항고장: "재항고", 재정신청서: "재정신청", 즉시항고장: "즉시항고", 이의신청서: "이의신청", 정식재판청구서: "정식재판청구" };
function isDone(r: any, from: string, today: string): boolean {
  const d = nz(r.ev_date).slice(0, 10);
  if (r.kind === "지시" || nz(r.state) === "예정" || d < from || (today && d > today)) return false;
  if (r.filed != null) return true;
  return r.kind !== "기일" && !NOT_DONE.test(nz(r.summary));
}

export type InvDeadline = Deadline & { strip: RegExp };

export function computeInvDeadlines(rows: any[], title: string, today: string): InvDeadline[] {
  const role = clientRole(title);
  const evs: Ev[] = [];
  for (const r of rows || []) {
    const e = eventOf(r);
    const d = nz(r.ev_date).slice(0, 10);
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    evs.push({ key: e.key, d, manual: r.source === "manual", notice: /통지|수령|받|도달|송달/.test(nz(r.summary)), label: e.label });
  }
  const out: InvDeadline[] = [];
  for (const key of Object.keys(RULES)) {
    const all = evs.filter((e) => e.key === key);
    if (!all.length) continue;
    // 직원이 넣은 날이 있으면 그것(확정), 없으면 대화 줄. 같은 회차(마지막 줄 기준 30일 안)에서 가장 이른 날(빠른 날 원칙)
    const pool = all.some((e) => e.manual) ? all.filter((e) => e.manual) : all;
    const latest = pool.map((e) => e.d).sort().pop()!;
    const lo = new Date(Date.parse(latest) - 30 * 864e5).toISOString().slice(0, 10);
    const base = pool.filter((e) => e.d >= lo).sort((a, b) => a.d.localeCompare(b.d) || Number(b.notice) - Number(a.notice))[0];
    for (const rule of RULES[key]) {
      if (rule.side === "suspect" ? role === "victim" : role === "suspect") continue;
      if (rule.from && base.d < rule.from) continue;
      let due: string, moved: boolean, raw: string;
      if (rule.months) ({ due, moved, raw } = dueMonths(base.d, rule.months));
      else { const r = dueDate(base.d, rule.days!); due = r.due; moved = r.moved; raw = new Date(Date.parse(base.d) + rule.days! * 864e5).toISOString().slice(0, 10); }
      const done = (rows || []).find((r) => isDone(r, base.d, today) &&
        (r.filed == null ? rule.done.test(nz(r.summary)) : FILED_KEY[nz(r.filed)] === rule.key));
      const conf = base.manual ? "확정" : "미확정(대화 기준)";
      const why = conf + " · " + base.label + (base.notice ? " 통지 " : " 처분 ") + md(base.d) + (base.notice ? "" : "(처분일을 통지일로 봄)") +
        " + " + (rule.months ? rule.months + "개월" : rule.days + "일") +
        (moved ? " · 원래 말일 " + md(raw) + "(" + wk(raw) + ")이 쉬는 날이라 다음 평일" : "") +
        (role ? "" : rule.side ? " · 의뢰인 지위(피고인 여부) 확인 필요" : " · 의뢰인 지위(고소인 여부) 확인 필요");
      out.push({ t: rule.t, d: due, kind: rule.key, st: done ? "done" : "open", doneOn: done ? nz(done.ev_date).slice(0, 10) : undefined, why, strip: rule.strip });
    }
  }
  return out;
}

// 계산한 수사 단계 기한을 화면 자료에 넣는다. 같은 종류의 '대화에서 뽑은 마감' 줄은 계산값으로 대신하므로 뺀다.
export function applyInvDeadlines(shaped: any, rows: any[], title: string) {
  const list = computeInvDeadlines(rows, title, shaped.today);
  if (!list.length) return;
  const isChatLimit = (x: any) => x.kind === "대화";
  shaped.deadlines = (shaped.deadlines || []).filter((x: any) => !(isChatLimit(x) && list.some((l) => l.strip.test(x.t))));
  shaped.events = (shaped.events || []).filter((e: any) => !(e.src === "chat" && e.g === "limit" && list.some((l) => l.strip.test(e.t))));
  for (const l of list) {
    const { strip: _s, ...dl } = l;
    shaped.deadlines.push(dl);
    if (dl.st === "done") continue;
    shaped.events.push({ d: dl.d, k: dl.d >= shaped.today ? "due" : "done", g: "limit", lim: dl.d >= shaped.today ? 1 : 0, t: dl.t + " · " + dl.why, f: null });
  }
  shaped.events.sort((a: any, b: any) => a.d.localeCompare(b.d) || (b.g === "accept" ? 1 : 0) - (a.g === "accept" ? 1 : 0));
}
