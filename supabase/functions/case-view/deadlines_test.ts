import { assertEquals } from "jsr:@std/assert@1";
import { computeDeadlines, dueDate, mergeRoles } from "./deadlines.ts";

const S = (d: string, c: string, dd: string | null, r = "") => ({ lp_set: "송달", lp_appoint_date: d, lp_contents: c, lp_remark: r, delivered_date: dd });
const F = (d: string, c: string) => ({ lp_set: "서면", lp_appoint_date: d, lp_contents: c });
const V = (d: string, r = "판결선고") => ({ lp_set: "기일", lp_appoint_date: d, lp_contents: "선고기일(412호 14:00)", lp_remark: r });

Deno.test("날 세기: 첫날 빼고, 일요일이면 월요일", () => {
  assertEquals(dueDate("2026-07-06", 20), { due: "2026-07-27", moved: true });
  assertEquals(dueDate("2026-10-29", 20), { due: "2026-11-18", moved: false });
});

Deno.test("1심 선고(하급심 기록) → 항소 7일, 피고인이 항소장 냄 → 제출. 기록접수통지 → 항소이유서", () => {
  const dl = computeDeadlines("2026노101017", [
    V("2026-10-29"), F("2026-11-05", "피고인  김OO 항소장 제출"),
    S("2026-11-09", "검사  인천지방공소청장 소송기록접수통지서 발송", "2026-11-09"),
    S("2026-11-10", "피고인1  인OO 소송기록접수통지서 발송", "2026-11-10"),
    S("2026-11-10", "피고인1 변호인  법무법인 정서 소송기록접수통지서/전자소송안내문 발송", "2026-11-12"),
  ], "2026-11-13");
  assertEquals(dl.map((x) => [x.t, x.d, x.st]), [["항소 마감", "2026-11-05", "done"], ["항소이유서 마감", "2026-11-30", "open"]]);
});

Deno.test("정답표: 2026노2208 → 7/27 (다른 변호인 통지는 무시)", () => {
  const dl = computeDeadlines("2026노2208", [
    S("2026-07-02", "피고인1  인OO 소송기록접수통지서 발송", "2026-07-06"),
    S("2026-08-12", "피고인1 변호인  김OO 소송기록접수통지서 발송", "2026-08-18"),
    V("2026-10-16", ""),
  ], "2026-11-13");
  assertEquals(dl[0].d, "2026-07-27");
});

Deno.test("정답표: 2026노395 우리 의뢰인 피고인5 → 6/4, 다른 피고인 날짜는 안 봄", () => {
  const dl = computeDeadlines("2026노395", [
    S("2026-05-14", "피고인1  인OO 소송기록접수통지서 발송", "2026-05-14"),
    S("2026-05-14", "피고인5  김OO 소송기록접수통지서/항소이유서 발송", "2026-05-15"),
    S("2026-05-14", "피고인5 변호인  법무법인 정서 소송기록접수통지서 발송", "2026-05-18"),
    F("2026-06-05", "피고인4 변호인  법OO 항소이유서 제출"),
    { lp_set: "접수", lp_appoint_date: "2026-09-22", lp_contents: "피고인 김OO 종국 : 선고" },
  ], "2026-11-13");
  assertEquals(dl.map((x) => [x.t, x.d]), [["항소이유서 마감", "2026-06-04"], ["상고 마감", "2026-09-29"]]);
});

Deno.test("국선이 이유서 낸 뒤 사선 통지가 또 와도 같은 묶음(재통지 없음) → 완료", () => {
  const dl = computeDeadlines("2026노190", [
    S("2026-03-04", "피고인1  인OO 소송기록접수통지서/국선변호인선정결정등본 발송", "2026-03-06"),
    F("2026-03-24", "피고인1 변호인  허OO 항소이유서 제출"),
    S("2026-04-13", "피고인1 변호인  법무법인 정서 소송기록접수통지서 발송", "2026-04-15"),
    V("2026-05-29", "선고연기"),
  ], "2026-11-13");
  assertEquals(dl.map((x) => [x.t, x.d, x.st]), [["항소이유서 마감", "2026-03-26", "done"]]);
});

