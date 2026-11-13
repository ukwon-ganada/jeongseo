// 실행: deno test supabase/functions/meet-sync/meet_test.ts
import { buildIndex, clientNames, kstStart, matchCase, parseMeet } from "./meet.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

Deno.test("제목 읽기", () => {
  let p = parseMeet("접견_김도현, 박찬욱,박병진(인천)")!;
  assert(p.names.join() === "김도현,박찬욱,박병진" && p.place === "인천" && !p.canceled, JSON.stringify(p));
  p = parseMeet("접견_국선 심명진,김민혁,김태율(인천)")!;
  assert(p.names.join() === "심명진,김민혁,김태율", JSON.stringify(p));
  p = parseMeet("접견_국선강현우(합의)")!;
  assert(p.names.join() === "강현우" && p.place === "합의", JSON.stringify(p));
  p = parseMeet("접견_국선조영진,국선김산")!;
  assert(p.names.join() === "조영진,김산" && p.place === "", JSON.stringify(p));
  assert(parseMeet("(취소)접견_박태민.이준호(수원)")!.canceled, "취소");
  p = parseMeet("접견_(이송취소)박큰별(화상)")!;
  assert(p.canceled && p.names.join() === "박큰별", JSON.stringify(p));
  assert(parseMeet("변론기일") === null, "접견 아님");
});

Deno.test("의뢰인 이름·맞추기", () => {
  assert(clientNames("홍길동, 김철수 (아버지(대리))").join() === "홍길동,김철수", clientNames("홍길동, 김철수 (아버지(대리))").join());
  assert(clientNames("홍길동 外9").join() === "홍길동", "외");
  const cases = [
    { l_num: 1, client: "홍길동", lawyer: "서고은" },
    { l_num: 2, client: "김철수", lawyer: "이예나" },
    { l_num: 3, client: "김철수", lawyer: "서고은,양선화" },
    { l_num: 4, client: "이영희", lawyer: "이예나" },
    { l_num: 5, client: "이영희", lawyer: "이예나" },
  ];
  const ix = buildIndex(cases);
  assert(matchCase("홍길동", "박종덕", cases, ix) === 1, "하나뿐");
  assert(matchCase("김철수", "서고은", cases, ix) === 3, "같은 이름이면 일정 주인 담당 사건");
  assert(matchCase("이영희", "이예나", cases, ix) === null, "그래도 여럿이면 안 붙임");
  assert(matchCase("없는이", "서고은", cases, ix) === null, "없음");
});

Deno.test("시각", () => {
  assert(kstStart({ dateTime: "2026-11-13T14:00:00", timeZone: "Asia/Seoul" })!.time === "14:00", "현지");
  assert(kstStart({ dateTime: "2026-11-13T05:00:00Z" })!.time === "14:00", "UTC");
  assert(kstStart({ date: "2026-11-13" })!.time === "", "종일");
});
