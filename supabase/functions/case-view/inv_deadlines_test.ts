import { assertEquals } from "jsr:@std/assert@1";
import { addMonths, applyInvDeadlines, clientRole, computeInvDeadlines } from "./inv_deadlines.ts";

// 2026-2984 실제 줄(요약만)
const rows2984 = [
  { kind: "기타", ev_date: "2026-05-29", summary: "진행사항 확인 (불송치 예정 안내)", source: "chat-export" },
  { kind: "처분", ev_date: "2026-06-04", summary: "불송치 통지서 수령", source: "chat-export" },
  { kind: "서면제출", ev_date: "2026-06-29", summary: "불송치이의신청서 우편 제출", source: "chat-export" },
  { kind: "처분", ev_date: "2026-11-06", summary: "불기소 처분", source: "chat-export" },
  { kind: "지시", ev_date: "2026-11-10", summary: "항고 진행 지시 (서변호사)", source: "chat-export" },
  { kind: "기타", ev_date: "2026-11-16", summary: "불기소이유서 수령", source: "chat-export" },
  { kind: "지시", ev_date: "2026-11-16", summary: "항고장 작성 지시 (서변호사)", source: "chat-export" },
  { kind: "기일", ev_date: "2026-12-06", summary: "항고 마감일", source: "chat-export" },
];

Deno.test("2026-2984: 불기소 11.6 → 항고 12.7(월), 미확정(대화 기준), 원래 말일 12.6(일)", () => {
  const l = computeInvDeadlines(rows2984, "(형/고소)이름_협박_경찰서", "2026-11-16");
  assertEquals(l.map((x) => [x.kind, x.d, x.st]), [["항고", "2026-12-07", "open"]]);
  assertEquals(/미확정\(대화 기준\)/.test(l[0].why) && /원래 말일 12.06\(일\)/.test(l[0].why), true, l[0].why);
});

Deno.test("불송치 이의신청 3개월은 2026.10.2 이후 통지분만", () => {
  assertEquals(computeInvDeadlines([{ kind: "처분", ev_date: "2026-06-04", summary: "불송치 통지서 수령" }], "(형/고소)", "2026-11-16").length, 0);
  const l = computeInvDeadlines([{ kind: "처분", ev_date: "2026-10-15", summary: "불송치 결정 통지 수령" }], "(형/피해자)", "2026-11-16");
  assertEquals(l.map((x) => [x.kind, x.d]), [["이의신청", "2027-01-15"]]);
});

Deno.test("항고 기각 → 재정신청 10일·재항고 30일, 직원 입력은 확정·대화보다 우선", () => {
  const l = computeInvDeadlines([
    { kind: "처분", ev_date: "2026-11-02", summary: "항고 기각", source: "chat-export" },
    { kind: "기타", ev_date: "2026-11-04", summary: "항고기각 통지 수령", source: "manual" },
  ], "(형/고소)", "2026-11-16");
  assertEquals(l.map((x) => [x.kind, x.d]), [["재정신청", "2026-11-16"], ["재항고", "2026-12-04"]]);
  assertEquals(l[0].why.startsWith("확정"), true);
});

Deno.test("의뢰인이 피의자 쪽이면 계산하지 않음, 지위 모르면 계산하고 확인 필요 표시", () => {
  const r = [{ kind: "처분", ev_date: "2026-11-06", summary: "불기소 처분" }];
  assertEquals(computeInvDeadlines(r, "(형/피의)이름_사기", "2026-11-16").length, 0);
  assertEquals(computeInvDeadlines(r, "(형/피고소인)", "2026-11-16").length, 0);
  const l = computeInvDeadlines(r, "", "2026-11-16");
  assertEquals(/지위/.test(l[0].why), true);
});

Deno.test("항고장 제출 줄이 있으면 제출로 표시", () => {
  const l = computeInvDeadlines([
    { kind: "처분", ev_date: "2026-11-06", summary: "불기소 처분" },
    { kind: "서면제출", ev_date: "2026-11-20", summary: "항고장 우편 제출" },
  ], "(형/고소)", "2026-11-25");
  assertEquals([l[0].st, l[0].doneOn], ["done", "2026-11-20"]);
});

Deno.test("지위 판별·개월 계산", () => {
  assertEquals(["(형/고소)", "(형/피해자)", "(형/고)", "(형/고소대리)", "(형/고발)", "(형/피)", "(형/항/피)", "(형/피고인2)", "(국선)", "(형)"].map(clientRole),
    ["victim", "victim", "victim", "victim", "victim", "suspect", "suspect", "suspect", "suspect", ""]);
  assertEquals(addMonths("2026-11-30", 3), "2027-02-28");
});

Deno.test("계산값이 있으면 같은 종류의 '대화 마감' 줄은 뺀다", () => {
  const shaped: any = { today: "2026-11-16", events: [{ d: "2026-12-06", g: "limit", src: "chat", t: "항고 마감일" }], deadlines: [{ t: "항고 마감일", d: "2026-12-06", kind: "대화" }] };
  applyInvDeadlines(shaped, rows2984, "(형/고소)");
  assertEquals(shaped.deadlines.map((x: any) => [x.t, x.d]), [["항고 마감", "2026-12-07"]]);
  assertEquals(shaped.events.map((e: any) => e.d), ["2026-12-07"]);
});

Deno.test("괄호 속 메모의 '재정신청'은 처분 종류로 보지 않는다 (이강효 2026고불항5875)", () => {
  const l = computeInvDeadlines([
    { kind: "지시", ev_date: "2026-11-12", summary: "재정신청 진행 지시 (서변호사)", source: "chat-export" },
    { kind: "처분", ev_date: "2026-11-12", summary: "항고 기각 확인 (재정신청 마감 11/23)", source: "chat-export" },
  ], "(형/고소)이강효", "2026-11-16");
  assertEquals(l.map((x) => [x.t, x.d]), [["재정신청 마감", "2026-11-23"], ["재항고 마감 (재정신청 못 하는 경우)", "2026-12-14"]]);
});

Deno.test("약식명령 → 정식재판청구 7일 (피고인 쪽만), 청구서 제출하면 끝", () => {
  const r = [
    { kind: "처분", ev_date: "2026-09-09", summary: "약식명령 결정 (청구마감 9.16.)", source: "chat-export" },
    { kind: "기타", ev_date: "2026-08-20", summary: "벌금 50만원 약식기소 확인", source: "chat-export" },
  ];
  const l = computeInvDeadlines(r, "(형/피의)이름_사기", "2026-09-10");
  assertEquals(l.map((x) => [x.kind, x.d, x.st]), [["정식재판청구", "2026-09-16", "open"]]);
  assertEquals(computeInvDeadlines(r, "(형/고소)이름_사기", "2026-09-10").length, 0);
  const done = computeInvDeadlines([...r, { kind: "서면제출", ev_date: "2026-09-14", summary: "정식재판청구서 제출" }], "(형/피의)", "2026-09-15");
  assertEquals(done[0].st, "done");
  assertEquals(/피고인 여부/.test(computeInvDeadlines(r, "이름 사건", "2026-09-10")[0].why), true);
});
