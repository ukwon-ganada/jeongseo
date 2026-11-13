// 실행: deno test supabase/functions/meet-sync/meet_test.ts
import { buildIndex, clientNames, kstStart, matchCase, normCaseNo, parseMeet } from "./meet.ts";
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

Deno.test("피고인 목록·사건번호", () => {
  const cases = [{ l_num: 7, client: "아버지", lawyer: "서고은", extra: ["김아들"] }];
  assert(matchCase("김아들", "서고은", cases, buildIndex(cases)) === 7, "피고인 목록으로 맞춤");
  assert(normCaseNo("26고단 0123") === "2026고단123" && normCaseNo("2026고단123") === "2026고단123", normCaseNo("26고단 0123"));
});

Deno.test("같은 사람 1심·항소심", () => {
  const cases = [
    { l_num: 1, client: "박명근", lawyer: "서고은", accept: "2026-03-01" },
    { l_num: 2, client: "박명근", lawyer: "서고은", accept: "2026-09-10" },
  ];
  const ix = buildIndex(cases);
  assert(matchCase("박명근", "서고은", cases, ix, "2026-11-10") === 2, "접견일 전 가장 최근 선임 사건");
  assert(matchCase("박명근", "서고은", cases, ix, "2026-05-01") === 1, "그 전이면 1심");
  assert(matchCase("박명근", "서고은", cases, ix, "2026-01-01") === null, "선임 전이면 안 붙임");
});
