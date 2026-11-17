import { assertEquals } from "jsr:@std/assert@1";
import { autoStage, diffStages, shapeStages, stageOfNo } from "./stages.ts";

Deno.test("사건번호 모양으로 단계", () => {
  assertEquals(stageOfNo("2026형제70122"), "pros");
  assertEquals(stageOfNo("2026고단103412"), "c1");
  assertEquals(stageOfNo("2026고합285"), "c1");
  assertEquals(stageOfNo("2026노462"), "c2");
  assertEquals(stageOfNo("2026도17166"), "c3");
  assertEquals(stageOfNo("2026-9450"), "");
  assertEquals(stageOfNo("2026초기1009"), "");
});

Deno.test("수사 사건: 경찰서면 경찰, 형제번호면 공소청", () => {
  const pol = { is_inv: true, l_code: "수사-100001", raw: { l_police_station: "관악경찰서", agency_no: "2026-6419" } };
  const pro = { is_inv: true, l_code: "수사-100059", raw: { l_police_station: "인천지방공소청", agency_no: "2026형제70122" } };
  assertEquals(autoStage(pol), "police");
  assertEquals(autoStage(pro), "pros");
  const s = shapeStages(pro, null, []);
  assertEquals(s.cur, "pros");
  assertEquals(s.start, "pros");
  assertEquals(s.dispNo, "2026형제70122");
  const p = shapeStages(pol, null, []);
  assertEquals(p.dispNo, "2026-6419");
});

Deno.test("로웨어 1심 사건: 경찰 정보가 있으면 경찰부터, 대표번호는 재판번호, 이전 번호 남김", () => {
  const c = { l_code: "2026고단1151", court: "인천지방법원", raw: { l_police_station: "남동경찰서", l_justice_dept: "형사5단독 (전화:032-860-1234)" } };
  const saved = { stages: { pros: { no: "2026형제111", org: "인천지방공소청" } } };
  const s = shapeStages(c, saved, []);
  assertEquals(s.cur, "c1");
  assertEquals(s.start, "police");
  assertEquals(s.dispNo, "2026고단1151");
  assertEquals(s.prevNos.map((x) => x.no), ["2026형제111"]);
  const c1 = s.list.find((x: any) => x.key === "c1")!;
  assertEquals([c1.dept, c1.phone], ["형사5단독", "032-860-1234"]);
});

Deno.test("직원이 고른 단계가 우선, 수사관 변경은 이력으로", () => {
  const c = { is_inv: true, l_code: "수사-1", raw: { l_police_station: "관악경찰서", agency_no: "2026-1" } };
  const saved = { stages: { police: { org: "관악경찰서", person: "김경위" } }, cur_stage: "pros", start_stage: "police" };
  const d = diffStages(c, saved, { police: { org: "관악경찰서", person: "박경사" }, pros: { no: "2026형제5" } });
  assertEquals(d.changes.map((x) => x.field), ["stage.police.person", "stage.pros.no"]);
  const s = shapeStages(c, { ...saved, stages: d.stages }, [{ field: "stage.police.person", old_value: "김경위", new_value: "박경사", editor: "석원", edited_at: "2026-11-16T04:00:00Z" }]);
  assertEquals(s.cur, "pros");
  assertEquals(s.dispNo, "2026형제5");
  assertEquals(s.hist["police.person"][0].o, "김경위");
});

Deno.test("이송·수사관 변경: 바뀌기 전 모습이 이전 기록으로, 이전 기록도 고칠 수 있음", () => {
  const c = { is_inv: true, l_code: "수사-1", raw: { l_police_station: "관악경찰서", agency_no: "2026-1" } };
  const saved = { stages: { police: { org: "관악경찰서", no: "2026-1", person: "김경위", phone: "02-1" } } };
  // 전화만 고친 것은 이전 기록 아님
  let d = diffStages(c, saved, { police: { org: "관악경찰서", no: "2026-1", person: "김경위", phone: "02-2" } });
  assertEquals((d.stages.police as any).prev, undefined);
  // 이송: 경찰서가 바뀌면 이전 모습이 남음
  d = diffStages(c, saved, { police: { org: "인천연수경찰서", no: "2026-77", person: "박경사", phone: "032-1" } });
  assertEquals((d.stages.police as any).prev, [{ org: "관악경찰서", no: "2026-1", dept: "", person: "김경위", phone: "02-1" }]);
  const s = shapeStages(c, { stages: d.stages }, []);
  assertEquals(s.list[0].prev.length, 1);
  // 직원이 이전 기록을 고치거나 지움, 빈 줄은 버림
  const fixed = diffStages(c, { stages: d.stages }, { police: { org: "인천연수경찰서", no: "2026-77", person: "박경사", phone: "032-1",
    prev: [{ org: "관악경찰서", person: "김경감" }, { org: "", person: "" }] } });
  assertEquals((fixed.stages.police as any).prev.map((x: any) => x.person), ["김경감"]);
});
