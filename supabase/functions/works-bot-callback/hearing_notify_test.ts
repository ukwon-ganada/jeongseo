import { assertEquals } from "jsr:@std/assert@1";
import { alreadyInCalendar, noticeMessage } from "./hearing_notify.ts";
import { buildPlan } from "./schedule_cmd.ts";

Deno.test("캘린더에 이미 있나", () => {
  const evs = [{ summary: "(증인)강)공판_임윤선", start: "2027-01-28T14:00:00" }, { summary: "(취소)강)공판_김철수", start: "2027-01-28T10:00:00" }];
  assertEquals(alreadyInCalendar(evs, "임윤선", "14:00"), true);
  assertEquals(alreadyInCalendar(evs, "임윤선", "10:00"), false); // 시각이 다르면 없는 것
  assertEquals(alreadyInCalendar(evs, "김철수", "10:00"), false); // 취소 일정은 없는 것
  assertEquals(alreadyInCalendar([{ summary: "임윤선_항소이유서마감일", start: "2027-01-28" }], "임윤선", "14:00"), true); // 종일 일정
});

Deno.test("알림 글", () => {
  const p = buildPlan({ roomTitle: "강)신)!(형/피고인)임윤선", caseNo: "2026고단1048", client: "임윤선", another: "", court: "인천지방법원", gukseon: false, date: "2027-01-28", time: "14:00", contents: "공판기일(316호법정 14:00)", source: "도우미 알림" });
  const m: any = noticeMessage(p, "2026-12-10 10:00");
  assertEquals(m.contentText.split("\n")[0], "기일 변경 · 전 12.10.(목) 10:00");
  assertEquals(m.contentText.split("\n")[1], "강)공판_임윤선");
  assertEquals((noticeMessage(p, "") as any).contentText.split("\n")[0], "새 기일");
});

import { isPostponed } from "./hearing_notify.ts";
Deno.test("연기·변경 기일 거르기", () => {
  assertEquals(isPostponed("공판기일(316호 법정 14:00)"), false);
  assertEquals(isPostponed("공판기일(316호 법정 14:00) 기일변경"), true);
  assertEquals(isPostponed("변론기일 (연기)"), true);
  assertEquals(isPostponed("선고기일 추정"), true);
});

import { isRehab } from "./hearing_notify.ts";
Deno.test("회생·파산 사건번호", () => {
  for (const c of ["2025하단690", "2026개회10427", "2025개회118243", "2026하단100956"]) if (!isRehab(c)) throw new Error(c);
  for (const c of ["2026가단13347", "2026고단1492", "2026노1748", "2026드단760", "2026카단7915"]) if (isRehab(c)) throw new Error(c);
});
import { isOurResign } from "./hearing_notify.ts";
Deno.test("우리 법인 사임 줄", () => {
  if (!isOurResign("피고인1 변호인  법OOOOOO 변호인 사임신고서 제출")) throw new Error("1");
  if (!isOurResign("피고인2 변호인  법OOOOOO 사임계 제출")) throw new Error("2");
  if (isOurResign("변호인  법무법인 도울 변호인 사임신고서 제출")) throw new Error("3");
  if (isOurResign("피고 소송대리인 법OOOOOOOOOOOOOOOO 소송대리인 사임신고서 제")) throw new Error("4");
  if (isOurResign("원고 소송대리인 문수종소송대리인 사임신고서 제출")) throw new Error("5");
});
Deno.test("회사 표기·외 N명 차이를 넘어 캘린더 짝 찾기 (2026-11-26)", () => {
  const ok = (sum: string, client: string, t: string) => alreadyInCalendar([{ summary: sum, start: "2026-12-10T" + t + ":00+09:00" }], client, t);
  if (!ok("예)변론_(주)라임산업개발/(주)천지플래닛", "주식회사 라임산업개발", "14:00")) throw new Error("라임");
  if (!ok("강)변론_주식회사보은/김종로", "주식회사 보은", "10:00")) throw new Error("보은");
  if (!ok("강)변론_김응구 외 4명/새롬건설(주)", "김응구 外4", "14:20")) throw new Error("김응구");
  if (!ok("(영상)(박)변론_(주)부강이엔지/(주)진성중공업", "주식회사 부강이엔지", "15:50")) throw new Error("부강");
  if (ok("예)변론_(주)진성아이엔디/(주)한올개발 외 1명", "주식회사 엔씨엠 외 1명", "16:00")) throw new Error("엔씨엠");
});
Deno.test("상대방 이름·줄인 조합 이름으로도 짝 찾기 (주안10구역)", () => {
  const evs = [{ summary: "강)변론_주안10구역조합/인천광역시 외 1명", start: "2026-12-15T14:50:00+09:00" }];
  if (!alreadyInCalendar(evs, ["인천광역시 미추홀구", "주안10구역주택재개발정비사업조합"], "14:50")) throw new Error("주안");
  if (alreadyInCalendar(evs, ["김철수"], "14:50")) throw new Error("다른 사람");
  if (alreadyInCalendar(evs, ["인천광역시 미추홀구"], "10:00")) throw new Error("시각");
});
