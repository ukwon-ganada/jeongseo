import { assertEquals } from "jsr:@std/assert@1";
import { checkSave, eventBody } from "./sched_save.ts";
Deno.test("checkSave 기본 끝 시각 1시간", () => {
  const o = checkSave({ summary: "강)공판_임윤선", date: "2027-01-28", start: "14:00", lawyer: "강현구" }) as any;
  assertEquals(o.end, "15:00");
  assertEquals(eventBody(o).eventComponents[0].start, { dateTime: "2027-01-28T14:00:00", timeZone: "Asia/Seoul" });
});
Deno.test("checkSave 틀린 값", () => {
  assertEquals(checkSave({ summary: "", date: "2027-01-28", start: "14:00", lawyer: "x" }), "제목이 비었습니다");
  assertEquals(checkSave({ summary: "a", date: "2027-1-2", start: "14:00", lawyer: "x" }), "날짜가 잘못됐습니다");
  assertEquals(checkSave({ summary: "a", date: "2027-01-02", start: "14:00", end: "13:00", lawyer: "x" }), "끝 시각이 잘못됐습니다");
  assertEquals(checkSave({ summary: "a", date: "2027-01-02", start: "14:00", lawyer: "" }), "캘린더(변호사)를 골라 주세요");
});
