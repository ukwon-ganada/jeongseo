// 실행: deno test supabase/functions/pc-helper-wait/match_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { caseNos, headerText, matchRoom } from "./match.ts";

// 2026-11-13 사무실 PC 시험 결과 모양(이름은 가짜)
const LINES = [
  { x: 96, y: 1, t: "0 X" },
  { x: 7, y: 3, t: "Q 에시지 검색" },
  { x: 6, y: 7, t: "전체• 내 담당" },
  { x: 9, y: 15, t: "•(형)김갑동-사기" },          // 왼쪽 방 목록
  { x: 28, y: 7, t: "*` 서)신)◎(형/피의)홍길동-성폭력특례법위반(카좔)-부천지원 2026고정100189" }, // 열린 방 제목
  { x: 33, y: 10, t: "9" },
  { x: 30, y: 14, t: "(사진)" },                   // 대화 내용
];
const ROOMS = [
  { channel_id: "A", room_title: "서)신)◎(형/피의)홍길동-성폭력특례법위반(카촬)-부천지원 2026고정100189" },
  { channel_id: "B", room_title: "(형)김갑동-사기-서울중앙 2026고단1234" },
  { channel_id: "C", room_title: "(민)을지문덕-대여금" },
];

Deno.test("방 제목 줄만 고른다(왼쪽 목록·대화 내용 제외)", () => {
  const h = headerText(LINES);
  assertEquals(h.includes("홍길동"), true);
  assertEquals(h.includes("김갑동"), false);
  assertEquals(h.includes("사진"), false);
});

Deno.test("사건번호로 찾기", () => {
  const m = matchRoom(LINES, ROOMS);
  assertEquals([m.channelId, m.how], ["A", "case-no"]);
});

Deno.test("사건번호 없는 방은 제목 닮은 정도로", () => {
  const m = matchRoom([{ x: 30, y: 6, t: "(민)을지문덕-대여금" }], ROOMS);
  assertEquals([m.channelId, m.how], ["C", "title"]);
});

Deno.test("애매하거나 못 읽으면 고르지 않는다", () => {
  assertEquals(matchRoom([{ x: 30, y: 6, t: "전혀 다른 방 이름입니다" }], ROOMS).channelId, null);
  assertEquals(matchRoom([{ x: 5, y: 6, t: "(민)을지문덕-대여금" }], ROOMS).how, "no-header");
  const twins = [{ channel_id: "X", room_title: "(형)홍길동-사기" }, { channel_id: "Y", room_title: "(형)홍길동-사기 " }];
  assertEquals(matchRoom([{ x: 30, y: 6, t: "(형)홍길동-사기" }], twins).channelId, null);
});

Deno.test("OCR이 0을 O로 읽어도 사건번호 인식", () => {
  assertEquals(caseNos("2026고정1OO189"), ["2026고정100189"]);
});

// 2026-11-16 석원: 창이 좁아 제목 뒤(사건번호)가 잘려도 앞부분으로 방을 찾아야 한다 (이름은 가짜)
Deno.test("뒤가 잘린 제목도 앞부분으로 찾는다(앞 잡글자 무시)", () => {
  const rooms = [
    { channel_id: "P", room_title: "서)신)★(형/항/피)홍길동_특가법위반(향정)_서울고등법원(인천) 2026노100072" },
    { channel_id: "Q", room_title: "서)최)★(형/피고인)김철수_사기_인천지방법원 2026고단1234" },
    { channel_id: "R", room_title: "서)신)★(형/피의)이영희_사기_인천지방검찰청 2026형제1" },
  ];
  for (const t of ["80t 서)신)*(형/항/피)홍길둥-특가법위반(항정)-서물고등법원(.", "장 69b 80t * 서)신)*(형/항/피)홍길동-특가법위반(항정)"]) {
    const m = matchRoom([{ x: 30, y: 6, t }], rooms);
    assertEquals([m.channelId, m.how], ["P", "title"]);
  }
});

Deno.test("앞부분이 같은 방이 둘 이상이면 고르지 않는다", () => {
  const rooms = [
    { channel_id: "A", room_title: "신)△(형/피의)홍길동_사기_경기남부경찰청" },
    { channel_id: "B", room_title: "신)△(형/피의)홍길동_사기_안양지청 2026형제12815" },
  ];
  assertEquals(matchRoom([{ x: 30, y: 6, t: "신)△(형/피의)홍길동-사기-" }], rooms).channelId, null);
});
