import { assertEquals } from "jsr:@std/assert@1";
import { buildLevels, lvByDate, shortNo } from "./levels.ts";

Deno.test("심급 묶기: 1심 본·병합 + 2심", () => {
  const L = buildLevels([
    { code: "2026노101087", evs: [{ lp_appoint_date: "2026-11-17", lp_contents: "사건접수" }] },
    { code: "2026고단101287", evs: [{ lp_appoint_date: "2026-07-01", lp_contents: "공소장 접수" }] },
    { code: "2025고단1888", evs: [{ lp_appoint_date: "2025-12-01", lp_contents: "공소장 접수" }, { lp_appoint_date: "2026-08-27", lp_contents: "피고인 병합심리결정" }] },
  ]);
  assertEquals(L.map((x) => [x.lv, x.label, x.main, x.cases, x.merged, x.start]), [
    [1, "1심", "2025고단1888", ["2025고단1888", "2026고단101287"], ["2026고단101287"], "2025-12-01"],
    [2, "2심", "2026노101087", ["2026노101087"], [], "2026-11-17"],
  ]);
  assertEquals(lvByDate(L, "2026-11-03"), 1);
  assertEquals(lvByDate(L, "2026-11-17"), 2);
  assertEquals(lvByDate(L, "2020-01-01"), 1);
  assertEquals(shortNo("2026고단101287"), "101287");
});
