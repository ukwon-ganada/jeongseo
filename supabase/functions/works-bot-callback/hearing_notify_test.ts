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
