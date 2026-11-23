import { assertEquals } from "jsr:@std/assert@1";
import { applyWitness, witnessDates, witnessMap } from "./witness.ts";

const LOG = "2026.08.31    공판기일(제318호 법정 15:00)    \n2026.08.31    - - 검사 정OO    \n2026.08.31    - - 피고인 박OO    \n2026.08.31    - - 증인 안OO\n===\n2026.11.02    공판기일(제318호 법정 10:10)    \n2026.11.02    - - 검사 정OO    \n";
const H = (d: string, r = "") => ({ lp_set: "기일", lp_appoint_date: d, lp_contents: "공판기일(제318호 법정 10:00)", lp_remark: r });
const S = (d: string) => ({ lp_set: "송달", lp_appoint_date: d, lp_contents: "증인  이OO 증인소환장/형사사건증인을위한안내 발송" });

Deno.test("기일 참석자에 증인이 있으면 확정", () => {
  assertEquals([...witnessDates(LOG)], ["2026-08-31"]);
  const m = witnessMap([H("2026-08-31", "속행"), H("2026-11-02", "속행")], LOG);
  assertEquals([...m], [["2026-08-31", "확정"]]);
});

Deno.test("확정 근거 없으면 소환장 뒤 처음 열린 공판기일을 추정, 변경된 기일은 건너뜀", () => {
  const evs = [S("2026-09-10"), H("2026-10-01", "기일변경"), H("2026-10-15", "속행"), H("2026-11-20", "속행"), S("2026-01-01"), H("2026-06-01", "속행")];
  assertEquals([...witnessMap(evs, "")], [["2026-10-15", "추정"]]);
});

Deno.test("타임라인·기일 탭 줄에 wit 칸만 붙이고 제목은 그대로", () => {
  const shaped: any = { caseNo: "2026고단1", events: [{ d: "2026-08-31", g: "hearing", t: "출석 공판기일(제318호 법정 15:00) · 속행" }, { d: "2026-08-31", g: "ours", t: "증인신문사항 제출" }],
    hearings: [{ c: "2026고단1", d: "2026-08-31", t: "공판기일 (속행)" }, { c: "2026고단9", d: "2026-08-31", t: "공판기일" }] };
  applyWitness(shaped, [H("2026-08-31", "속행")], LOG);
  assertEquals(shaped.events.map((e: any) => e.wit), ["확정", undefined]);
  assertEquals(shaped.events[0].t, "출석 공판기일(제318호 법정 15:00) · 속행");
  assertEquals(shaped.hearings.map((h: any) => h.wit), ["확정", undefined]);
});
