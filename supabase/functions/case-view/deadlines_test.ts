import { assertEquals } from "jsr:@std/assert@1";
import { computeDeadlines, dueDate } from "./deadlines.ts";

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