Deno.test("상고심: 도달 전이면 날짜 없이 '도달 전'", () => {
  const dl = computeDeadlines("2026도1", [S("2026-11-12", "피고인1 변호인  법무법인 정서 소송기록접수통지서 발송", null, "")], "2026-11-13");
  assertEquals([dl[0].t, dl[0].d, dl[0].st], ["상고이유서 마감", "", "expected"]);
});

Deno.test("약식·신청 사건은 계산 안 함", () => {
  assertEquals(computeDeadlines("2026고약123", [V("2026-10-01")], "2026-11-13"), []);
});

Deno.test("병합 사건: 주 사건 기록의 '항소이유서(26-100177)' 줄이나 병합 뒤 우리 이유서 제출이면 제출 (안형진)", () => {
  const mine = [S("2026-10-02", "피고인1 변호인  법무법인 정서 소송기록접수통지서 발송", "2026-10-13")];
  const main = { code: "2026노364", evs: [
    { lp_set: "명령", lp_appoint_date: "2026-10-13", lp_contents: "(피고인 안OO) 피고인 병합심리결정" },
    F("2026-10-19", "피고인2 변호인  법OOOOOO 항소이유서 제출"),
    S("2026-10-20", "검사  서울광역공소청 인천지부공소청장 항소이유서(26-100177) 발송", null),
  ] };
  const dl = computeDeadlines("2026노100177", mine, "2026-11-17", [main]);
  assertEquals(dl.map((x) => [x.t, x.d, x.st, x.doneOn]), [["항소이유서 마감", "2026-11-02", "done", "2026-10-19"]]);
  assertEquals(dl[0].why.includes("2026노364에 병합됨"), true);
  // 괄호 줄만 있어도 제출
  const only = computeDeadlines("2026노100177", mine, "2026-11-17", [{ code: "2026노364", evs: [main.evs[2]] }]);
  assertEquals([only[0].st, only[0].doneOn], ["done", "2026-10-20"]);
  // 병합만 되고 제출 줄이 없으면 열어 두고 안내
  const open = computeDeadlines("2026노100177", mine, "2026-11-17", [{ code: "2026노364", evs: [main.evs[0]] }]);
  assertEquals(open[0].st, "open");
  assertEquals(open[0].why.endsWith("2026노364에 병합됨, 그 사건에 제출"), true);
  // 다른 사건이 없으면 예전과 같음
  assertEquals(computeDeadlines("2026노100177", mine, "2026-11-17")[0].st, "open");
});

Deno.test("병합 본 사건 가리기", () => {
  const a = { code: "2025고단1888", evs: [{ lp_contents: "(피고인 박OO) 피고인 병합심리결정" }, { lp_contents: "변론재개결정/분리.병합결정/공소장부본(2026고단101287) 발송" }] };
  const b = { code: "2026고단101287", evs: [] };
  assertEquals(mergeRoles([b, a]), { main: "2025고단1888", merged: ["2026고단101287"] });
  assertEquals(mergeRoles([{ code: "2026노100177", evs: [] }, { code: "2026노364", evs: [] }], "서)안형진 26노364 (병합)26노100177"), { main: "2026노364", merged: ["2026노100177"] });
  assertEquals(mergeRoles([{ code: "2026노100177", evs: [{ lp_contents: "종국 : 병합심리결정" }] }, { code: "2026노364", evs: [] }]), { main: "2026노364", merged: ["2026노100177"] });
  assertEquals(mergeRoles([{ code: "2026노1", evs: [] }, { code: "2026노2", evs: [] }]), null);
  assertEquals(mergeRoles([a]), null);
});

