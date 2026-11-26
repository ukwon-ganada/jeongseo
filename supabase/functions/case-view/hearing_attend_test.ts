import { assertEquals } from "jsr:@std/assert@1";
import { applyAttend, attendTitle, cleanAttendBody } from "./hearing_attend.ts";

// 김우석 2026고단1492: 1.14·2.11·3.11 공판 불출석, 4.15 선고만 출석(로웨어에 아직 없음)
function kim() {
  return {
    caseNo: "2026고단1492",
    hearings: [
      { c: "2026고단1492", d: "2027-01-14", tm: "11:00", t: "공판기일", p: "412호법정" },
      { c: "2026고단1492", d: "2027-02-11", tm: "10:30", t: "공판기일", p: "412호법정" },
      { c: "2026고단1492", d: "2027-03-11", tm: "10:30", t: "공판기일", p: "412호법정" },
      { c: "2026고합9", d: "2027-01-20", tm: "10:00", t: "공판기일", p: "" },
    ] as any[],
    events: [
      { d: "2027-01-14", k: "due", g: "hearing", t: "공판기일(412호법정 11:00)", lc: 2958 },
      { d: "2027-02-11", k: "due", g: "hearing", t: "공판기일(412호법정 10:30)", lc: 2958 },
    ] as any[],
  };
}
const rows = [
  { l_num: 2958, hdate: "2027-01-14", attend: false },
  { l_num: 2958, hdate: "2027-02-11", attend: false },
  { l_num: 2958, hdate: "2027-03-11", attend: false },
  { l_num: 2958, hdate: "2027-04-15", attend: true, htime: "14:00", kind: "선고기일", place: "412호법정", source: "방 글" },
  { l_num: 77, hdate: "2027-01-20", attend: false },
];

Deno.test("불출석 기일은 ab, 로웨어에 없는 출석 기일은 더함", () => {
  const s = kim();
  applyAttend(s, rows, 2958, "2026-11-26", new Map([[77, "2026고합9"]]));
  assertEquals(s.hearings.slice(0, 3).map((h) => h.ab), [1, 1, 1]);
  assertEquals(s.hearings[3].ab, 1); // 내 사건 전체의 다른 사건
  const add = s.hearings.find((h) => h.d === "2027-04-15")!;
  assertEquals([add.t, add.tm, add.p, add.at], ["선고기일", "14:00", "412호법정", 1]);
  assertEquals(s.events.filter((e) => e.ab).length, 2);
  assertEquals(s.events.find((e) => e.d === "2027-04-15")?.t, "선고기일(412호법정 14:00)");
});

Deno.test("표시가 없으면 그대로", () => {
  const s = kim();
  applyAttend(s, [], 2958, "2026-11-26");
  assertEquals(s.hearings.some((h) => h.ab || h.at), false);
  assertEquals(s.hearings.length, 4);
});

Deno.test("로웨어에 이미 있는 출석 기일은 더하지 않음", () => {
  const s = kim();
  applyAttend(s, [{ l_num: 2958, hdate: "2027-02-11", attend: true }], 2958, "2026-11-26");
  assertEquals(s.hearings.length, 4);
  assertEquals(s.hearings[1].at, 1);
});

Deno.test("지난 출석 표시는 더하지 않음", () => {
  const s = kim();
  applyAttend(s, [{ l_num: 2958, hdate: "2026-10-01", attend: true }], 2958, "2026-11-26");
  assertEquals(s.hearings.length, 4);
});

Deno.test("값 다듬기", () => {
  assertEquals(cleanAttendBody({ date: "2027-01-14", attend: false, tm: "11:00" })?.attend, false);
  assertEquals(cleanAttendBody({ date: "2027-01-14" })?.attend, null);
  assertEquals(cleanAttendBody({ date: "1월 14일" }), null);
  assertEquals(attendTitle({ l_num: 1, hdate: "2027-04-15", attend: true }), "기일");
});
