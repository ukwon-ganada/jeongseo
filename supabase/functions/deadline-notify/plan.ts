// ============================================================================
//  기한 웍스 알림 — 무엇을, 언제, 어떻게 보낼지 (순수 함수, 시험 가능)
//
//  2026-11-20 석원: "기한계산기 두 벌 문제는 해결해야 한다. 슈파베이스 쪽으로 몰아 일원화하자"
//  → 사건 화면과 같은 계산(case-view/deadlines.ts, inv_deadlines.ts)으로 알림을 보낸다.
//     사무실 PC notify.py의 알림 규칙을 그대로 옮겼다.
//
//  대상: 서고은 변호사 팀 사건만(석원 2026-11-20). 정필성 변호사 팀은 빼고, 팀 이름이 하나라도 있어야 한다.
//  주기(석원 2026-11-19 선택): 마감일이 처음 계산된 날 1회, D-7 무렵 1회(D-7~D-4 중 아직 안 보냈으면), D-3부터 마감·경과까지 매일.
//        50일 넘게 지난 기한은 보내지 않는다(이미 아는 일이라 매일 울리면 알림 전체 신뢰가 떨어짐).
//  사람 확정(R17): [제출함] → 더 안 보냄. [상소 안 함][종결·사임] → 마감 전날 한 번만 더.
//  종류: 항소·상고(선고 7일), 항소이유서·상고이유서(기록접수통지 20일), 수사 단계(항고·재정신청·재항고·즉시항고·이의신청·정식재판청구, 석원 2026-11-20 "함께 보내기")
// ============================================================================
import type { Deadline } from "../case-view/deadlines.ts";

export const TEAM = ["서고은", "이예나", "양선화", "강현구", "박종덕"];
export const FORMER = ["우숭민"]; // 퇴직: 송달 판별엔 넣고 '담당' 표시엔 뺀다
export const DAILY_FROM = 3;
export const WINDOW = 7;
export const OVERDUE_LIMIT = 50;

// 알림 본문에 쓰는 이름. 이유서 두 종류는 사무실 PC와 같은 글자라 지난 발송기록(sent)으로 주기가 이어진다.
export const LABEL: Record<string, string> = {
  항소: "항소장", 상고: "상고장", 항소이유서: "항소이유서", 상고이유서: "상고이유서",
  항고: "항고장", 재항고: "재항고장", 재정신청: "재정신청서", 즉시항고: "즉시항고장", 이의신청: "이의신청서", 정식재판청구: "정식재판청구서",
};
const WK = "일월화수목금토";
const nz = (v: unknown) => (v == null ? "" : String(v).trim());
export const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const wk = (d: string) => WK[new Date(d + "T00:00:00Z").getUTCDay()];

export function isTeamCase(charge: unknown): boolean {
  const c = nz(charge);
  return TEAM.some((n) => c.includes(n));
}

export function lawyersLine(charge: unknown): string {
  const got = nz(charge).replace(/√|\[|\]/g, "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const keep = got.filter((n) => !FORMER.includes(n));
  return (keep.length ? keep : got).map((n) => /변호사$/.test(n) ? n : n + "변호사").join(", ");
}

// 이 기한(사건·종류·만료일)을 언제 이미 알렸는지 — 발송기록 본문으로 찾는다(사무실 PC _announced와 같은 방식)
export function announcedKey(code: string, kind: string, due: string) {
  return { code, line: (LABEL[kind] || kind) + " 제출기한  " + due };
}
export type SentRow = { body: string; sent_at: string };
export function announced(rows: SentRow[], code: string, kind: string, due: string, since?: string): boolean {
  const k = announcedKey(code, kind, due);
  return rows.some((r) => r.body.includes(k.code) && r.body.includes(k.line) && (!since || r.sent_at.slice(0, 10) >= since));
}

export type Confirm = { action: string };
export type Pick = { send: boolean; why: string };

// 오늘 이 기한을 보낼지
export function pick(dl: Deadline, code: string, today: string, sent: SentRow[], confirm?: Confirm): Pick {
  if (!dl.d) return { send: false, why: "도달 전" };
  if (dl.st === "expected") return { send: false, why: "선고 전" };
  if (dl.st === "done") return { send: false, why: dl.hold || "제출 " + (dl.doneOn || "") };
  const dday = days(today, dl.d);
  if (confirm) {
    if (confirm.action === "제출함") return { send: false, why: "[제출함] 확인" };
    if (dday !== 1) return { send: false, why: "[" + confirm.action + "] 확인 · 전날만 다시" };
    return { send: true, why: "[" + confirm.action + "] 확인 · 마감 전날" };
  }
  // 상소장(선고 7일)·수사 단계 서류는 마감이 지나면 확정·종결이라 지난 뒤 다시 울릴 일이 없다.
  // 경과 알림은 이유서만(기간 경과 뒤에도 연장 신청 등 할 일이 남음, 2025마7481) — 사무실 PC와 같음
  if (dday < 0 && !/이유서$/.test(dl.kind)) return { send: false, why: "마감 지남" };
  if (-dday > OVERDUE_LIMIT) return { send: false, why: OVERDUE_LIMIT + "일 넘게 지남" };
  if (dday > DAILY_FROM) {
    const first = !announced(sent, code, dl.kind, dl.d);
    const week = dday <= WINDOW && !announced(sent, code, dl.kind, dl.d, addDays(dl.d, -WINDOW));
    if (!first && !week) return { send: false, why: "쉬는 날(첫날·7일 전·3일 전부터 매일)" };
    return { send: true, why: first ? "처음 계산됨" : "7일 전" };
  }
  return { send: true, why: dday >= 0 ? "3일 이내" : "경과" };
}

export function deadlineLines(dl: Deadline, today: string, confirm?: Confirm): string[] {
  const dday = days(today, dl.d);
  const when = dday > 0 ? "D-" + dday : dday === 0 ? "오늘 마감" : -dday + "일 경과";
  const warn = !!dl.warn;
  const out = [(warn ? "🟡 " : "🔴 ") + (LABEL[dl.kind] || dl.kind) + " 제출기한  " + dl.d + "(" + wk(dl.d) + ")  · " + when, "    " + dl.why];
  if (dl.warn) out.push("    ⚠️ " + dl.warn);
  if (confirm) out.push("    ※ [" + confirm.action + "]로 확인된 기한입니다 — 마감 전날 한 번 더 알립니다");
  return out;
}

export function card(code: string, kind: string, due: string) {
  // 버튼 글자는 사무실 PC 카드와 같다(웍스 콜백·사건 화면이 이 세 가지로 기록·표시)
  const acts: [string, string][] = [["제출함", "f"], ["상소 안 함", "n"], ["종결·사임", "c"]];
  return {
    title: (code + " " + (LABEL[kind] || kind)).slice(0, 40),
    text: "마감 " + due.slice(5) + "(" + wk(due) + ")",
    actions: acts.map(([label, a]) => ({ type: "postback", label, data: `dl|${a}|${code}|${kind}|${due}` })),
  };
}

export function roomMessage(code: string, client: string, charge: string, lines: string[]): string {
  const head = "📋 " + (code || "사건관리 알림") + (client ? " · " + client : "");
  const lw = lawyersLine(charge);
  return [head, ...(lw ? ["담당 " + lw] : []), "", ...lines].join("\n").trimEnd();
}
