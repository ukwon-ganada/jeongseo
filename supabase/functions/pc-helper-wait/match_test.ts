// 실행: deno test supabase/functions/pc-helper-wait/match_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { caseNos, clientName, headerText, matchRoom, sameClient } from "./match.ts";

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

Deno.test("의뢰인 이름이 다른 방은 제목이 닮아도 열지 않는다", () => {
  const rooms = [
    { channel_id: "kim", room_title: "박)신)★(형/고소)김가나_사기_인천연수경찰서_2026-8730" },
    { channel_id: "lee", room_title: "서)최)★(형/피고인)이다라_전기통신금융사기피해방지 등_인천 26노100808" },
  ];
  const line = (t: string) => [{ x: 28, y: 7, t }];
  assertEquals(matchRoom(line("서)최)!(형/피의) 최마바-사기-인천연수경찰서 2026-5079 10"), rooms).channelId, null);
  // OCR이 이름 한 글자를 틀려도 같은 사람으로 본다
  assertEquals(matchRoom(line("서)최)*(형/피고인)이다러-전기통신금융사기피해방지 등- 인천"), rooms).channelId, "lee");
  assertEquals(clientName("(국선)(형/피고인3)백가나_도박_인천"), "백가나");
  assertEquals(sameClient("최마바", "김가나"), false);
});

Deno.test("nearRooms: 제목이 바뀐 방(옛 제목 저장)도 후보 맨 앞에 온다", async () => {
  const { nearRooms, matchRoom } = await import("./match.ts");
  const rooms = [
    { channel_id: "A", room_title: "서)신)★(형/피)박큰별_사기_부천지원 2025고단1888(병합 2026고단101287)" },
    { channel_id: "B", room_title: "박)신)★(형/피의)손용구_사기_고양경찰서 2026-9316" },
    { channel_id: "C", room_title: "서)최)★(형/피고인)이승원_상해_인천지방법원 2026고단101290" },
  ];
  const lines = [{ x: 30, y: 5, t: "*` 서)신)*(형/피)박큰별-사기-인천지방법원2026노101087 12" }];
  const m = matchRoom(lines, rooms);
  if (m.channelId) throw new Error("옛 제목으로는 못 찾아야 함");
  const near = nearRooms(lines, rooms);
  if (near[0] !== "A" || near.includes("B")) throw new Error("후보 " + near.join(","));
  const m2 = matchRoom(lines, [{ channel_id: "A", room_title: "서)신)★(형/피)박큰별_사기_인천지방법원2026노101087" }, rooms[1], rooms[2]]);
  if (m2.channelId !== "A") throw new Error("새 제목으로는 찾아야 함 " + m2.how);
});
