// 실행: deno test supabase/functions/case-view/shape_test.ts
import { caseNoVariants, infoFields, mergeMeets, shapeCase, smsGist } from "./handler.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

Deno.test("사건번호 후보", () => {
  const v = caseNoVariants("26고단01234");
  assert(v.includes("2026고단1234") && v.includes("26고단1234"), v.join());
  assert(caseNoVariants("2025-0000")[0] === "2025-0000", "모양 다른 번호는 그대로");
});

Deno.test("화면 모양", () => {
  const c = { l_num: 1, l_code: "2026고단1234", l_name: "[전자]사기", court: "인천지방법원", state: "진행", next_date: "2026-12-08", next_time: "14:00", next_contents: "공판기일",
    raw: { l_justice_dept: "형사3단독", l_client: "김OO", l_client_hp: "010", l_client_rrn: "비밀", l_police_station: "", l_accept_date: "2026-10-01", l_judgment_date: "2026-12-20" } };
  const evs = [
    { lp_num: 1, lp_set: "기일", lp_appoint_date: "2026-11-10", lp_appoint_time: "10:30", lp_contents: "공판기일(411호 법정 10:30)", lp_remark: "속행", last_seen_at: "2026-11-12T00:31:00Z" },
    { lp_num: 2, lp_set: "서면", lp_appoint_date: "2026-11-05", lp_contents: "피고인 변호인 법무법인 정서 의견서 제출" },
    { lp_num: 3, lp_set: "송달", lp_appoint_date: "2026-11-01", lp_contents: "피고인2 이OO 공소장 발송" },
    { lp_num: 4, lp_set: "송달", lp_appoint_date: "2026-11-02", lp_contents: "변호인 법무법인 정서 기일통지서 발송", delivered_date: "2026-11-04" },
    { lp_num: 6, lp_set: "서면", lp_appoint_date: "2026-11-06", lp_contents: "원고 소송대리인 박혁 보정서 제출" },
    { lp_num: 5, lp_set: "문자", lp_appoint_date: "2026-11-03", lp_contents: "[SMS] 안내" },
  ];
  const d = shapeCase(c, evs, { today: "2026-11-12", linked: ["2025고단9"], myHearings: [{ c: "2026노1", d: "2026-11-20", tm: "10:00", t: "공판", p: "" }], status: "대상" });
  assert(d.title === "사기" && d.court === "인천지방법원 형사3단독", "제목·법원");
  assert(!d.events.some((e: any) => e.t.includes("이OO")), "남에게 가는 송달은 타임라인에서 뺌");
  assert(d.events.some((e: any) => e.k === "ours"), "우리 서면");
  assert(d.events.some((e: any) => e.k === "due" && e.d === "2026-12-08"), "다음 기일");
  assert(d.hearings.some((h: any) => h.p === "411호 법정") && d.hearings.some((h: any) => h.c === "2026노1"), "기일");
  assert(!d.events.some((e: any) => e.t.includes("보정서")), "남의 서면은 타임라인에서 뺌");
  assert(!d.events.some((e: any) => e.t.includes("기일통지서")), "우리에게 온 송달도 타임라인에서 뺌(나의사건 탭에만)");
  assert(d.events.find((e: any) => e.g === "ours")!.t === "의견서 제출", "우리 서면 줄 " + JSON.stringify(d.events));
  assert(d.events[0].g === "accept" && d.events[0].d === "2026-10-01", "선임이 맨 앞");
  assert(d.events.some((e: any) => e.k === "done" && e.t.startsWith("출석 공판기일")), "지난 기일은 출석");
  assert(d.events.some((e: any) => e.t === "선고" && e.d === "2026-12-20"), "선고일");
  assert(d.events.some((e: any) => e.g === "msg" && e.d === "2026-11-03"), "안내 문자");
  assert(d.progress.rows.length === 5 && d.progress.updated === "11.12 09:31", "진행내용 " + d.progress.updated);
  assert(!JSON.stringify(d).includes("비밀"), "주민번호 안 나감");
  assert(d.info.linked[0] === "2025고단9", "연결 사건");
  assert(d.info.fields.client_name === "김OO" && d.info.fields.case_name === "사기" && !d.info.saved, "처음 값");
  assert(d.progress.rows.find((r: any) => r.c.includes("이OO"))!.x === 1 && d.progress.rows.find((r: any) => r.c.includes("기일통지서"))!.u === 1, "송달 진하게/흐리게");
});

Deno.test("저장된 사건 정보만 씀", () => {
  const c = { l_num: 1, l_code: "x", l_name: "사기", charge_lawyer: "서고은,이예나", raw: { l_client: "로웨어이름", l_justice_dept: "가사 3 단독 (전화:032-620-4441(매주 금요일은 재판))" } };
  const p = infoFields(c, null);
  assert(p.fields.lawyer === "서고은" && p.fields.court_phone === "032-620-4441", "처음 값 " + JSON.stringify(p.fields));
  const s = infoFields(c, { client_name: "우리가 고친 이름", updated_by: "서석원" });
  assert(s.fields.client_name === "우리가 고친 이름" && s.fields.case_name === "" && s.saved, "저장값 우선, 로웨어 안 섞음");
});

Deno.test("안내 문자 요약", () => {
  assert(smsGist("[SMS]안녕하세요 김OO님, 법무법인 정서 입니다.변론기일 안내 드립니다.사건번호 : 2026가단1") === "변론기일 안내 드립니다", smsGist("[SMS]안녕하세요 김OO님, 법무법인 정서 입니다.변론기일 안내 드립니다.사건번호"));
  assert(smsGist("[SMS]안녕하세요.서OO 사무실입니다.김OO님 조사일정안내드립니다.1.2026") === "김OO님 조사일정안내드립니다", smsGist("[SMS]안녕하세요.서OO 사무실입니다.김OO님 조사일정안내드립니다.1.2026"));
});

Deno.test("접견 줄", () => {
  const sh: any = { today: "2026-11-13", events: [] };
  mergeMeets(sh, [{ event_id: "a", ev_date: "2026-11-10", ev_time: "14:00", lawyer: "서고은", place: "인천" }, { event_id: "a", ev_date: "2026-11-10" },
    { event_id: "b", ev_date: "2026-11-20", ev_time: "", lawyer: "이예나", place: "" }]);
  assert(sh.events.length === 2 && sh.events[0].t === "14:00 접견 · 서고은 (인천)" && sh.events[0].k === "done", JSON.stringify(sh.events));
  assert(sh.events[1].t === "접견 예정 · 이예나" && sh.events[1].k === "due", JSON.stringify(sh.events));
});
