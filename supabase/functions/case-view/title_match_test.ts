import { assertEquals } from "jsr:@std/assert@1";
import { findPick, normTitle } from "./title_match.ts";

// 이름은 가짜. 한 번 고른 방 제목을 기억했다가, 창 폭이 달라 잘린 정도가 달라도 찾는다
const picks = [
  { header_norm: normTitle("서)박)신!(형/피고인7)홍길동-폭처법위반(공동강요)-인천지방법원 2026고합28"), l_num: 1, case_no: "2026고합285" },
  { header_norm: normTitle("서)신)㉧(형/고소)김철수-사기 등-인천남동경찰서"), l_num: 2, case_no: "2026고단1" },
];

Deno.test("기억한 제목: 더 잘리거나 덜 잘려도 같은 사건", () => {
  assertEquals(findPick("서)박)신!(형/피고인7)홍길동-폭처법위반(공동강요)-인천 20", picks)?.l_num, 1);
  assertEquals(findPick("80t 서)박)신!(형/피고인7)홍길동-폭처법위반(공동강요)-인천지방법원 2026고합285", picks)?.l_num, 1);
  assertEquals(findPick("* 서)신)㉧(형/고소)김철수-사기 등-인천남동경찰서", picks)?.l_num, 2);
});

Deno.test("다른 방이면 고르지 않는다", () => {
  assertEquals(findPick("서)최)*(형/피고인)이영희-특수협박등-인천지방법원-2026고단103412", picks), null);
  assertEquals(findPick("짧음", picks), null);
});
