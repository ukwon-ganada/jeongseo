import { assertEquals } from "jsr:@std/assert@1";
import { overlayScourt, setOf } from "./scourt_overlay.ts";

const LW = [
  { lp_num: 1, lp_set: "기일", lp_appoint_date: "2026-12-17", lp_contents: "심리기일(제204호 법정 16:00)", lp_remark: null, delivered_date: null },
  { lp_num: 2, lp_set: "송달", lp_appoint_date: "2026-11-06", lp_contents: "보호자  조OO 심리기일소환장 발송", lp_remark: null, delivered_date: null },
  { lp_num: 3, lp_set: "송달", lp_appoint_date: "2026-10-19", lp_contents: "피고인1 변호인  법무법인 정서 소송기록접수통지서 발송", lp_remark: "2026.10.21 송달됨", delivered_date: "2026-10-21" },
];

Deno.test("원문 없으면 그대로", () => {
  assertEquals(overlayScourt(LW, []), LW);
});

Deno.test("기일 결과·송달 결과를 원문으로, 같은 값은 그대로", () => {
  const out = overlayScourt(LW, [
    { ev_date: "2026-12-17", content: "심리기일(제204호 법정 16:00)", result: "기일변경", result_date: null },
    { ev_date: "2026-12-17", content: "- 보호소년 김OO", result: null, result_date: null },
    { ev_date: "2026-11-06", content: "보호자 조OO 심리기일소환장 발송", result: "2026.11.16 폐문부재", result_date: "2026-11-16" },
    { ev_date: "2026-10-19", content: "피고인1 변호인 법무법인 정서 소송기록접수통지서 발송", result: "2026.10.21 송달됨", result_date: "2026-10-21" },
  ]);
  assertEquals(out.length, 3);
  assertEquals(out[0].lp_remark, "기일변경");
  assertEquals(out[1].lp_remark, "2026.11.16 폐문부재");
  assertEquals(out[1].delivered_date, null);
  assertEquals(out[2], LW[2]);
});

Deno.test("원문에만 있는 줄은 더한다(송달 도달일 포함), 가림 차이 줄은 더하지 않는다", () => {
  const out = overlayScourt(LW, [
    { ev_date: "2026-11-13", content: "기일변경명령", result: null, result_date: null },
    { ev_date: "2026-11-15", content: "보호자 조OO 기일변경명령발송", result: "2026.11.19송달됨", result_date: "2026-11-19" },
    { ev_date: "2026-10-19", content: "피고인1 변호인 법OOOOOO 소송기록접수통지서 발송", result: "2026.10.21 송달됨", result_date: "2026-10-21" },
  ]);
  const add = out.filter((e) => e.scAdded);
  assertEquals(add.map((e) => [e.lp_set, e.lp_appoint_date, e.delivered_date]), [["명령", "2026-11-13", null], ["송달", "2026-11-15", "2026-11-19"]]);
});

Deno.test("구분 짐작", () => {
  assertEquals(setOf("공판기일(본관 325호 법정 15:40)"), "기일");
  assertEquals(setOf("변호인 법무법인 정서 변호인선임계 제출"), "서면");
  assertEquals(setOf("사건접수"), "접수");
  assertEquals(setOf("(피고인 천OO) 피고인 국선변호인선정결정"), "명령");
});

Deno.test("로웨어 결과가 더 자세하면 그대로, 같은 내용 두 줄은 결과로 짝짓기", () => {
  const lw = [
    { lp_num: 1, lp_set: "기일", lp_appoint_date: "2026-11-11", lp_contents: "판결선고기일(311호 법정 14:00)", lp_remark: "판결선고 2026-11-12 도달" },
    { lp_num: 2, lp_set: "송달", lp_appoint_date: "2024-10-24", lp_contents: "원고 박OO에게 준비서면부본 송달", lp_remark: "2024.10.25 도달", delivered_date: "2024-10-25" },
    { lp_num: 3, lp_set: "송달", lp_appoint_date: "2024-10-24", lp_contents: "원고 박OO에게 준비서면부본 송달", lp_remark: "2024.10.30 도달", delivered_date: "2024-10-30" },
  ];
  const out = overlayScourt(lw, [
    { ev_date: "2026-11-11", content: "판결선고기일(311호 법정 14:00)", result: "판결선고", result_date: null },
    { ev_date: "2024-10-24", content: "원고 박OO에게 준비서면부본 송달", result: "2024.10.30 도달", result_date: "2024-10-30" },
    { ev_date: "2024-10-24", content: "원고 박OO에게 준비서면부본 송달", result: "2024.10.25 도달", result_date: "2024-10-25" },
  ]);
  assertEquals(out, lw);
});

Deno.test("추정기일 표기가 붙은 기일 줄도 같은 줄로 보고 결과만 채운다", () => {
  const lw = [{ lp_num: 1, lp_set: "기일", lp_appoint_date: "2026-04-10", lp_contents: "변론기일(제405호 법정 14:10)", lp_remark: null }];
  const out = overlayScourt(lw, [{ ev_date: "2026-04-10", content: "변론기일(제405호 법정 14:10) 추정기일(추정사유:감정을 위하여)", result: "속행", result_date: null }]);
  assertEquals(out.length, 1);
  assertEquals(out[0].lp_remark, "속행");
  const lw2 = [{ lp_num: 2, lp_set: "기일", lp_appoint_date: "2026-06-05", lp_contents: "조정기일(조정실1108호 (11층) 13:30)", lp_remark: "기일변경" }];
  assertEquals(overlayScourt(lw2, [{ ev_date: "2026-06-05", content: "조정기일(조정실1108호 (11층) 13:30) 추정기일(추정사유:조정하지 아니하는 결정을 위하여) [일방 화상장치]", result: "기일변경", result_date: null }]), lw2);
});