Deno.test("공소장 부본 도달 + 7일 → 공소사실 의견서, 합의부면 국민참여재판 의사확인서도", () => {
  const evs = [
    { lp_set: "송달", lp_appoint_date: "2026-06-11", lp_contents: "피고인1  강OO 공소장부본/의견서/국민참여재판의사확인서/안내서 발송", delivered_date: "2026-06-17" },
    { lp_set: "송달", lp_appoint_date: "2026-06-11", lp_contents: "검사 김OO 공소장변경허가신청서부본 발송", delivered_date: "2026-06-12" },
    { lp_set: "송달", lp_appoint_date: "2026-06-20", lp_contents: "피고인2  이OO 공소장부본/의견서 발송", delivered_date: "2026-06-12" },
    { lp_set: "송달", lp_appoint_date: "2026-06-20", lp_contents: "피고인1 변호인  법무법인 정서 공소장부본/공판기일통지서 발송", delivered_date: "2026-06-22" },
  ];
  const ours = [...evs, { lp_set: "서면", lp_appoint_date: "2026-06-25", lp_contents: "피고인1 변호인 법무법인 정서 의견서 제출" }];
  const l = computeDeadlines("2026고합100", evs, "2026-06-18");
  assertEquals(l.map((x) => [x.t, x.d, x.st]), [["공소사실 의견서·국민참여재판 의사확인서 마감", "2026-06-24", "open"]]);
  assertEquals(computeDeadlines("2026고합100", ours, "2026-06-30")[0].st, "done");
  assertEquals(computeDeadlines("2026노100", evs, "2026-06-18").some((x) => x.kind === "의견서"), false);
  const notYet = computeDeadlines("2026고단5", [{ lp_set: "송달", lp_appoint_date: "2026-06-11", lp_contents: "피고인1  김OO 공소장부본/국선변호인선정을위한고지/의견서 발송", delivery_status: "폐문부재" }], "2026-06-18");
  assertEquals(notYet.map((x) => [x.t, x.st]), [["공소사실 의견서 마감", "expected"]]);
});

Deno.test("공소장 의견서 기한이 내지 않은 채 지났으면 빼기", () => {
  const evs = [{ lp_set: "송달", lp_appoint_date: "2025-06-11", lp_contents: "피고인1  강OO 공소장부본/의견서 발송", delivered_date: "2025-06-17" }];
  assertEquals(computeDeadlines("2025고단100", evs, "2026-06-18").length, 0);
});

Deno.test("사람 확정(R17): 같은 종류·만료일 기한과 타임라인 기한 줄에 붙고, 되돌린 기록은 무시", async () => {
  const { applyConfirms } = await import("./deadlines.ts");
  const shaped: any = {
    deadlines: [{ t: "항소이유서 마감", d: "2026-12-08", kind: "항소이유서", st: "open" }, { t: "상고 마감", d: "2026-12-20", kind: "상고", st: "open" }],
    events: [{ g: "limit", d: "2026-12-08", dk: "항소이유서", k: "due", lim: 1 }, { g: "limit", d: "2026-12-20", dk: "상고", k: "due", lim: 1 }],
  };
  applyConfirms(shaped, [
    { id: 1, kind: "항소이유서", due: "2026-12-08", action: "제출함", undone_at: null },
    { id: 2, kind: "상고", due: "2026-12-20", action: "상소 안 함", undone_at: "2026-11-19T00:00:00Z" },
  ]);
  assertEquals(shaped.deadlines[0].cf, { a: "제출함", id: 1 });
  assertEquals(shaped.deadlines[1].cf, undefined);
  assertEquals([shaped.events[0].cfa, shaped.events[0].k], ["제출함", "done"]);
  assertEquals(shaped.events[1].cfa, undefined);
});

Deno.test("검사 항소장은 우리 항소 제출로 보지 않는다 (박큰별 2026-11-19)", () => {
  const evs = [
    { lp_set: "기일", lp_appoint_date: "2026-10-28", lp_contents: "선고기일(제452호 법정 14:00)", lp_remark: "판결선고" },
    { lp_set: "서면", lp_appoint_date: "2026-11-04", lp_contents: "검사  윤OO 항소장 제출" },
  ];
  const d = computeDeadlines("2025고단1888", evs, "2026-11-19").find((x) => x.kind === "항소")!;
  assertEquals([d.st, d.doneOn], ["open", undefined]);
});
