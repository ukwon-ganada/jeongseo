import { assertEquals } from "jsr:@std/assert@1";
import { fillHearingResults, logResults } from "./hearing_result.ts";

const LOG = `[2026-11-23 13:15:35]
@@DEFENDANTS:김OO
2026.12.17    심리기일(제204호 법정 16:00)    
2026.12.17    - 보호소년 김OO    
===
[2026-11-25 09:39:35]
@@DEFENDANTS:김OO
2026.12.17    심리기일(제204호 법정 16:00)    기일변경
2026.12.17    - 보호소년 김OO    
2027.01.14    심리기일(제204호 법정 16:00)    
2027.01.14    - 보호자 조OO    
===`;

Deno.test("기일 정보: 마지막으로 받은 것 기준, 참석자 줄 제외", () => {
  assertEquals(logResults(LOG), [
    { d: "2026-12-17", t: "심리기일(제204호 법정 16:00)", r: "기일변경" },
    { d: "2027-01-14", t: "심리기일(제204호 법정 16:00)", r: "" },
  ]);
});

Deno.test("빈 기일 결과만 채움 (2026푸104128)", () => {
  const evs = [
    { lp_set: "기일", lp_appoint_date: "2026-12-17", lp_contents: "심리기일(제204호 법정 16:00)", lp_remark: null },
    { lp_set: "기일", lp_appoint_date: "2027-01-14", lp_contents: "심리기일(제204호 법정 16:00)", lp_remark: null },
    { lp_set: "명령", lp_appoint_date: "2026-11-13", lp_contents: "기일변경명령", lp_remark: null },
  ];
  const out = fillHearingResults(evs, LOG);
  assertEquals(out.map((e) => e.lp_remark), ["기일변경", null, null]);
  assertEquals(evs[0].lp_remark, null);
});

Deno.test("이미 있는 결과는 그대로", () => {
  const evs = [{ lp_set: "기일", lp_appoint_date: "2026-12-17", lp_contents: "심리기일(제204호 법정 16:00)", lp_remark: "속행" }];
  assertEquals(fillHearingResults(evs, LOG)[0].lp_remark, "속행");
});
