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
