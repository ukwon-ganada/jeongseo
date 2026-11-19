import { assertEquals } from "jsr:@std/assert@1";
import { autoStage, diffStages, shapeStages, stageOfNo , prosFromTitle, dispFromEvents } from "./stages.ts";

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
  assertEquals((d.stages.police as any).prev, [{ org: "관악경찰서", no: "2026-1", dept: "", person: "김경위", phone: "02-1", mobile: "", disp: "" }]);
  const s = shapeStages(c, { stages: d.stages }, []);
  assertEquals(s.list[0].prev.length, 1);
  // 직원이 이전 기록을 고치거나 지움, 빈 줄은 버림
  const fixed = diffStages(c, { stages: d.stages }, { police: { org: "인천연수경찰서", no: "2026-77", person: "박경사", phone: "032-1",
    prev: [{ org: "관악경찰서", person: "김경감" }, { org: "", person: "" }] } });
  assertEquals((fixed.stages.police as any).prev.map((x: any) => x.person), ["김경감"]);
});

Deno.test("방 제목에서 공소청 이름·형제번호", () => {
  const f = (t: string) => prosFromTitle(t);
  assertEquals(f("%$(형/고소)이재욱_광주지방검찰청 2026형제29256"), { org: "광주지방검찰청", no: "2026형제29256" });
  assertEquals(f("박)신)★%(형/피의)이준호_마약(향정)_의정부지검 고양지청 2026형제308호"), { org: "의정부지검 고양지청", no: "2026형제308" });
  assertEquals(f("◎%■(형/피의)이선구_사기등_남양주지청2026형제3675"), { org: "남양주지청", no: "2026형제3675" });
  assertEquals(f("서)최)★(형/피의자)이종수_사기_인천공 2026형제68248/대전공2026불제16763"), { org: "인천공", no: "2026형제68248" });
  assertEquals(f("서)최)!(형/피의)이선호_스토킹_인천지2026형제64473/잠정"), { org: "", no: "2026형제64473" });
  assertEquals(f("우)%(형/고소)함성은_사기_대구지방공소청 포항지청_2026형제8367"), { org: "대구지방공소청 포항지청", no: "2026형제8367" });
  assertEquals(f("(형/고소)홍길동_사기"), null);
  const c = { l_code: "2025이재욱", is_inv: false, raw: { l_police_station: "파주경찰서" } };
  const t = "%$(형/고소)이재욱_광주지방검찰청 2026형제29256";
  const s = shapeStages(c, null, [], t);
  assertEquals([s.cur, s.list[1].org, s.list[1].no, s.list[0].org], ["pros", "광주지방검찰청", "2026형제29256", "파주경찰서"]);
  const saved = { cur_stage: "police", stages: { police: { org: "파주경찰서/수사6팀", person: "임대우" } } };
  const s2 = shapeStages(c, saved, [], t);
  assertEquals([s2.cur, s2.list[1].no], ["police", "2026형제29256"]);
});

Deno.test("제목 형제번호가 로웨어와 다르면 제목이 지금 번호, 로웨어 번호는 이전 기록", () => {
  const c = { l_code: "2025형제39945", is_inv: false, raw: { l_prosecute: "인천지방검찰청" } };
  const s = shapeStages(c, null, [], "★(형/고소)이름_횡령등_수원지검 성남지청 2026형제10878");
  const p = s.list[1];
  assertEquals([s.cur, p.org, p.no, p.prev.map((x: any) => x.org + " " + x.no)], ["pros", "수원지검 성남지청", "2026형제10878", ["인천지방검찰청 2025형제39945"]]);
  const same = shapeStages({ l_code: "2026형제69612", raw: { l_prosecute: "인천지방검찰청" } }, null, [], "_인천지방공소청 2026형제69612");
  assertEquals([same.list[1].org, same.list[1].prev.length], ["인천지방검찰청", 0]);
});

Deno.test("처분 줄 → 죄명별 처분, 일부 송치면 경찰·공소청 둘 다 진행 중", () => {
  const f = (summary: string, kind = "처분") => dispFromEvents([{ kind, ev_date: "2026-08-20", summary }]);
  assertEquals(f("사기 송치, 모욕 불송치 확인").police, "사기 송치 · 모욕 불송치");
  assertEquals(f("송치(최아름)·불송치(한용탁) 확인", "송치").police, "최아름 송치 · 한용탁 불송치");
  assertEquals(f("사기 사건 구약식 처분").pros, "사기 약식기소");
  assertEquals(f("인천지방공소청 혐의없음(증거불충분) 불기소 처분").pros, "불기소");
  assertEquals(f("추가 사건 불구속 구공판(기소) 확인").pros, "기소");
  assertEquals(f("무고 피의사건 각하 통지 수령 (인천논현경찰서)").police, "무고 각하");
  assertEquals(f("업무상횡령 사건 검찰 송치", "송치").police, "업무상횡령 송치");
  assertEquals(f("춘천지검 원주지청 송치 확인 및 킥스 등록", "송치").police, "송치");
  assertEquals(f("불송치이유서 정보공개청구", "처분").police, "");
  assertEquals(f("약식명령 결정 (청구마감 9.16.)").pros, "");
  // 경찰 처분은 가장 최근 날짜만
  const two = dispFromEvents([
    { kind: "처분", ev_date: "2026-06-04", summary: "불송치 통지서 수령" },
    { kind: "송치", ev_date: "2026-07-10", summary: "이의신청으로 인천지검 송치" },
  ]);
  assertEquals(two.police, "송치");
  const c = { l_code: "2025이재욱", is_inv: false, raw: { l_police_station: "파주경찰서" } };
  const saved = { cur_stage: "police", stages: { police: { org: "파주경찰서/수사6팀", person: "임대우" } } };
  const s = shapeStages(c, saved, [], "%$(형/고소)이재욱_광주지방검찰청 2026형제29256", [{ kind: "처분", ev_date: "2026-08-20", summary: "사기 송치, 모욕 불송치 확인" }]);
  assertEquals([s.cur, s.act, s.list[0].disp, s.list[0].dispAuto], ["police", ["police", "pros"], "사기 송치 · 모욕 불송치", "사기 송치 · 모욕 불송치"]);
  assertEquals(s.dispNo, "2026형제29256");
  const s2 = shapeStages(c, { ...saved, stages: { police: { org: "파주경찰서", disp: "사기 송치" } } }, [], "", [{ kind: "처분", ev_date: "2026-08-20", summary: "사기 송치, 모욕 불송치 확인" }]);
  assertEquals([s2.list[0].disp, s2.act], ["사기 송치", []]);
});
