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

Deno.test("공소장 부본 + 7일 의견서는 훈시 기한이라 기한으로 띄우지 않는다(2026-11-20 석원)", () => {
  const evs = [
    { lp_set: "송달", lp_appoint_date: "2026-06-11", lp_contents: "피고인1  강OO 공소장부본/의견서/국민참여재판의사확인서/안내서 발송", delivered_date: "2026-06-17" },
    { lp_set: "송달", lp_appoint_date: "2026-06-20", lp_contents: "피고인1 변호인  법무법인 정서 공소장부본/공판기일통지서 발송", delivered_date: "2026-06-22" },
  ];
  assertEquals(computeDeadlines("2026고합100", evs, "2026-06-18"), []);
  assertEquals(computeDeadlines("2026고정1727", evs, "2026-06-18"), []);
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

// ── 사무실 PC 규칙 옮기기 (2026-11-20 일원화) ──
Deno.test("피해자·고소인 사건은 상소·이유서 기한 없음", () => {
  const evs = [V("2026-10-29"), S("2026-11-10", "피고인1  인OO 소송기록접수통지서 발송", "2026-11-10")];
  assertEquals(computeDeadlines("2026노1", evs, "2026-11-13", [], "피해자").length, 0);
  assertEquals(computeDeadlines("2026노1", evs, "2026-11-13", [], "피고인").length, 2);
});

Deno.test("공동피고인: 다른 피고인이 낸 이유서는 우리 제출이 아님, 번호 없는 '피고인' 서면은 1명일 때만", () => {
  const base = [
    S("2026-11-02", "피고인2 변호인  법무법인 정서 소송기록접수통지서 발송", "2026-11-03"),
    S("2026-11-02", "피고인1  김OO 소송기록접수통지서 발송", "2026-11-03"),
  ];
  const other = computeDeadlines("2026노7", [...base, F("2026-11-10", "피고인1 변호인  김OO 항소이유서 제출")], "2026-11-13");
  assertEquals(other[0].st, "open");
  const unnumbered = computeDeadlines("2026노7", [...base, F("2026-11-10", "피고인(항소인)의 변호인  문OO 항소이유서 제출")], "2026-11-13");
  assertEquals(unnumbered[0].st, "open");
  const mine = computeDeadlines("2026노7", [...base, F("2026-11-10", "피고인2 변호인  법OOOOOO 항소이유서 제출")], "2026-11-13");
  assertEquals(mine[0].st, "done");
  const solo = computeDeadlines("2026노8", [
    S("2026-11-02", "피고인  김OO 소송기록접수통지서 발송", "2026-11-03"),
    F("2026-11-10", "피고인(항소인)의 변호인  문OO 항소이유서 제출"),
  ], "2026-11-13");
  assertEquals(solo[0].st, "done");
});

Deno.test("기산 뒤 공판기일이 열렸으면 보류(2026노9006처럼)", () => {
  const dl = computeDeadlines("2026노9006", [
    S("2026-09-01", "피고인1 변호인  법무법인 정서 소송기록접수통지서 발송", "2026-09-02"),
    { lp_set: "기일", lp_appoint_date: "2026-10-23", lp_contents: "공판기일(본관 325호)", lp_remark: "속행" },
  ], "2026-11-13");
  assertEquals([dl[0].st, dl[0].hold], ["done", "공판기일 진행 10.23"]);
});

Deno.test("상소장접수통지가 우리 쪽에만 → 검사만 상소 경고, 우리 법인 수신 없음 → 경고 (2026노9004)", () => {
  const dl = computeDeadlines("2026노9004", [
    { lp_set: "접수", lp_appoint_date: "2026-10-01", lp_contents: "피고인 김OO 종국 : 선고" },
    F("2026-10-08", "검사  박OO 항소장 제출"),
    S("2026-10-12", "피고인1  김OO 항소장접수통지서 발송", "2026-10-15"),
    S("2026-10-15", "피고인1  김OO 국선변호인선정결정/소송기록접수통지서/항소이유서/피고인소환장 발송", "2026-10-20"),
    S("2026-10-19", "피고인1 변호인  법무법인 정서 소송기록접수통지서/항소이유서/전자소송안내문 발송", "2026-10-21"),
  ], "2026-11-13");
  const r = dl.find((x) => x.kind === "항소이유서")!;
  assertEquals([r.d, r.st, /검사만/.test(r.warn || "")], ["2026-11-09", "open", true]);
  const ans = computeDeadlines("2026노9004", [
    F("2026-10-08", "검사  박OO 항소장 제출"),
    S("2026-10-12", "피고인1  김OO 항소장접수통지서 발송", "2026-10-15"),
    S("2026-10-19", "피고인1 변호인  법무법인 정서 소송기록접수통지서/항소이유서/전자소송안내문 발송", "2026-10-21"),
    F("2026-10-27", "피고인1 변호인  법OOOOOO 항소이유에 대한 답변서 제출"),
  ], "2026-11-13").find((x) => x.kind === "항소이유서")!;
  assertEquals([ans.st, ans.hold], ["done", "검사만 상소 · 답변서 10.27"]);
  const noNotice = computeDeadlines("2026노9004", [
    S("2026-10-19", "피고인1 변호인  법무법인 정서 소송기록접수통지서/항소이유서/전자소송안내문 발송", "2026-10-21"),
    F("2026-10-27", "피고인1 변호인  법OOOOOO 항소이유에 대한 답변서 제출"),
  ], "2026-11-13").find((x) => x.kind === "항소이유서")!;
  assertEquals([noNotice.st, /답변서/.test(noNotice.warn || "")], ["open", true]);
  const r2 = computeDeadlines("2026노9", [S("2026-11-02", "피고인  김OO 소송기록접수통지서 발송", "2026-11-03")], "2026-11-13")[0];
  assertEquals(/우리 법인 수신 기록이 없/.test(r2.warn || ""), true);
});

Deno.test("소속 변호사 개인 이름 송달도 우리 수신 (2026노9005: 피고인2 변호인 양선화 → 피고인2만 우리 의뢰인)", () => {
  const dl = computeDeadlines("2026노9005", [
    S("2026-05-14", "피고인1  정OO 소송기록접수통지서/국선변호인선정고지 발송", "2026-05-18"),
    S("2026-05-19", "피고인2  인OO 소송기록접수통지서 발송", "2026-05-21"),
    S("2026-05-19", "피고인2 변호인  양선화 소송기록접수통지서 발송", "2026-05-21"),
    F("2026-06-05", "변호인  법무법인 갑을 항소이유서 제출"),
  ], "2026-06-01");
  assertEquals([dl[0].d, dl[0].st, dl[0].warn], ["2026-06-10", "open", undefined]);
});
